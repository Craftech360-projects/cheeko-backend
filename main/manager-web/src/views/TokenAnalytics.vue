<template>
  <div class="token-analytics">
    <el-main class="main-content">
      <div class="page-head">
        <div>
          <h1 class="page-title">Raw Tokens</h1>
          <p class="page-lead">Unattributed token and latency detail, straight from the agent logs.</p>
        </div>
        <div class="page-actions">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            size="small"
            range-separator="to"
            start-placeholder="Start date"
            end-placeholder="End date"
            format="yyyy-MM-dd"
            value-format="yyyy-MM-dd"
            @change="fetchData"
            :picker-options="datePickerOptions"
          />
          <el-button size="small" @click="fetchData" :loading="isLoading">Refresh</el-button>
        </div>
      </div>

      <!-- Overall Stats Cards -->
      <div class="stats-grid">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon devices"><i class="el-icon-cpu"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatNumber(overallTotals.unique_devices || 0) }}</div>
            <div class="stat-label">Total Devices</div>
          </div>
        </el-card>

        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon sessions"><i class="el-icon-connection"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatNumber(overallTotals.total_sessions || 0) }}</div>
            <div class="stat-label">Total Sessions</div>
          </div>
        </el-card>

        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon messages"><i class="el-icon-chat-dot-round"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatNumber(overallTotals.total_messages || 0) }}</div>
            <div class="stat-label">Total Messages</div>
          </div>
        </el-card>

        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon tokens"><i class="el-icon-coin"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatTokens(totalTokens) }}</div>
            <div class="stat-label">Total Tokens</div>
          </div>
        </el-card>

        <el-card class="stat-card cost" shadow="hover">
          <div class="stat-icon cost"><i class="el-icon-money"></i></div>
          <div class="stat-content">
            <div class="stat-value cost-value">₹{{ formatCost(overallTotals.cost_inr || 0) }}</div>
            <div class="stat-label">Total Cost (INR)</div>
          </div>
        </el-card>

        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon latency"><i class="el-icon-timer"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatLatency(overallTotals.avg_ttft_seconds || 0) }}</div>
            <div class="stat-label">Avg Latency (TTFT)</div>
          </div>
        </el-card>
      </div>

      <!-- Token Breakdown -->
      <el-card class="breakdown-card" shadow="never">
        <div slot="header" class="card-header">
          <span>Token Breakdown</span>
        </div>
        <div class="breakdown-grid">
          <div class="breakdown-section">
            <h4>Input Tokens</h4>
            <div class="breakdown-item">
              <span class="label">Audio:</span>
              <span class="value audio">{{ formatTokens(overallTotals.input_audio_tokens || 0) }}</span>
            </div>
            <div class="breakdown-item">
              <span class="label">Text:</span>
              <span class="value text">{{ formatTokens(overallTotals.input_text_tokens || 0) }}</span>
            </div>
            <div class="breakdown-item total">
              <span class="label">Total Input:</span>
              <span class="value">{{ formatTokens(overallTotals.input_tokens || 0) }}</span>
            </div>
          </div>
          <div class="breakdown-section">
            <h4>Output Tokens</h4>
            <div class="breakdown-item">
              <span class="label">Audio:</span>
              <span class="value audio">{{ formatTokens(overallTotals.output_audio_tokens || 0) }}</span>
            </div>
            <div class="breakdown-item">
              <span class="label">Text:</span>
              <span class="value text">{{ formatTokens(overallTotals.output_text_tokens || 0) }}</span>
            </div>
            <div class="breakdown-item total">
              <span class="label">Total Output:</span>
              <span class="value">{{ formatTokens(overallTotals.output_tokens || 0) }}</span>
            </div>
          </div>
          <div class="breakdown-section pricing">
            <h4>Gemini Pricing (INR)</h4>
            <div class="pricing-item">
              <span class="label">Text Input:</span>
              <span class="rate">₹46/1M</span>
            </div>
            <div class="pricing-item">
              <span class="label">Audio Input:</span>
              <span class="rate">₹276/1M</span>
            </div>
            <div class="pricing-item">
              <span class="label">Text Output:</span>
              <span class="rate">₹184/1M</span>
            </div>
            <div class="pricing-item">
              <span class="label">Audio Output:</span>
              <span class="rate">₹1,104/1M</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- Charts Section -->
      <div class="charts-grid">
        <!-- Daily Token Usage Chart -->
        <el-card class="chart-card" shadow="never">
          <div slot="header" class="card-header">
            <span>Daily Token Usage</span>
            <span class="chart-legend">
              <span class="legend-item input"><span class="dot"></span> Input</span>
              <span class="legend-item output"><span class="dot"></span> Output</span>
            </span>
          </div>
          <div class="bar-chart-container" v-if="dailySummary.length > 0">
            <div class="chart-y-axis">
              <span>{{ formatTokensShort(maxDailyTokens) }}</span>
              <span>{{ formatTokensShort(maxDailyTokens / 2) }}</span>
              <span>0</span>
            </div>
            <div class="bar-chart">
              <div
                v-for="(day, index) in chartData"
                :key="index"
                class="bar-group"
                :title="`${day.date}: Input ${formatTokens(day.input)} / Output ${formatTokens(day.output)}`"
              >
                <div class="bars">
                  <div
                    class="bar input-bar"
                    :style="{ height: getBarHeight(day.input) + '%' }"
                  ></div>
                  <div
                    class="bar output-bar"
                    :style="{ height: getBarHeight(day.output) + '%' }"
                  ></div>
                </div>
                <span class="bar-label">{{ day.shortDate }}</span>
              </div>
            </div>
          </div>
          <div v-else class="no-chart-data">
            <i class="el-icon-data-analysis"></i>
            <p>No data available for selected period</p>
          </div>
        </el-card>

        <!-- Daily Cost Trend Chart -->
        <el-card class="chart-card" shadow="never">
          <div slot="header" class="card-header">
            <span>Daily Cost Trend (INR)</span>
          </div>
          <div class="bar-chart-container single-series" v-if="dailySummary.length > 0">
            <div class="chart-y-axis">
              <span>₹{{ formatCostShort(maxDailyCost) }}</span>
              <span>₹{{ formatCostShort(maxDailyCost / 2) }}</span>
              <span>₹0</span>
            </div>
            <div class="bar-chart">
              <div
                v-for="(day, index) in chartData"
                :key="index"
                class="bar-group single"
                :title="`${day.date}: ₹${formatCost(day.cost)}`"
              >
                <div class="bars">
                  <div
                    class="bar cost-bar"
                    :style="{ height: getCostBarHeight(day.cost) + '%' }"
                  ></div>
                </div>
                <span class="bar-label">{{ day.shortDate }}</span>
              </div>
            </div>
          </div>
          <div v-else class="no-chart-data">
            <i class="el-icon-money"></i>
            <p>No data available for selected period</p>
          </div>
        </el-card>
      </div>

      <!-- Token Distribution Chart -->
      <el-card class="distribution-card" shadow="never" v-if="hasTokenData">
        <div slot="header" class="card-header">
          <span>Token Distribution</span>
        </div>
        <div class="distribution-container">
          <div class="donut-chart">
            <svg viewBox="0 0 100 100" class="donut-svg">
              <circle
                v-for="(segment, index) in tokenDistribution"
                :key="index"
                cx="50"
                cy="50"
                r="40"
                fill="none"
                :stroke="segment.color"
                stroke-width="15"
                :stroke-dasharray="segment.dashArray"
                :stroke-dashoffset="segment.offset"
                :class="['donut-segment', segment.type]"
              />
            </svg>
            <div class="donut-center">
              <span class="total-label">Total</span>
              <span class="total-value">{{ formatTokens(totalTokens) }}</span>
            </div>
          </div>
          <div class="distribution-legend">
            <div class="legend-row">
              <span class="legend-color input-audio"></span>
              <span class="legend-text">Input Audio</span>
              <span class="legend-value">{{ formatTokens(overallTotals.input_audio_tokens || 0) }}</span>
              <span class="legend-percent">{{ getPercent(overallTotals.input_audio_tokens) }}%</span>
            </div>
            <div class="legend-row">
              <span class="legend-color input-text"></span>
              <span class="legend-text">Input Text</span>
              <span class="legend-value">{{ formatTokens(overallTotals.input_text_tokens || 0) }}</span>
              <span class="legend-percent">{{ getPercent(overallTotals.input_text_tokens) }}%</span>
            </div>
            <div class="legend-row">
              <span class="legend-color output-audio"></span>
              <span class="legend-text">Output Audio</span>
              <span class="legend-value">{{ formatTokens(overallTotals.output_audio_tokens || 0) }}</span>
              <span class="legend-percent">{{ getPercent(overallTotals.output_audio_tokens) }}%</span>
            </div>
            <div class="legend-row">
              <span class="legend-color output-text"></span>
              <span class="legend-text">Output Text</span>
              <span class="legend-value">{{ formatTokens(overallTotals.output_text_tokens || 0) }}</span>
              <span class="legend-percent">{{ getPercent(overallTotals.output_text_tokens) }}%</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- Daily Summary Table -->
      <el-card class="table-card" shadow="never">
        <div slot="header" class="card-header">
          <span>Daily Usage Summary</span>
        </div>
        <ListToolbar
          :count="dailySummary.length"
          count-noun="days"
          :total="dailySummary.length"
          :sort-options="sortOptions"
          :sort-by.sync="sortBy"
          :sort-dir.sync="sortDir"
          :selecting.sync="selecting"
          :selected-count="selectedCount"
          :all-selected="allSelected"
          :search.sync="listSearch"
          search-placeholder="Filter by date"
          @select-all-matching="selectAllMatching"
          @clear-selection="clearSelection"
        />
        <el-table
          ref="table"
          :data="visibleRows"
          v-loading="isLoading"
          style="width: 100%"
          :row-class-name="rowClass"
          @sort-change="onTableSortChange"
          @selection-change="onSelectionChange"
        >
          <el-table-column v-if="selecting" type="selection" width="44" />
          <el-table-column prop="usage_date" label="Date" min-width="130" sortable="custom">
            <template slot-scope="scope">
              {{ formatDate(scope.row.usage_date) }}
            </template>
          </el-table-column>
          <el-table-column prop="unique_devices" label="Devices" min-width="90" align="right" sortable="custom" />
          <el-table-column prop="total_sessions" label="Sessions" min-width="95" align="right" sortable="custom" />
          <el-table-column prop="message_count" label="Messages" min-width="100" align="right" sortable="custom" />
          <el-table-column label="Input Tokens" min-width="120" align="right">
            <template slot-scope="scope">
              {{ formatTokens(scope.row.input_tokens) }}
            </template>
          </el-table-column>
          <el-table-column label="Output Tokens" min-width="120" align="right">
            <template slot-scope="scope">
              {{ formatTokens(scope.row.output_tokens) }}
            </template>
          </el-table-column>
          <el-table-column label="Avg Duration" min-width="100" align="center">
            <template slot-scope="scope">
              {{ formatDuration(scope.row.avg_duration_seconds) }}
            </template>
          </el-table-column>
          <el-table-column label="Avg Latency" min-width="100" align="center">
            <template slot-scope="scope">
              {{ formatLatency(scope.row.avg_ttft_seconds) }}
            </template>
          </el-table-column>
          <el-table-column label="Cost (INR)" min-width="100" align="right">
            <template slot-scope="scope">
              <span class="cost-cell">₹{{ formatCost(scope.row.cost_inr) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- Per-Device Usage Table -->
      <el-card class="table-card" shadow="never">
        <div slot="header" class="card-header">
          <span>Per-Device Daily Usage</span>
        </div>
        <el-table
          :data="perDeviceUsage"
          v-loading="isLoading"
          stripe
          style="width: 100%"
        >
          <el-table-column prop="owner_name" label="Parent" min-width="120">
            <template slot-scope="scope">
              <span class="owner-name">{{ scope.row.owner_name || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="kid_name" label="Kid" min-width="100">
            <template slot-scope="scope">
              <span class="kid-name">{{ scope.row.kid_name || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="mac_address" label="Device MAC" min-width="150">
            <template slot-scope="scope">
              <code class="mac-address">{{ scope.row.mac_address }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="usage_date" label="Date" min-width="110">
            <template slot-scope="scope">
              {{ formatDate(scope.row.usage_date) }}
            </template>
          </el-table-column>
          <el-table-column prop="session_count" label="Sessions" min-width="80" align="center" />
          <el-table-column prop="message_count" label="Messages" min-width="90" align="center" />
          <el-table-column label="Input Tokens" min-width="110" align="right">
            <template slot-scope="scope">
              {{ formatTokens(scope.row.input_tokens) }}
            </template>
          </el-table-column>
          <el-table-column label="Output Tokens" min-width="110" align="right">
            <template slot-scope="scope">
              {{ formatTokens(scope.row.output_tokens) }}
            </template>
          </el-table-column>
          <el-table-column label="Duration" min-width="90" align="center">
            <template slot-scope="scope">
              {{ formatDuration(scope.row.total_duration_seconds) }}
            </template>
          </el-table-column>
          <el-table-column label="Latency" min-width="80" align="center">
            <template slot-scope="scope">
              {{ formatLatency(scope.row.avg_ttft_seconds) }}
            </template>
          </el-table-column>
          <el-table-column label="Cost" min-width="90" align="right">
            <template slot-scope="scope">
              <span class="cost-cell">₹{{ formatCost(scope.row.cost_inr) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </el-main>
  </div>
</template>

<script>
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';
import Api from '@/apis/api';
import { SERIES_COLORS } from '@/components/charts/presets';

export default {
  name: 'TokenAnalytics',
  mixins: [listControls],
  components: { ListToolbar, },
  data() {
    return {
      // list controls
      sortBy: 'usage_date',
      rowKey: 'usage_date',
      searchFields: ['usage_date'],
      sortDir: 'desc',
      sortOptions: [
        { label: 'Date', value: 'usage_date' },
        { label: 'Sessions', value: 'total_sessions' },
        { label: 'Cost', value: 'cost_inr' },
        { label: 'Devices', value: 'unique_devices' }
      ],
      groupOptions: [{ label: 'None', value: '' }],

      isLoading: false,
      dateRange: this.getDefaultDateRange(),
      overallTotals: {},
      dailySummary: [],
      perDeviceUsage: [],
      datePickerOptions: {
        shortcuts: [
          {
            text: 'Last 7 days',
            onClick(picker) {
              const end = new Date();
              const start = new Date();
              start.setTime(start.getTime() - 3600 * 1000 * 24 * 7);
              picker.$emit('pick', [start, end]);
            }
          },
          {
            text: 'Last 30 days',
            onClick(picker) {
              const end = new Date();
              const start = new Date();
              start.setTime(start.getTime() - 3600 * 1000 * 24 * 30);
              picker.$emit('pick', [start, end]);
            }
          },
          {
            text: 'This month',
            onClick(picker) {
              const end = new Date();
              const start = new Date(end.getFullYear(), end.getMonth(), 1);
              picker.$emit('pick', [start, end]);
            }
          }
        ]
      }
    };
  },
  computed: {
    sourceRows() {
      return this.dailySummary || [];
    },
    totalTokens() {
      return (this.overallTotals.input_tokens || 0) + (this.overallTotals.output_tokens || 0);
    },
    hasTokenData() {
      return this.totalTokens > 0;
    },
    chartData() {
      // Limit to last 14 days for better readability
      const data = [...this.dailySummary].slice(-14);
      return data.map(day => ({
        date: this.formatDate(day.usage_date),
        shortDate: this.formatShortDate(day.usage_date),
        input: day.input_tokens || 0,
        output: day.output_tokens || 0,
        cost: parseFloat(day.cost_inr) || 0
      }));
    },
    maxDailyTokens() {
      if (this.chartData.length === 0) return 100;
      const max = Math.max(...this.chartData.map(d => Math.max(d.input, d.output)));
      return max || 100;
    },
    maxDailyCost() {
      if (this.chartData.length === 0) return 10;
      const max = Math.max(...this.chartData.map(d => d.cost));
      return max || 10;
    },
    tokenDistribution() {
      const total = this.totalTokens;
      if (total === 0) return [];

      const inputAudio = this.overallTotals.input_audio_tokens || 0;
      const inputText = this.overallTotals.input_text_tokens || 0;
      const outputAudio = this.overallTotals.output_audio_tokens || 0;
      const outputText = this.overallTotals.output_text_tokens || 0;

      const circumference = 2 * Math.PI * 40; // r=40
      let offset = 0;

      const segments = [
        { type: 'input-audio', value: inputAudio, color: SERIES_COLORS.aiTalk },
        { type: 'input-text', value: inputText, color: SERIES_COLORS.card },
        { type: 'output-audio', value: outputAudio, color: SERIES_COLORS.radio },
        { type: 'output-text', value: outputText, color: SERIES_COLORS.game }
      ].filter(s => s.value > 0);

      return segments.map(segment => {
        const percent = segment.value / total;
        const dashLength = percent * circumference;
        const gapLength = circumference - dashLength;
        const result = {
          ...segment,
          dashArray: `${dashLength} ${gapLength}`,
          offset: -offset + circumference * 0.25 // Start from top
        };
        offset += dashLength;
        return result;
      });
    }
  },
  mounted() {
    this.fetchData();
  },
  methods: {
    getDefaultDateRange() {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      return [
        this.formatDateForApi(start),
        this.formatDateForApi(end)
      ];
    },
    formatDateForApi(date) {
      const d = new Date(date);
      return d.toISOString().split('T')[0];
    },
    fetchData() {
      this.isLoading = true;
      const params = {};
      if (this.dateRange && this.dateRange.length === 2) {
        params.startDate = this.dateRange[0];
        params.endDate = this.dateRange[1];
      }

      // Fetch all data in parallel
      Promise.all([
        this.fetchOverallTotals(),
        this.fetchDailySummary(params),
        this.fetchPerDeviceUsage(params)
      ]).finally(() => {
        this.isLoading = false;
      });
    },
    fetchOverallTotals() {
      return new Promise((resolve) => {
        Api.analytics.getOverallTotals((res) => {
          if (res.data && res.data.code === 0) {
            this.overallTotals = res.data.data || {};
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchDailySummary(params) {
      return new Promise((resolve) => {
        Api.analytics.getDailySummary(params, (res) => {
          if (res.data && res.data.code === 0) {
            this.dailySummary = res.data.data || [];
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchPerDeviceUsage(params) {
      return new Promise((resolve) => {
        Api.analytics.getPerDeviceDailyUsage(params, (res) => {
          if (res.data && res.data.code === 0) {
            this.perDeviceUsage = res.data.data || [];
          }
          resolve();
        }, () => resolve());
      });
    },
    formatNumber(num) {
      if (num === null || num === undefined) return '0';
      return num.toLocaleString();
    },
    formatTokens(tokens) {
      if (tokens === null || tokens === undefined) return '0';
      if (tokens >= 1000000) {
        return (tokens / 1000000).toFixed(2) + 'M';
      } else if (tokens >= 1000) {
        return (tokens / 1000).toFixed(1) + 'K';
      }
      return tokens.toLocaleString();
    },
    formatCost(cost) {
      if (cost === null || cost === undefined) return '0.00';
      return parseFloat(cost).toFixed(2);
    },
    formatLatency(seconds) {
      if (seconds === null || seconds === undefined || seconds === 0) return '-';
      if (seconds < 1) {
        return (seconds * 1000).toFixed(0) + 'ms';
      }
      return seconds.toFixed(2) + 's';
    },
    formatDuration(seconds) {
      if (seconds === null || seconds === undefined || seconds === 0) return '-';
      if (seconds < 60) {
        return seconds.toFixed(0) + 's';
      }
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    },
    formatDate(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    },
    formatShortDate(dateStr) {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-IN', {
        month: 'short',
        day: 'numeric'
      });
    },
    formatTokensShort(tokens) {
      if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
      if (tokens >= 1000) return (tokens / 1000).toFixed(0) + 'K';
      return Math.round(tokens).toString();
    },
    formatCostShort(cost) {
      if (cost >= 1000) return (cost / 1000).toFixed(1) + 'K';
      return cost.toFixed(0);
    },
    getBarHeight(value) {
      if (this.maxDailyTokens === 0) return 0;
      return Math.max(2, (value / this.maxDailyTokens) * 100);
    },
    getCostBarHeight(value) {
      if (this.maxDailyCost === 0) return 0;
      return Math.max(2, (value / this.maxDailyCost) * 100);
    },
    getPercent(value) {
      if (this.totalTokens === 0) return 0;
      return ((value || 0) / this.totalTokens * 100).toFixed(1);
    }
  }
};
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

// Warm monochrome, one accent. Structure comes from 1px rules; the only
// colour is the four-way chart palette, which genuinely needs four marks.
.token-analytics {
  min-height: 0;
}

.main-content {
  padding: 0;
  max-width: 1400px;
  margin: 0 auto;
}

// ---------- KPI row -------------------------------------------------------
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.stat-card {
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;

  ::v-deep .el-card__body {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 20px 22px;
  }

  .stat-icon {
    flex: 0 0 auto;
    margin-top: 3px;
    font-size: 14px;
    color: $text-light;
  }

  .stat-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column-reverse;
  }

  .stat-value {
    font-family: $font-display;
    font-size: 32px;
    font-weight: 400;
    line-height: 1;
    letter-spacing: -0.03em;
    color: $text-dark;

    &.cost-value {
      color: $text-dark;
    }
  }

  .stat-label {
    margin-bottom: 12px;
    font-family: $font-mono;
    font-size: 9.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: $text-light;
  }
}

// ---------- Cards ---------------------------------------------------------
.breakdown-card,
.table-card,
.chart-card,
.distribution-card {
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  margin-bottom: 14px;

  ::v-deep .el-card__header {
    padding: 16px 22px;
    border-bottom: 1px solid $divider-color;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13.5px;
    font-weight: 590;
    letter-spacing: -0.01em;
    color: $text-dark;
  }
}

// ds.scss strips the body padding off every `shadow="never"` card so a table
// can sit flush to the rule. These three hold prose and charts, not a table,
// so they take it back. The `.el-card` in the selector is what outranks it.
.breakdown-card.el-card,
.chart-card.el-card,
.distribution-card.el-card {
  ::v-deep > .el-card__body {
    padding: 20px 22px;
  }
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 28px;
}

.breakdown-section {
  h4 {
    margin: 0 0 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid $border-color;
    font-family: $font-mono;
    font-size: 9.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: $text-light;
  }

  .breakdown-item {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 0;
    font-size: 12.5px;

    .label { color: $text-gray; }

    .value {
      font-family: $font-mono;
      font-size: 12px;
      color: $text-body;
    }

    &.total {
      border-top: 1px solid $divider-color;
      margin-top: 8px;
      padding-top: 12px;

      .label { color: $text-dark; font-weight: 550; }
      .value { color: $text-dark; font-weight: 550; }
    }
  }

  &.pricing {
    background: $surface-sunk;
    border: 1px solid $divider-color;
    border-radius: $radius-md;
    padding: 16px 18px;

    h4 { border-bottom-color: $border-color; }

    .pricing-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
      font-size: 12.5px;

      .label { color: $text-gray; }

      .rate {
        font-family: $font-mono;
        font-size: 12px;
        color: $text-body;
      }
    }
  }
}

// ---------- Table cells ---------------------------------------------------
.owner-name {
  color: $text-dark;
}

.kid-name {
  color: $text-body;
}

.mac-address {
  font-family: $font-mono;
  font-size: 11px;
  color: $text-gray;
  background: transparent;
  padding: 0;
}

.cost-cell {
  font-family: $font-mono;
  color: $text-dark;
}

// ---------- Bar charts ----------------------------------------------------
.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.chart-legend {
  display: flex;
  gap: 14px;
  font-family: $font-mono;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.1em;

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    color: $text-light;

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 2px;
    }

    &.input .dot { background: $text-dark; }
    &.output .dot { background: $primary; }
  }
}

.bar-chart-container {
  display: flex;
  gap: 12px;
  height: 250px;
  padding: 6px 0;

  .chart-y-axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 54px;
    padding: 4px 0;
    text-align: right;
    font-family: $font-mono;
    font-size: 9.5px;
    color: $text-light;
  }
}

.bar-chart {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding-bottom: 25px;
  border-bottom: 1px solid $border-color;
  border-left: 1px solid $border-color;
  position: relative;
  overflow-x: auto;
}

.bar-group {
  flex: 1;
  min-width: 30px;
  max-width: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: default;
  transition: opacity 0.2s;

  &:hover { opacity: 0.72; }

  .bars {
    display: flex;
    gap: 2px;
    align-items: flex-end;
    height: 200px;
  }

  &.single .bars {
    justify-content: center;
  }

  .bar {
    width: 11px;
    border-radius: 2px 2px 0 0;
    transition: height 0.3s ease;
    min-height: 2px;

    &.input-bar { background: $text-dark; }
    &.output-bar { background: $primary; }

    &.cost-bar {
      width: 18px;
      background: $primary;
    }
  }

  .bar-label {
    position: absolute;
    bottom: -20px;
    margin-top: 8px;
    font-family: $font-mono;
    font-size: 9px;
    color: $text-light;
    white-space: nowrap;
    transform: rotate(-45deg);
    transform-origin: top left;
  }
}

.no-chart-data {
  height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: $text-light;

  i { font-size: 24px; }

  p {
    margin: 0;
    font-size: 12.5px;
  }
}

// ---------- Token distribution -------------------------------------------
.distribution-container {
  display: flex;
  align-items: center;
  gap: 48px;
  padding: 12px 4px;
  flex-wrap: wrap;
  justify-content: center;
}

.donut-chart {
  position: relative;
  width: 190px;
  height: 190px;

  .donut-svg {
    transform: rotate(-90deg);
    width: 100%;
    height: 100%;
  }

  .donut-segment {
    transition: stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease;
  }

  .donut-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;

    .total-label {
      display: block;
      font-family: $font-mono;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.11em;
      color: $text-light;
    }

    .total-value {
      display: block;
      margin-top: 6px;
      font-family: $font-display;
      font-size: 24px;
      font-weight: 400;
      letter-spacing: -0.02em;
      color: $text-dark;
    }
  }
}

.distribution-legend {
  display: flex;
  flex-direction: column;

  .legend-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 0;
    font-size: 12.5px;

    & + .legend-row {
      border-top: 1px solid $divider-color;
    }

    .legend-color {
      width: 8px;
      height: 8px;
      border-radius: 2px;

      &.input-audio { background: #B3560F; }
      &.input-text { background: #2C5B7A; }
      &.output-audio { background: #8A5D06; }
      &.output-text { background: #5C6B4A; }
    }

    .legend-text {
      color: $text-body;
      min-width: 104px;
    }

    .legend-value {
      font-family: $font-mono;
      font-size: 12px;
      color: $text-dark;
      min-width: 80px;
      text-align: right;
    }

    .legend-percent {
      font-family: $font-mono;
      font-size: 11px;
      color: $text-light;
      min-width: 48px;
      text-align: right;
    }
  }
}

@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .distribution-container {
    flex-direction: column;
    gap: 24px;
  }

  .bar-group {
    min-width: 20px;

    .bar { width: 8px; }

    .bar.cost-bar { width: 13px; }
  }
}
</style>
