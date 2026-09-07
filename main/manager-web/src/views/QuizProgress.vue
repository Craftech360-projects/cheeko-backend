<template>
  <div class="quiz-progress">
    <el-main class="main-content">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ bankLabel }} Progress</h1>
          <p class="page-lead">Level, band and accuracy for every child working through the card quizzes.</p>
        </div>
        <div class="page-actions">
          <el-radio-group v-model="bank" size="small" @change="fetchData">
            <el-radio-button label="quiz">Quiz</el-radio-button>
            <el-radio-button label="riddle">Riddles</el-radio-button>
          </el-radio-group>
          <el-button size="small" :loading="isLoading" @click="fetchData">Refresh</el-button>
        </div>
      </div>

      <ListToolbar
        :count="filteredRows.length"
        count-noun="children"
        :total="filteredRows.length"
        :sort-options="sortOptions"
        :sort-by.sync="sortBy"
        :sort-dir.sync="sortDir"
        :group-options="groupOptions"
        :group-by.sync="groupBy"
        :selecting.sync="selecting"
        :selected-count="selectedCount"
        :all-selected="allSelected"
        :search.sync="search"
        search-placeholder="Filter by MAC or child name"
        @select-all-matching="selectAllMatching"
        @clear-selection="clearSelection"
      >
        <template #filters>
          <el-checkbox v-model="onlyPlayed" class="played-filter">Only devices that have played</el-checkbox>
        </template>
      </ListToolbar>

      <el-card shadow="never">
        <el-table ref="table" :data="visibleRows" v-loading="isLoading" size="small"
          :row-class-name="rowClass"
          @sort-change="onTableSortChange"
          @selection-change="onSelectionChange">
          <el-table-column v-if="selecting" type="selection" width="44" />
          <el-table-column label="Device MAC" prop="device_mac" width="180" sortable="custom">
            <template slot-scope="s">
              <span v-if="s.row.device_mac">{{ s.row.device_mac }}</span>
              <span v-else class="muted">no toy</span>
            </template>
          </el-table-column>
          <el-table-column label="Child" prop="kid_name" width="140" sortable="custom">
            <template slot-scope="s">
              <span v-if="s.row.kid_name">{{ s.row.kid_name }}</span>
              <span v-else class="muted">no profile</span>
            </template>
          </el-table-column>
          <el-table-column label="Band" width="110">
            <template slot-scope="s">
              {{ s.row.age_band }}
              <el-tag v-if="s.row.age_band_defaulted" size="mini" type="warning">default</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Level" width="130" align="center">
            <template slot-scope="s">
              <el-tag v-if="s.row.replay" size="mini" type="success">champion replay</el-tag>
              <span v-else>{{ s.row.current_level }} / {{ s.row.max_level }}</span>
            </template>
          </el-table-column>
          <!-- How far into the CURRENT level the child is. "Levels done" alone
               reads as zero for a child one question from finishing a level,
               which is the opposite of the truth and the thing you actually
               want to see when asking whether someone is stuck. -->
          <el-table-column label="This level" width="110" align="center">
            <template slot-scope="s">
              <span v-if="s.row.current_level === null">&mdash;</span>
              <span v-else>{{ (s.row.level_size || 0) - (s.row.level_uncleared || 0) }} / {{ s.row.level_size || 0 }}</span>
            </template>
          </el-table-column>
          <!-- Was labelled "Cleared", which reads as questions cleared. It
               counts fully finished LEVELS. Renamed rather than re-scoped: the
               number was right, the word was wrong.
               The tag splits mastered from aged-out when they differ — a level
               the 3-day cap moved a child past is finished, but not mastered. -->
          <el-table-column label="Levels done" width="120" align="center">
            <template slot-scope="s">
              {{ s.row.levels_completed }}
              <el-tag v-if="s.row.levels_aged_out" size="mini" type="warning">
                {{ s.row.levels_mastered }} mastered
              </el-tag>
            </template>
          </el-table-column>
          <!-- Lifetime, across every question ever served including retired
               content, so it can legitimately exceed everything above it. -->
          <el-table-column prop="correct" label="Correct" width="80" align="center" />
          <el-table-column label="Today" width="130" align="center">
            <template slot-scope="s">
              {{ s.row.answered_today }} / 10
              <el-tag v-if="s.row.day_complete" size="mini" type="info">done</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Last played" width="160">
            <template slot-scope="s">
              <span v-if="s.row.last_played">{{ formatDate(s.row.last_played) }}</span>
              <span v-else class="muted">never</span>
            </template>
          </el-table-column>
          <el-table-column label="Actions" min-width="230">
            <template slot-scope="s">
              <!-- Enabled whenever rows are dated today, not just once the gate has
                   closed: backdating a partial day is a valid way to start fresh. -->
              <!-- Every action addresses a device by MAC, so a child with no toy
                   can be read but not acted on. -->
              <el-button
                size="mini"
                :disabled="!s.row.device_mac || !s.row.answered_today || busyMac === s.row.device_mac"
                @click="confirmResetDay(s.row)"
              >Reset day</el-button>
              <el-button
                size="mini"
                :disabled="!s.row.device_mac || !s.row.last_played"
                @click="openAnalytics(s.row)"
              >Analytics</el-button>
              <el-button
                size="mini"
                type="warning"
                :disabled="!s.row.device_mac || !s.row.max_level || busyMac === s.row.device_mac"
                @click="openSetLevel(s.row)"
              >Set level</el-button>
            </template>
          </el-table-column>
        </el-table>
        <p v-if="!isLoading && !filteredRows.length" class="muted empty">No devices match.</p>
      </el-card>
    </el-main>

    <el-dialog
      :title="analyticsTitle"
      :visible.sync="analyticsDialog"
      width="820px"
      class="analytics-dialog"
    >
      <div class="analytics-head">
        <el-radio-group v-model="analyticsPeriod" size="mini" @change="fetchAnalytics">
          <el-radio-button label="today">Day</el-radio-button>
          <el-radio-button label="week">Week</el-radio-button>
          <el-radio-button label="month">Month</el-radio-button>
        </el-radio-group>
        <span v-if="analytics" class="muted">
          {{ analytics.start_date }} to {{ analytics.end_date }}
        </span>
        <!-- Same wording rule as the parent app: 'new' has no baseline, so it
             must not be reported as improvement. -->
        <el-tag v-if="trendTag" size="mini" :type="trendTag.type">{{ trendTag.text }}</el-tag>
      </div>

      <div v-loading="analyticsLoading">
        <template v-if="analytics">
          <div v-for="b in analytics.banks" :key="b.bank" class="bank-block">
            <div class="bank-head">
              <b>{{ b.bank === 'riddle' ? 'Riddler' : 'Quizzy' }}</b>
              <span class="muted">
                now on level {{ b.current_level === null ? 'all cleared' : b.current_level }}
              </span>
              <span v-if="b.attempted" class="muted">
                &middot; {{ b.attempted }} answers &middot; {{ b.points }} pts
              </span>
              <el-tag v-if="!b.available" size="mini" type="info">bank not deployed</el-tag>
            </div>

            <p v-if="!b.levels.length" class="muted empty">Nothing played in this period.</p>

            <el-table v-else :data="b.levels" size="mini" border>
              <el-table-column label="Level" width="130">
                <template slot-scope="s">
                  {{ s.row.level }}
                  <el-tag v-if="s.row.cleared" size="mini" type="success">cleared</el-tag>
                  <el-tag v-if="s.row.replay" size="mini" type="warning">replay</el-tag>
                </template>
              </el-table-column>
              <!-- "answers", never "questions": a wrong answer returns on a later
                   day, so attempts can exceed the level's question count. -->
              <el-table-column prop="attempted" label="Answers" width="80" align="center" />
              <el-table-column prop="correct" label="Correct" width="80" align="center" />
              <el-table-column prop="wrong" label="Wrong" width="70" align="center" />
              <!-- Revealed is its own column: it clears the question without the
                   child answering, so it belongs with neither correct nor wrong. -->
              <el-table-column prop="revealed" label="Revealed" width="85" align="center" />
              <el-table-column label="Accuracy" width="90" align="center">
                <template slot-scope="s">{{ s.row.accuracy }}%</template>
              </el-table-column>
              <el-table-column label="Questions" min-width="240">
                <template slot-scope="s">
                  <div v-for="(q, i) in s.row.questions" :key="i" class="q-row">
                    <i :class="resultIcon(q.result)"></i>
                    <span class="q-text">{{ q.question_text }}</span>
                    <span v-if="q.result !== 'correct'" class="muted">&rarr; {{ q.correct_answer }}</span>
                    <span class="muted q-date">{{ q.answered_on }}</span>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </div>

      <span slot="footer">
        <el-button @click="analyticsDialog = false">Close</el-button>
      </span>
    </el-dialog>

    <el-dialog title="Set Level" :visible.sync="levelDialog" width="480px"
      :close-on-click-modal="targetLevel === (target && target.current_level || 1)">
      <template v-if="target">
        <p>
          Device <b>{{ target.device_mac }}</b> &mdash; band {{ target.age_band }},
          currently level {{ target.current_level === null ? 'all cleared' : target.current_level }}.
        </p>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          :title="`This rewrites the device's ${targetBank} answer log`"
          description="Levels below the target are marked cleared with backdated answers; the target level and above are emptied. Answers banked under a different age band, and the other bank's answers, are untouched."
        />
        <div class="level-picker">
          <span>Target level:</span>
          <el-input-number v-model="targetLevel" :min="1" :max="target.max_level || 1" size="small" />
          <span class="muted">of {{ target.max_level }}</span>
        </div>
      </template>
      <span slot="footer">
        <el-button @click="levelDialog = false">Cancel</el-button>
        <el-button type="warning" :loading="!!busyMac" @click="doSetLevel">Set level</el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';
import Api from '@/apis/api';

export default {
  name: 'QuizProgress',
  mixins: [listControls],
  components: { ListToolbar, },
  data() {
    return {
      // list controls
      rowKey: 'device_mac',
      sortBy: 'last_played',
      sortDir: 'desc',
      sortOptions: [
        { label: 'Last played', value: 'last_played' },
        { label: 'Child', value: 'kid_name' },
        { label: 'Level', value: 'current_level' },
        { label: 'Accuracy', value: 'accuracy' }
      ],
      groupOptions: [
        { label: 'None', value: '' },
        { label: 'Band', value: 'age_band' }
      ],
      rows: [],
      // Which bank the page is showing. The API defaults to quiz when absent,
      // so this only ever narrows what is already the default.
      bank: 'quiz',
      isLoading: false,
      search: '',
      onlyPlayed: true,
      levelDialog: false,
      target: null,
      // The bank the open dialog was launched from. set-level rewrites an
      // answer log, so it must write to the bank the row was read from, not
      // whatever the selector happens to say when Submit is pressed.
      targetBank: 'quiz',
      targetLevel: 1,
      // MAC of the row currently being written, so its buttons disable individually
      busyMac: '',
      analyticsDialog: false,
      analyticsLoading: false,
      analyticsRow: null,
      analyticsPeriod: 'week',
      // Covers both banks regardless of the page's bank selector: an operator
      // looking at one child wants the whole picture, not half of it.
      analytics: null
    };
  },
  computed: {
    // `filteredRows` already applies the bank/onlyPlayed filters
    sourceRows() {
      return this.filteredRows;
    },
    bankLabel() {
      return this.bank === 'riddle' ? 'Riddle' : 'Quiz';
    },
    bankNoun() {
      return this.bank === 'riddle' ? 'riddle' : 'quiz';
    },
    analyticsTitle() {
      if (!this.analyticsRow) return 'Analytics';
      const who = this.analyticsRow.kid_name || 'no profile';
      return `${who} — ${this.analyticsRow.device_mac}`;
    },
    trendTag() {
      const t = this.analytics && this.analytics.trend;
      if (!t || t.direction === 'none') return null;
      if (t.direction === 'new') return { type: 'info', text: `${t.accuracy}% — first period, no baseline` };
      if (t.direction === 'up') return { type: 'success', text: `${t.accuracy}% (up ${t.delta} pts)` };
      if (t.direction === 'down') return { type: 'danger', text: `${t.accuracy}% (down ${Math.abs(t.delta)} pts)` };
      return { type: '', text: `${t.accuracy}% — about the same` };
    },
    filteredRows() {
      const term = this.search.trim().toLowerCase();
      return this.rows.filter((r) => {
        if (this.onlyPlayed && !r.last_played) return false;
        if (!term) return true;
        return (r.device_mac || '').toLowerCase().includes(term)
          || (r.kid_name || '').toLowerCase().includes(term);
      });
    }
  },
  mounted() {
    this.fetchData();
  },
  methods: {
    fetchData() {
      this.isLoading = true;
      // Captured per request: switching banks mid-flight must not let a slow
      // quiz response paint itself into the riddle table.
      const requested = this.bank;
      this.rows = [];
      Api.quiz.getDeviceProgress(
        requested,
        ({ data }) => {
          if (requested !== this.bank) return;
          this.isLoading = false;
          this.rows = (data && data.data) || [];
        },
        (err) => {
          if (requested !== this.bank) return;
          this.isLoading = false;
          this.$message.error(this.errText(err, `Failed to load ${this.bankNoun} progress`));
        }
      );
    },

    openAnalytics(row) {
      this.analyticsRow = row;
      this.analytics = null;
      this.analyticsDialog = true;
      this.fetchAnalytics();
    },

    fetchAnalytics() {
      if (!this.analyticsRow) return;
      const mac = this.analyticsRow.device_mac;
      const period = this.analyticsPeriod;
      this.analyticsLoading = true;
      Api.quiz.getAnalytics(
        mac,
        period,
        ({ data }) => {
          // A slow response for a previous device or period must not paint over
          // the one the operator is now looking at.
          if (!this.analyticsRow || this.analyticsRow.device_mac !== mac || this.analyticsPeriod !== period) return;
          this.analyticsLoading = false;
          this.analytics = (data && data.data) || null;
        },
        (err) => {
          if (!this.analyticsRow || this.analyticsRow.device_mac !== mac || this.analyticsPeriod !== period) return;
          this.analyticsLoading = false;
          this.$message.error(this.errText(err, 'Failed to load analytics'));
        }
      );
    },

    resultIcon(result) {
      if (result === 'correct') return 'el-icon-check q-ok';
      if (result === 'revealed') return 'el-icon-view q-revealed';
      return 'el-icon-close q-bad';
    },

    confirmResetDay(row) {
      this.$confirm(
        `Backdate today's ${row.answered_today} ${this.bankNoun} answers for ${row.device_mac} by one day? `
        + `Levels stay cleared; the device can start the next level today. The other bank is unaffected.`,
        'Reset day',
        { type: 'warning' }
      ).then(() => {
        this.busyMac = row.device_mac;
        Api.quiz.resetDay(
          row.device_mac,
          this.bank,
          ({ data }) => {
            this.busyMac = '';
            this.$message.success(`Backdated ${(data && data.data && data.data.backdated) || 0} rows`);
            this.fetchData();
          },
          (err) => {
            this.busyMac = '';
            this.$message.error(this.errText(err, 'Reset day failed'));
          }
        );
      }).catch(() => {});
    },

    openSetLevel(row) {
      this.target = row;
      this.targetBank = this.bankNoun;
      this.targetLevel = row.current_level || 1;
      this.levelDialog = true;
    },

    doSetLevel() {
      const row = this.target;
      this.busyMac = row.device_mac;
      Api.quiz.setLevel(
        row.device_mac,
        this.targetLevel,
        this.targetBank,
        ({ data }) => {
          this.busyMac = '';
          this.levelDialog = false;
          const d = (data && data.data) || {};
          this.$message.success(
            `${row.device_mac} ${this.targetBank} set to level ${this.targetLevel} (removed ${d.deleted}, cleared ${d.cleared})`
          );
          this.fetchData();
        },
        (err) => {
          this.busyMac = '';
          this.$message.error(this.errText(err, 'Set level failed'));
        }
      );
    },

    // The API reports validation problems in the envelope msg; fall back to the
    // transport error so a network failure is not reported as a silent success.
    errText(err, fallback) {
      return (err && err.data && err.data.msg) || (err && err.msg) || fallback;
    },

    formatDate(value) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.quiz-progress {
  min-height: 0;
  background: #f6f8fb;
}

.main-content {
  padding: 20px;
}

.page-header {
  margin-bottom: 16px;

  h1 {
    margin: 0;
    font-size: 22px;
    color: $text-dark;
  }

  .subtitle {
    margin: 4px 0 0;
    font-size: 13px;
    color: #8a90a6;
  }
}

.filter-card {
  margin-bottom: 16px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.search-input {
  width: 280px;
}

.level-picker {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}

.muted {
  color: #a0a4b8;
}

.analytics-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.bank-block {
  margin-bottom: 18px;
}

.bank-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  font-size: 13px;
}

.q-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
}

.q-text {
  flex: 1;
}

.q-date {
  white-space: nowrap;
}

.q-ok {
  color: #67c23a;
}

.q-bad {
  color: $danger;
}

.q-revealed {
  color: $warning;
}

.empty {
  text-align: center;
  padding: 18px 0;
}
</style>
