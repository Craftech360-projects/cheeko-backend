<template>
  <div class="quiz-progress">
    <HeaderBar />
    <el-main class="main-content">
      <div class="page-header">
        <h1>Quiz Progress</h1>
        <p class="subtitle">Current Level per device, and admin overrides for testing</p>
      </div>

      <el-card class="filter-card" shadow="never">
        <div class="filter-row">
          <el-input
            v-model="search"
            placeholder="Filter by MAC or child name"
            prefix-icon="el-icon-search"
            clearable
            class="search-input"
          />
          <el-checkbox v-model="onlyPlayed">Only devices that have played</el-checkbox>
          <el-button type="primary" :loading="isLoading" @click="fetchData">
            <i class="el-icon-refresh"></i> Refresh
          </el-button>
        </div>
      </el-card>

      <el-card shadow="never">
        <el-table :data="filteredRows" v-loading="isLoading" stripe border size="small">
          <el-table-column prop="device_mac" label="Device MAC" width="170" />
          <el-table-column label="Child" width="130">
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
          <el-table-column prop="levels_completed" label="Cleared" width="80" align="center" />
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
              <el-button
                size="mini"
                :disabled="!s.row.day_complete || busyMac === s.row.device_mac"
                @click="confirmResetDay(s.row)"
              >Reset day</el-button>
              <el-button
                size="mini"
                type="warning"
                :disabled="!s.row.max_level || busyMac === s.row.device_mac"
                @click="openSetLevel(s.row)"
              >Set level</el-button>
            </template>
          </el-table-column>
        </el-table>
        <p v-if="!isLoading && !filteredRows.length" class="muted empty">No devices match.</p>
      </el-card>
    </el-main>

    <el-dialog title="Set Level" :visible.sync="levelDialog" width="480px">
      <template v-if="target">
        <p>
          Device <b>{{ target.device_mac }}</b> &mdash; band {{ target.age_band }},
          currently level {{ target.current_level === null ? 'all cleared' : target.current_level }}.
        </p>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="This rewrites the device's quiz answer log"
          description="Levels below the target are marked cleared with backdated answers; the target level and above are emptied. Answers banked under a different age band are untouched."
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
import Api from '@/apis/api';
import HeaderBar from '@/components/HeaderBar.vue';

export default {
  name: 'QuizProgress',
  components: { HeaderBar },
  data() {
    return {
      rows: [],
      isLoading: false,
      search: '',
      onlyPlayed: true,
      levelDialog: false,
      target: null,
      targetLevel: 1,
      // MAC of the row currently being written, so its buttons disable individually
      busyMac: ''
    };
  },
  computed: {
    filteredRows() {
      const term = this.search.trim().toLowerCase();
      return this.rows.filter((r) => {
        if (this.onlyPlayed && !r.last_played) return false;
        if (!term) return true;
        return r.device_mac.toLowerCase().includes(term)
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
      Api.quiz.getDeviceProgress(
        ({ data }) => {
          this.isLoading = false;
          this.rows = (data && data.data) || [];
        },
        (err) => {
          this.isLoading = false;
          this.$message.error(this.errText(err, 'Failed to load quiz progress'));
        }
      );
    },

    confirmResetDay(row) {
      this.$confirm(
        `Backdate today's ${row.answered_today} answers for ${row.device_mac} by one day? `
        + 'Levels stay cleared; the device can start the next level today.',
        'Reset day',
        { type: 'warning' }
      ).then(() => {
        this.busyMac = row.device_mac;
        Api.quiz.resetDay(
          row.device_mac,
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
      this.targetLevel = row.current_level || 1;
      this.levelDialog = true;
    },

    doSetLevel() {
      const row = this.target;
      this.busyMac = row.device_mac;
      Api.quiz.setLevel(
        row.device_mac,
        this.targetLevel,
        ({ data }) => {
          this.busyMac = '';
          this.levelDialog = false;
          const d = (data && data.data) || {};
          this.$message.success(
            `${row.device_mac} set to level ${this.targetLevel} (removed ${d.deleted}, cleared ${d.cleared})`
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
.quiz-progress {
  min-height: 100vh;
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
    color: #3d4566;
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

.empty {
  text-align: center;
  padding: 18px 0;
}
</style>
