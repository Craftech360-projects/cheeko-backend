<template>
  <div class="costs-page">
    <div class="costs-header">
      <div>
        <h2 class="page-title">Costs</h2>
        <p class="page-subtitle">AI spend across the fleet · IST</p>
      </div>
      <div class="header-actions">
        <el-radio-group v-model="range" size="small" @change="loadCosts">
          <el-radio-button label="7d">7 days</el-radio-button>
          <el-radio-button label="30d">30 days</el-radio-button>
          <el-radio-button label="month">This month</el-radio-button>
        </el-radio-group>
        <router-link class="raw-link" to="/token-analytics">Raw token view →</router-link>
      </div>
    </div>

    <div v-loading="loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi">
          <div class="kpi-label">Spend this period</div>
          <div class="kpi-big">₹{{ fmt(kpis.totalCost) }}</div>
          <div v-if="deltas.totalCost !== null && deltas.totalCost !== undefined" class="kpi-delta" :class="deltas.totalCost > 0 ? 'bad' : 'good'">
            {{ deltas.totalCost > 0 ? '▲' : '▼' }} {{ Math.abs(deltas.totalCost) }}% vs previous period
          </div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">Projected this month</div>
          <div class="kpi-big">₹{{ fmt(kpis.projectedMonth) }}</div>
          <div class="kpi-sub" v-if="kpis.monthlyBudget">
            budget ₹{{ fmt(kpis.monthlyBudget) }} ·
            <span :class="budgetOver ? 'bad' : 'good'">{{ kpis.budgetUsedPercent }}% used</span>
          </div>
          <div class="kpi-sub" v-else>set a monthly budget in Parameters to track it here</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">Per active toy / day</div>
          <div class="kpi-big">₹{{ kpis.perActiveToyPerDay !== null && kpis.perActiveToyPerDay !== undefined ? kpis.perActiveToyPerDay : '—' }}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">Per session</div>
          <div class="kpi-big">₹{{ kpis.perSession !== null && kpis.perSession !== undefined ? kpis.perSession : '—' }}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">Avg response time</div>
          <div class="kpi-big">{{ avgResponse }}<span class="kpi-unit">s</span></div>
        </div>
      </div>

      <!-- Daily spend -->
      <div class="two-col">
        <div class="card">
          <h4 class="card-subtitle">Daily spend <span class="muted">(input vs output)</span></h4>
          <BaseChart v-if="dailySpend.length" :option="dailySpendOption" height="260px" />
          <div v-else class="card-empty">No spend recorded in this period.</div>
        </div>
        <div class="card">
          <h4 class="card-subtitle">Token mix</h4>
          <template v-if="tokenMixTotal > 0">
            <div class="mix-bar">
              <div class="mix-seg" :style="{ width: mixPercent('text') + '%', background: '#2a78d6' }"></div>
              <div class="mix-seg" :style="{ width: mixPercent('inputAudio') + '%', background: '#fab219' }"></div>
              <div class="mix-seg" :style="{ width: mixPercent('outputAudio') + '%', background: '#eb6834' }"></div>
            </div>
            <div class="mix-legend">
              <div class="mix-row"><span class="dot" :style="{ background: '#2a78d6' }"></span> Text tokens <b>{{ fmt(tokenMix.text) }}</b></div>
              <div class="mix-row"><span class="dot" :style="{ background: '#fab219' }"></span> Input audio <b>{{ fmt(tokenMix.inputAudio) }}</b></div>
              <div class="mix-row"><span class="dot" :style="{ background: '#eb6834' }"></span> Output audio (voice replies) <b>{{ fmt(tokenMix.outputAudio) }}</b></div>
            </div>
            <p class="footnote">Voice output is the expensive channel — TTS tokens cost far more than text.</p>
          </template>
          <div v-else class="card-empty">No tokens used in this period.</div>
        </div>
      </div>

      <!-- Top toys by spend -->
      <h3 class="section-title">Top toys by spend</h3>
      <div class="card">
        <el-table :data="topDevices" style="width: 100%" empty-text="No device spend in this period">
          <el-table-column label="Toy" min-width="150">
            <template slot-scope="scope">
              {{ scope.row.alias }}<span v-if="scope.row.kidName" class="muted"> · {{ scope.row.kidName }}</span>
            </template>
          </el-table-column>
          <el-table-column label="MAC" width="170">
            <template slot-scope="scope"><span class="mono">{{ scope.row.macAddress }}</span></template>
          </el-table-column>
          <el-table-column label="Sessions" prop="sessions" width="90" />
          <el-table-column label="Talk (h)" prop="talkHours" width="90" />
          <el-table-column label="Tokens" width="120">
            <template slot-scope="scope">{{ fmt(scope.row.totalTokens) }}</template>
          </el-table-column>
          <el-table-column label="Cost" width="110">
            <template slot-scope="scope">₹{{ fmt(scope.row.cost) }}</template>
          </el-table-column>
          <el-table-column label="Share of fleet" min-width="160">
            <template slot-scope="scope">
              <div class="share-bar"><div class="share-fill" :style="{ width: Math.min(scope.row.fleetSharePercent * 8, 100) + '%' }"></div></div>
              <span class="share-num">{{ scope.row.fleetSharePercent }}%</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script>
import BaseChart from '@/components/charts/BaseChart.vue';
import { ensureEcharts, SERIES_COLORS } from '@/components/charts/presets';
import Api from '@/apis/api';

export default {
  name: 'Costs',
  components: { BaseChart },
  data() {
    return {
      range: 'month',
      loading: false,
      kpis: {},
      deltas: {},
      dailySpend: [],
      tokenMix: { outputAudio: 0, inputAudio: 0, text: 0 },
      topDevices: []
    };
  },
  computed: {
    budgetOver() {
      return (this.kpis.budgetUsedPercent || 0) > 100;
    },
    avgResponse() {
      const v = this.kpis.avgResponseTimeSeconds;
      return v === null || v === undefined ? '—' : Math.round(v * 10) / 10;
    },
    tokenMixTotal() {
      return (this.tokenMix.outputAudio || 0) + (this.tokenMix.inputAudio || 0) + (this.tokenMix.text || 0);
    },
    dailySpendOption() {
      return {
        grid: { left: 48, right: 12, top: 28, bottom: 24 },
        tooltip: { trigger: 'axis', valueFormatter: v => `₹${v}` },
        legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11 } },
        xAxis: {
          type: 'category',
          data: this.dailySpend.map(r => r.date),
          axisLabel: { fontSize: 10, color: '#8a8fa3' },
          axisLine: { lineStyle: { color: '#e4e6ef' } },
          axisTick: { show: false }
        },
        yAxis: {
          type: 'value',
          axisLabel: { fontSize: 10, color: '#8a8fa3', formatter: '₹{value}' },
          splitLine: { lineStyle: { color: '#f0f1f7' } }
        },
        series: [
          {
            name: 'Input',
            type: 'bar',
            stack: 'spend',
            data: this.dailySpend.map(r => r.inputCost),
            itemStyle: { color: SERIES_COLORS.card },
            barMaxWidth: 22
          },
          {
            name: 'Output',
            type: 'bar',
            stack: 'spend',
            data: this.dailySpend.map(r => r.outputCost),
            itemStyle: { color: SERIES_COLORS.aiTalk },
            barMaxWidth: 22
          }
        ]
      };
    }
  },
  created() {
    ensureEcharts();
    this.loadCosts();
  },
  methods: {
    fmt(v) {
      if (v === null || v === undefined) return '—';
      return Number(v).toLocaleString('en-IN');
    },
    mixPercent(key) {
      const total = this.tokenMixTotal || 1;
      return Math.round(((this.tokenMix[key] || 0) / total) * 1000) / 10;
    },
    loadCosts() {
      this.loading = true;
      Api.admin.getFounderCosts(this.range, ({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.kpis = data.data.kpis || {};
          this.deltas = data.data.deltas || {};
          this.dailySpend = (data.data.sections && data.data.sections.dailySpend) || [];
          this.tokenMix = (data.data.sections && data.data.sections.tokenMix) || this.tokenMix;
          this.topDevices = (data.data.sections && data.data.sections.topDevices) || [];
        } else {
          this.$message.error(data.msg || 'Failed to load costs');
        }
      });
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.costs-page {
  max-width: 1280px;
}

.costs-header {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.raw-link {
  font-size: 12px;
  color: $primary-dark;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
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

.kpi-label {
  font-size: 11.5px;
  color: $text-gray;
}

.kpi-big {
  font-size: 22px;
  font-weight: 700;
  color: $text-dark;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.kpi-unit {
  font-size: 13px;
  color: $text-gray;
  font-weight: 500;
}

.kpi-sub, .kpi-delta {
  font-size: 11px;
  margin-top: 4px;
  color: $text-gray;

  &.bad { color: #d03b3b; }
  &.good { color: #006300; }
}

.kpi-delta {
  &.bad { color: #d03b3b; }
  &.good { color: #006300; }
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

.card-empty {
  text-align: center;
  color: $text-gray;
  font-size: 12.5px;
  padding: 40px 0;
}

.mix-bar {
  display: flex;
  height: 14px;
  border-radius: 7px;
  overflow: hidden;
  background: #f0f1f7;

  .mix-seg + .mix-seg { border-left: 2px solid #fff; }
}

.mix-legend {
  margin-top: 12px;
}

.mix-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: $text-dark;
  padding: 4px 0;

  b { margin-left: auto; font-variant-numeric: tabular-nums; }
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.footnote {
  margin: 10px 0 0;
  font-size: 11px;
  color: $text-gray;
}

.section-title {
  margin: 4px 0 10px;
  font-size: 14px;
  color: $text-dark;
}

.share-bar {
  display: inline-block;
  width: 90px;
  height: 8px;
  border-radius: 4px;
  background: #f0f1f7;
  overflow: hidden;
  vertical-align: middle;
  margin-right: 8px;

  .share-fill {
    height: 100%;
    background: $primary;
    border-radius: 4px;
  }
}

.share-num {
  font-size: 11.5px;
  color: $text-gray;
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 11.5px;
}

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .two-col { grid-template-columns: 1fr; }
}
</style>
