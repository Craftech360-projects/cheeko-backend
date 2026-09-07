<template>
  <div class="overview-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Good to see you, {{ firstName }}</h1>
        <p class="page-lead">{{ todayLabel }} · IST · fleet health, family activity and spend.</p>
      </div>
      <div class="page-actions">
        <div class="live-strip" v-if="onlineNow !== null">
          <span class="live-dot" :class="{ on: onlineNow > 0 }"></span>
          <span v-if="onlineNow > 0">{{ onlineNow }} online now</span>
          <span v-else>None online</span>
        </div>
        <el-radio-group v-model="range" size="small" @change="loadOverview">
          <el-radio-button label="today">Today</el-radio-button>
          <el-radio-button label="7d">7d</el-radio-button>
          <el-radio-button label="30d">30d</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <div v-loading="loading" class="overview-body">
      <!-- KPI row -->
      <div class="kpi-row" v-if="kpis">
        <StatCard label="Active toys" :value="kpis.activeToys.total" :delta="deltas.activeToys"
          :sub="`of ${kpis.activeToys.fleetTotal} fleet · ${kpis.activeToys.onlineNow} online now`">
          <BaseChart v-if="kpis.activeToys.sparkline.length" :option="spark(kpis.activeToys.sparkline)" height="42px" />
        </StatCard>
        <StatCard label="Play time" :value="kpis.playTimeHours.total" unit="h" :delta="deltas.playTimeHours">
          <BaseChart v-if="kpis.playTimeHours.sparkline.length" :option="spark(kpis.playTimeHours.sparkline)" height="42px" />
        </StatCard>
        <StatCard label="Sessions" :value="kpis.sessions.total" :delta="deltas.sessions">
          <BaseChart v-if="kpis.sessions.sparkline.length" :option="spark(kpis.sessions.sparkline)" height="42px" />
        </StatCard>
        <StatCard label="New families" :value="kpis.newFamilies.total" :delta="deltas.newFamilies">
          <BaseChart v-if="kpis.newFamilies.sparkline.length" :option="spark(kpis.newFamilies.sparkline)" height="42px" />
        </StatCard>
        <StatCard label="AI cost" :value="kpis.aiCostInr.total" unit="₹" :delta="deltas.aiCostInr" :invert-delta="true">
          <BaseChart v-if="kpis.aiCostInr.sparkline.length" :option="spark(kpis.aiCostInr.sparkline)" height="42px" />
        </StatCard>
      </div>

      <!-- Where kids spend time + Today's split -->
      <div class="section-row">
        <div class="card span-2">
          <h3 class="card-title">Where kids spend time</h3>
          <BaseChart v-if="hasTimeSeries" :option="timeByFeatureOption" height="280px" />
          <div v-else class="card-empty">No usage recorded in this period yet.</div>
        </div>
        <div class="card">
          <h3 class="card-title">Today's split</h3>
          <template v-if="todaysSplit.hasData">
            <div class="split-total">{{ todaysSplit.totalMinutes }} min today</div>
            <div class="split-bar">
              <div v-for="item in todaysSplit.items" :key="item.key"
                class="split-segment" :style="{ width: splitPercent(item) + '%', background: featureColor(item.key) }">
              </div>
            </div>
            <div class="split-legend">
              <div v-for="item in todaysSplit.items" :key="item.key" class="split-row">
                <span class="split-dot" :style="{ background: featureColor(item.key) }"></span>
                <span class="split-label">{{ item.label }}</span>
                <span class="split-mins">{{ item.minutes }} min</span>
              </div>
            </div>
          </template>
          <div v-else class="card-empty">No activity today yet — the split shows once toys start playing.</div>
        </div>
      </div>

      <!-- What kids love -->
      <h3 class="section-title">What kids love</h3>
      <div class="section-row">
        <div class="card">
          <h4 class="card-subtitle">Cards kids love <span class="muted">(repeat taps)</span></h4>
          <div v-if="cardLeaderboard.length" class="mini-leaderboard">
            <div v-for="(pack, i) in cardLeaderboard" :key="pack.name" class="mini-row">
              <span class="mini-rank">{{ i + 1 }}</span>
              <span class="mini-name">{{ pack.name }}</span>
              <span class="mini-value">{{ pack.taps }} taps · {{ pack.uniqueDevices }} toys</span>
            </div>
          </div>
          <div v-else class="card-empty">No card taps in this period.</div>
          <p class="footnote" v-if="unresolvedTaps">{{ unresolvedTaps }} taps couldn't be matched to a pack.</p>
        </div>
        <div class="card">
          <h4 class="card-subtitle">Games: played vs finished</h4>
          <div v-if="gamesLeaderboard.length" class="mini-leaderboard">
            <div v-for="game in gamesLeaderboard" :key="game.name" class="mini-row">
              <span class="mini-rank">{{ game.plays }}</span>
              <span class="mini-name">{{ game.name }}</span>
              <span class="mini-value">{{ game.avgDurationMinutes }} min<span v-if="game.avgScore !== null"> · avg {{ game.avgScore }}</span></span>
            </div>
          </div>
          <div v-else class="card-empty">No game plays in this period.</div>
        </div>
        <div class="card">
          <h4 class="card-subtitle">What kids talk about</h4>
          <div v-if="topics.length" class="topic-cloud">
            <el-tag v-for="t in topics" :key="t.topic" size="small" class="topic-tag">{{ t.topic }} · {{ t.mentions }}</el-tag>
          </div>
          <div v-else class="card-empty">No conversations summarised yet.</div>
          <p v-if="talkSample" class="footnote sample">"{{ talkSample }}"</p>
        </div>
      </div>

      <!-- Needs attention -->
      <h3 class="section-title">Needs attention</h3>
      <div class="card">
        <div v-if="watchlist.length" class="mini-leaderboard">
          <div v-for="item in watchlist" :key="item.macAddress + item.issue" class="mini-row">
            <span class="attention-dot" :class="attentionLevel(item)"></span>
            <span class="mini-name">{{ item.alias }}<span v-if="item.kidName" class="muted"> · {{ item.kidName }}</span></span>
            <span class="mini-value">{{ item.issue }}</span>
          </div>
        </div>
        <div v-else class="card-empty ok">All quiet — nothing needs a human right now.</div>
      </div>
    </div>
  </div>
</template>

<script>
import StatCard from '@/components/StatCard.vue';
import BaseChart from '@/components/charts/BaseChart.vue';
import { ensureEcharts, sparklineOption, stackedAreaOption, SERIES_COLORS } from '@/components/charts/presets';
import { mapGetters } from 'vuex';
import Api from '@/apis/api';

const FEATURE_KEYS = ['aiTalk', 'card', 'game', 'radio'];

export default {
  name: 'Overview',
  components: { StatCard, BaseChart },
  data() {
    return {
      range: '7d',
      loading: false,
      onlineNow: null,
      kpis: null,
      deltas: {},
      timeSeries: [],
      todaysSplit: { hasData: false, totalMinutes: 0, items: [] },
      cardLeaderboard: [],
      unresolvedTaps: 0,
      gamesLeaderboard: [],
      topics: [],
      talkSample: '',
      watchlist: []
    };
  },
  computed: {
    ...mapGetters(['getUserInfo']),
    firstName() {
      const name = this.getUserInfo.username || 'Cheeko';
      return String(name).split('@')[0];
    },
    todayLabel() {
      return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    },
    hasTimeSeries() {
      return this.timeSeries.length > 0;
    },
    timeByFeatureOption() {
      const dates = this.timeSeries.map(row => row.date);
      const series = [
        { name: 'AI conversations', key: 'aiTalk', color: SERIES_COLORS.aiTalk },
        { name: 'Story & rhyme cards', key: 'card', color: SERIES_COLORS.card },
        { name: 'Games', key: 'game', color: SERIES_COLORS.game },
        { name: 'Radio', key: 'radio', color: SERIES_COLORS.radio }
      ].map(s => ({
        name: s.name,
        color: s.color,
        data: this.timeSeries.map(row => row[`${s.key}Minutes`])
      }));
      return stackedAreaOption(dates, series);
    }
  },
  created() {
    ensureEcharts();
    this.loadOverview();
    this.loadWatchlist();
    this.fetchOnlineNow();
    // Live strip refresh — light count endpoint only
    this._onlineTimer = setInterval(this.fetchOnlineNow, 60000);
  },
  beforeDestroy() {
    if (this._onlineTimer) clearInterval(this._onlineTimer);
  },
  methods: {
    spark(values) {
      return sparklineOption(values);
    },
    fetchOnlineNow() {
      Api.admin.getActiveNow(({ data }) => {
        if (data.code === 0 && data.data) {
          this.onlineNow = data.data.count || 0;
        }
        // silent failure — the strip is supplementary
      });
    },
    featureColor(key) {
      return SERIES_COLORS[key] || SERIES_COLORS.neutral;
    },
    splitPercent(item) {
      const total = this.todaysSplit.totalMinutes || 1;
      return Math.round((item.minutes / total) * 1000) / 10;
    },
    attentionLevel(item) {
      return item.severity || 'warning';
    },
    loadOverview() {
      this.loading = true;
      Api.admin.getFounderOverview(this.range, ({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          const payload = data.data;
          this.kpis = payload.kpis;
          this.deltas = payload.deltas || {};
          this.timeSeries = (payload.sections.timeByFeature && payload.sections.timeByFeature.series) || [];
          this.todaysSplit = payload.sections.todaysSplit || { hasData: false, items: [] };
          this.cardLeaderboard = (payload.sections.cardsKidsLove && payload.sections.cardsKidsLove.items) || [];
          this.unresolvedTaps = (payload.sections.cardsKidsLove && payload.sections.cardsKidsLove.unresolvedTapCount) || 0;
          this.gamesLeaderboard = (payload.sections.gamesPlayedVsFinished && payload.sections.gamesPlayedVsFinished.items) || [];
          this.topics = (payload.sections.talkingAbout && payload.sections.talkingAbout.items) || [];
          const samples = (payload.sections.talkingAbout && payload.sections.talkingAbout.samples) || [];
          const first = samples.find(s => s.summary);
          this.talkSample = first ? first.summary : '';
        } else {
          this.$message.error(data.msg || 'Failed to load overview');
        }
      });
    },
    loadWatchlist() {
      Api.admin.getFounderOperate(({ data }) => {
        if (data.code === 0 && data.data) {
          this.watchlist = (data.data.sections.watchlist || []).slice(0, 5);
        }
        // silent failure — the strip is supplementary
      });
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.overview-page { max-width: 1440px; }

// ---------- Live strip ----------
.live-strip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  height: 32px;
  padding: 0 12px;
  font-size: 12.5px;
  color: $text-body;
  white-space: nowrap;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #C9C2B7;

  &.on {
    background: $success;
    box-shadow: 0 0 0 3px rgba(51, 97, 58, 0.12);
  }
}

// ---------- Layout ----------
.kpi-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  margin-bottom: 14px;
}

@media (max-width: 1280px) { .kpi-row { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 800px) { .kpi-row { grid-template-columns: 1fr; } }

.section-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 14px;
  align-items: start;

  .span-2 { grid-column: span 2; }
}

@media (max-width: 1100px) {
  .section-row {
    grid-template-columns: 1fr;

    .span-2 { grid-column: span 1; }
  }
}

.section-title {
  margin: 30px 0 14px;
  font-family: $font-display;
  font-size: 22px;
  font-weight: 400;
  letter-spacing: -0.02em;
  color: $text-dark;
}

.card-title {
  margin: 0 0 16px;
  font-size: 13.5px;
  font-weight: 590;
  color: $text-dark;
}

.card-subtitle {
  margin: 0 0 16px;
  font-size: 13.5px;
  font-weight: 590;
  color: $text-dark;

  .muted { font-weight: 400; color: $text-light; font-size: 11.5px; }
}

// ---------- Today's split ----------
.split-total {
  font-family: $font-display;
  font-size: 32px;
  font-weight: 400;
  letter-spacing: -0.03em;
  color: $text-dark;
  margin-bottom: 16px;
}

.split-bar {
  display: flex;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: $surface-sunk;
  margin-bottom: 18px;
}

.split-segment { height: 100%; }

.split-legend {
  display: flex;
  flex-direction: column;
}

.split-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid $divider-color;
  font-size: 12.5px;

  &:last-child { border-bottom: 0; }
}

.split-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: 0 0 auto;
}

.split-label { color: $text-body; }

.split-mins {
  margin-left: auto;
  font-family: $font-mono;
  font-size: 11px;
  color: $text-gray;
}

// ---------- Leaderboards ----------
.mini-leaderboard {
  display: flex;
  flex-direction: column;
}

.mini-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 0;
  border-bottom: 1px solid $divider-color;
  font-size: 12.5px;

  &:last-child { border-bottom: 0; }
}

.mini-rank {
  width: 22px;
  height: 22px;
  border-radius: $radius-sm;
  background: $surface-sunk;
  color: $text-gray;
  font-family: $font-mono;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.mini-name {
  color: $text-dark;
  font-weight: 520;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .muted { font-weight: 400; color: $text-light; }
}

.mini-value {
  margin-left: auto;
  font-family: $font-mono;
  font-size: 11px;
  color: $text-gray;
  white-space: nowrap;
}

.attention-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: $text-light;

  &.warning { background: $warning; }
  &.serious { background: $primary; }
  &.critical { background: $danger; }
}

// ---------- Topics ----------
.topic-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.topic-tag { margin: 0; }

.footnote {
  margin: 14px 0 0;
  font-size: 11.5px;
  color: $text-light;

  &.sample {
    font-family: $font-display;
    font-size: 15px;
    line-height: 1.5;
    color: $text-body;
    padding-top: 14px;
    border-top: 1px solid $divider-color;
  }
}

.card-empty {
  padding: 32px 0;
  text-align: center;
  color: $text-light;
  font-size: 12.5px;

  &.ok { color: $success; }
}
</style>
