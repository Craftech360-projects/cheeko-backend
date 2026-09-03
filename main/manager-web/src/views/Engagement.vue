<template>
  <div class="engagement-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">Engagement</h2>
        <p class="page-subtitle">Who is playing, how often, and when · IST</p>
      </div>
      <el-radio-group v-model="range" size="small" @change="load">
        <el-radio-button label="7d">7 days</el-radio-button>
        <el-radio-button label="30d">30 days</el-radio-button>
      </el-radio-group>
    </div>

    <div v-loading="loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.activeToday }}</div>
          <div class="kpi-label">active today</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.activeYesterday }}</div>
          <div class="kpi-label">active yesterday</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.weeklyActives }}
            <span v-if="deltas.weeklyActives !== null && deltas.weeklyActives !== undefined" class="kpi-delta" :class="deltas.weeklyActives >= 0 ? 'good' : 'bad'">
              {{ deltas.weeklyActives >= 0 ? '▲' : '▼' }}{{ Math.abs(deltas.weeklyActives) }}%
            </span>
          </div>
          <div class="kpi-label">weekly actives (of {{ kpis.fleetTotal }})</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.monthlyActives }}
            <span v-if="deltas.monthlyActives !== null && deltas.monthlyActives !== undefined" class="kpi-delta" :class="deltas.monthlyActives >= 0 ? 'good' : 'bad'">
              {{ deltas.monthlyActives >= 0 ? '▲' : '▼' }}{{ Math.abs(deltas.monthlyActives) }}%
            </span>
          </div>
          <div class="kpi-label">monthly actives</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.dauMauRatio === null ? '—' : kpis.dauMauRatio + '%' }}</div>
          <div class="kpi-label">stickiness (DAU/MAU)</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.avgSessionMinutes }}<span class="kpi-unit">m</span></div>
          <div class="kpi-label">avg session</div>
        </div>
      </div>

      <!-- DAU line + returning split -->
      <div class="two-col">
        <div class="card">
          <h4 class="card-subtitle">Daily active toys <span class="muted">with 7-day average</span></h4>
          <BaseChart v-if="dailyActives.length" :option="dauOption" height="250px" />
          <div v-else class="card-empty">No usage data in this period.</div>
        </div>
        <div class="card">
          <h4 class="card-subtitle">Returning vs new <span class="muted">this week vs last</span></h4>
          <div class="return-grid">
            <div class="return-box">
              <div class="return-num">{{ returning.currentWeekActives }}</div>
              <div class="return-label">active this week</div>
            </div>
            <div class="return-box">
              <div class="return-num">{{ returning.previousWeekActives }}</div>
              <div class="return-label">active last week</div>
            </div>
            <div class="return-box good">
              <div class="return-num">{{ returning.returnedCount }}</div>
              <div class="return-label">returned ({{ returning.returnedRate === null ? '—' : returning.returnedRate + '%' }})</div>
            </div>
            <div class="return-box">
              <div class="return-num">{{ returning.newCount }}</div>
              <div class="return-label">new this week</div>
            </div>
          </div>
          <p class="footnote">{{ returning.windowLabel }}</p>
        </div>
      </div>

      <!-- Heatmap -->
      <div class="card heatmap-card">
        <h4 class="card-subtitle">When kids play <span class="muted">sessions by hour (IST)</span></h4>
        <div v-if="hasHeatmap" class="heatmap">
          <div class="heat-row heat-axis">
            <span class="heat-day"></span>
            <span v-for="h in 24" :key="h" class="heat-hour">{{ (h - 1) % 3 === 0 ? h - 1 : '' }}</span>
          </div>
          <div v-for="day in heatmap" :key="day.day" class="heat-row">
            <span class="heat-day">{{ day.day }}</span>
            <div v-for="cell in day.hours" :key="cell.hour"
              class="heat-cell"
              :style="cell.sessions ? { background: heatColor(cell.sessions) } : {}"
              :title="`${day.day} ${cell.hour}:00 — ${cell.sessions} sessions`">
            </div>
          </div>
        </div>
        <div v-else class="card-empty">No sessions yet in this period.</div>
      </div>

      <!-- Quiet toys -->
      <h3 class="section-title">Quiet toys <span class="muted" v-if="quietTotal">{{ quietTotal }} total · shown first 12</span></h3>
      <div class="card">
        <div v-if="quietDevices.length" class="quiet-list">
          <div v-for="device in quietDevices" :key="device.macAddress" class="quiet-row">
            <span class="quiet-name">{{ device.alias }}<span v-if="device.kidName" class="muted"> · {{ device.kidName }}</span></span>
            <span class="quiet-days">{{ device.quietDays }}d quiet</span>
            <span class="quiet-last">last activity {{ shortDay(device.lastActivityDate) }}</span>
          </div>
        </div>
        <div v-else class="card-empty ok">No quiet toys — everyone has been active recently.</div>
      </div>
    </div>
  </div>
</template>

<script>
import BaseChart from '@/components/charts/BaseChart.vue';
import { ensureEcharts, SERIES_COLORS } from '@/components/charts/presets';
import Api from '@/apis/api';

export default {
  name: 'Engagement',
  components: { BaseChart },
  data() {
    return {
      range: '30d',
      loading: false,
      kpis: {},
      deltas: {},
      dailyActives: [],
      returning: {},
      heatmap: [],
      quietDevices: [],
      quietTotal: 0
    };
  },
  computed: {
    hasHeatmap() {
      return this.heatmap.some(day => day.hours.some(h => h.sessions > 0));
    },
    dauOption() {
      return {
        grid: { left: 36, right: 12, top: 30, bottom: 24 },
        tooltip: { trigger: 'axis' },
        legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11 } },
        xAxis: {
          type: 'category',
          data: this.dailyActives.map(r => r.date),
          axisLabel: { fontSize: 10, color: '#8a8fa3' },
          axisLine: { lineStyle: { color: '#e4e6ef' } },
          axisTick: { show: false }
        },
        yAxis: {
          type: 'value',
          minInterval: 1,
          axisLabel: { fontSize: 10, color: '#8a8fa3' },
          splitLine: { lineStyle: { color: '#f0f1f7' } }
        },
        series: [
          {
            name: 'Active toys',
            type: 'line',
            data: this.dailyActives.map(r => r.activeDevices),
            symbol: 'circle',
            symbolSize: 5,
            lineStyle: { color: SERIES_COLORS.game, width: 2 },
            itemStyle: { color: SERIES_COLORS.game }
          },
          {
            name: '7-day avg',
            type: 'line',
            data: this.dailyActives.map(r => r.average),
            symbol: 'none',
            lineStyle: { color: '#b9bdd1', width: 1.5, type: 'dashed' }
          }
        ]
      };
    }
  },
  created() {
    ensureEcharts();
    this.load();
  },
  methods: {
    shortDay(dayKey) {
      if (!dayKey) return '—';
      const d = new Date(`${dayKey}T00:00:00`);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    },
    heatColor(sessions) {
      // 4-step green ramp keyed off the busiest cell
      const max = Math.max(...this.heatmap.map(d => Math.max(...d.hours.map(h => h.sessions))), 1);
      const ratio = sessions / max;
      if (ratio > 0.75) return '#008300';
      if (ratio > 0.5) return 'rgba(0,131,0,0.65)';
      if (ratio > 0.25) return 'rgba(0,131,0,0.4)';
      return 'rgba(0,131,0,0.2)';
    },
    load() {
      this.loading = true;
      Api.admin.getFounderEngagement(this.range, ({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.kpis = data.data.kpis || {};
          this.deltas = data.data.deltas || {};
          const sections = data.data.sections || {};
          this.dailyActives = sections.dailyActives || [];
          this.returning = sections.returningSplit || {};
          this.heatmap = sections.sessionsHeatmap || [];
          this.quietDevices = sections.quietDevices || [];
          this.quietTotal = sections.quietDeviceTotal || 0;
        } else {
          this.$message.error(data.msg || 'Failed to load engagement');
        }
      });
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.engagement-page {
  max-width: 1280px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 20px;
  color: $text-dark;
}

.page-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: $text-gray;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.card {
  background: #fff;
  border: 1px solid $border-color;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 4px 14px rgba(61, 69, 102, 0.05);
  min-width: 0;
}

.kpi-value {
  font-size: 21px;
  font-weight: 700;
  color: $text-dark;
  font-variant-numeric: tabular-nums;
}

.kpi-unit {
  font-size: 13px;
  color: $text-gray;
  font-weight: 500;
}

.kpi-delta {
  font-size: 11px;
  font-weight: 600;

  &.good { color: #006300; }
  &.bad { color: #d03b3b; }
}

.kpi-label {
  font-size: 11px;
  color: $text-gray;
  margin-top: 2px;
}

.two-col {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 12px;
  margin-bottom: 14px;
}

.card-subtitle {
  margin: 0 0 10px;
  font-size: 13px;
  color: $text-dark;
}

.muted {
  color: $text-gray;
  font-weight: 400;
  font-size: 11px;
}

.return-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.return-box {
  background: #f8f9fd;
  border-radius: 10px;
  padding: 12px;

  &.good .return-num { color: #0a7a0a; }
}

.return-num {
  font-size: 20px;
  font-weight: 700;
  color: $text-dark;
  font-variant-numeric: tabular-nums;
}

.return-label {
  font-size: 11px;
  color: $text-gray;
  margin-top: 2px;
}

.footnote {
  margin: 10px 0 0;
  font-size: 10.5px;
  color: $text-gray;
}

.heatmap-card {
  margin-bottom: 14px;
}

.heatmap {
  overflow-x: auto;
}

.heat-row {
  display: grid;
  grid-template-columns: 40px repeat(24, 1fr);
  gap: 2px;
  margin-bottom: 2px;
  min-width: 640px;
}

.heat-day {
  font-size: 10.5px;
  color: $text-gray;
  align-self: center;
}

.heat-hour {
  font-size: 9px;
  color: $text-gray;
  text-align: center;
}

.heat-cell {
  height: 16px;
  border-radius: 3px;
  background: #f4f5fa;
}

.quiet-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
}

.quiet-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid #f4f5fa;
  font-size: 12.5px;
}

.quiet-name {
  flex: 1;
  color: $text-dark;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quiet-days {
  color: #d03b3b;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.quiet-last {
  color: $text-gray;
  font-size: 11px;
  white-space: nowrap;
}

.section-title {
  margin: 4px 0 10px;
  font-size: 14px;
  color: $text-dark;
}

.card-empty {
  text-align: center;
  color: $text-gray;
  font-size: 12.5px;
  padding: 28px 0;

  &.ok { color: #0ca30c; }
}

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(3, 1fr); }
  .two-col { grid-template-columns: 1fr; }
  .quiet-list { grid-template-columns: 1fr; }
}
</style>
