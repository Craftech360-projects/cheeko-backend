<template>
  <div class="token-analytics">
    <HeaderBar />
    <el-main class="main-content">
      <!-- Page Title -->
      <div class="page-header">
        <h1>Token Usage Analytics</h1>
        <p class="subtitle">Monitor token consumption, costs, and performance metrics</p>
      </div>

      <!-- Date Range Filter -->
      <el-card class="filter-card" shadow="never">
        <div class="filter-row">
          <span class="filter-label">Date Range:</span>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="to"
            start-placeholder="Start date"
            end-placeholder="End date"
            format="yyyy-MM-dd"
            value-format="yyyy-MM-dd"
            @change="fetchData"
            :picker-options="datePickerOptions"
          />
          <el-button type="primary" @click="fetchData" :loading="isLoading">
            <i class="el-icon-refresh"></i> Refresh
          </el-button>
        </div>
      </el-card>

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
        <el-table
          :data="dailySummary"
          v-loading="isLoading"
          stripe
          style="width: 100%"
        >
          <el-table-column prop="usage_date" label="Date" min-width="120">
            <template slot-scope="scope">
              {{ formatDate(scope.row.usage_date) }}
            </template>
          </el-table-column>
          <el-table-column prop="unique_devices" label="Devices" min-width="80" align="center" />
          <el-table-column prop="total_sessions" label="Sessions" min-width="80" align="center" />
          <el-table-column prop="message_count" label="Messages" min-width="90" align="center" />
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
import Api from '@/apis/api';
import HeaderBar from '@/components/HeaderBar.vue';

export default {
  name: 'TokenAnalytics',
  components: { HeaderBar },
  data() {
    return {
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
        { type: 'input-audio', value: inputAudio, color: '#fa8c16' },
        { type: 'input-text', value: inputText, color: '#1890ff' },
        { type: 'output-audio', value: outputAudio, color: '#52c41a' },
        { type: 'output-text', value: outputText, color: '#722ed1' }
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

.token-analytics {
  min-height: 100vh;
  background: linear-gradient(145deg, #fff5eb, #fff7f0);
}

.main-content {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 20px;

  h1 {
    color: #3d4566;
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 8px 0;
  }

  .subtitle {
    color: #818cae;
    font-size: 14px;
    margin: 0;
  }
}

.filter-card {
  margin-bottom: 20px;
  border-radius: 12px;

  .filter-row {
    display: flex;
    align-items: center;
    gap: 15px;
    flex-wrap: wrap;
  }

  .filter-label {
    font-weight: 500;
    color: #3d4566;
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  border-radius: 12px;
  border: none;

  ::v-deep .el-card__body {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 20px;
  }

  .stat-icon {
    width: 50px;
    height: 50px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;

    &.devices { background: rgba($primary, 0.1); color: $primary; }
    &.sessions { background: rgba(#52c41a, 0.1); color: #52c41a; }
    &.messages { background: rgba(#1890ff, 0.1); color: #1890ff; }
    &.tokens { background: rgba(#722ed1, 0.1); color: #722ed1; }
    &.cost { background: rgba(#fa8c16, 0.1); color: #fa8c16; }
    &.latency { background: rgba(#eb2f96, 0.1); color: #eb2f96; }
  }

  .stat-content {
    flex: 1;
  }

  .stat-value {
    font-size: 24px;
    font-weight: 700;
    color: #3d4566;

    &.cost-value {
      color: #fa8c16;
    }
  }

  .stat-label {
    font-size: 13px;
    color: #818cae;
    margin-top: 4px;
  }
}

.breakdown-card, .table-card {
  border-radius: 12px;
  border: none;
  margin-bottom: 20px;

  .card-header {
    font-size: 16px;
    font-weight: 600;
    color: #3d4566;
  }
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 30px;
}

.breakdown-section {
  h4 {
    color: #3d4566;
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px 0;
    padding-bottom: 8px;
    border-bottom: 2px solid #f0f0f0;
  }

  .breakdown-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 14px;

    .label { color: #818cae; }
    .value {
      font-weight: 500;
      color: #3d4566;

      &.audio { color: #fa8c16; }
      &.text { color: #1890ff; }
    }

    &.total {
      border-top: 1px solid #f0f0f0;
      margin-top: 8px;
      padding-top: 12px;
      font-weight: 600;
    }
  }

  &.pricing {
    background: #fafafa;
    padding: 15px;
    border-radius: 8px;

    .pricing-item {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 13px;

      .label { color: #818cae; }
      .rate {
        color: #fa8c16;
        font-weight: 500;
      }
    }
  }
}

.owner-name {
  font-weight: 500;
  color: #3d4566;
}

.kid-name {
  font-weight: 500;
  color: #409eff;
}

.mac-address {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
}

.cost-cell {
  color: #fa8c16;
  font-weight: 500;
}

::v-deep .el-table {
  border-radius: 8px;

  th {
    background: #fafafa !important;
    color: #3d4566;
    font-weight: 600;
  }
}

/* Charts Section */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.chart-card {
  border-radius: 12px;
  border: none;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .chart-legend {
    display: flex;
    gap: 15px;
    font-size: 12px;

    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      color: #818cae;

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }

      &.input .dot { background: #1890ff; }
      &.output .dot { background: #52c41a; }
    }
  }
}

.bar-chart-container {
  display: flex;
  gap: 10px;
  height: 250px;
  padding: 10px 0;

  .chart-y-axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-size: 11px;
    color: #818cae;
    width: 50px;
    text-align: right;
    padding: 5px 0;
  }
}

.bar-chart {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding-bottom: 25px;
  border-bottom: 1px solid #e8e8e8;
  border-left: 1px solid #e8e8e8;
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
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }

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
    width: 12px;
    border-radius: 3px 3px 0 0;
    transition: height 0.3s ease;
    min-height: 2px;

    &.input-bar {
      background: linear-gradient(180deg, #1890ff, #40a9ff);
    }

    &.output-bar {
      background: linear-gradient(180deg, #52c41a, #73d13d);
    }

    &.cost-bar {
      width: 20px;
      background: linear-gradient(180deg, #fa8c16, #ffa940);
    }
  }

  .bar-label {
    font-size: 10px;
    color: #818cae;
    margin-top: 8px;
    white-space: nowrap;
    transform: rotate(-45deg);
    transform-origin: top left;
    position: absolute;
    bottom: -20px;
  }
}

.no-chart-data {
  height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #bfbfbf;

  i {
    font-size: 48px;
    margin-bottom: 15px;
  }

  p {
    font-size: 14px;
    margin: 0;
  }
}

/* Token Distribution Chart */
.distribution-card {
  border-radius: 12px;
  border: none;
  margin-bottom: 20px;
}

.distribution-container {
  display: flex;
  align-items: center;
  gap: 40px;
  padding: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

.donut-chart {
  position: relative;
  width: 200px;
  height: 200px;

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
      font-size: 12px;
      color: #818cae;
    }

    .total-value {
      display: block;
      font-size: 20px;
      font-weight: 700;
      color: #3d4566;
    }
  }
}

.distribution-legend {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .legend-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;

    .legend-color {
      width: 14px;
      height: 14px;
      border-radius: 3px;

      &.input-audio { background: #fa8c16; }
      &.input-text { background: #1890ff; }
      &.output-audio { background: #52c41a; }
      &.output-text { background: #722ed1; }
    }

    .legend-text {
      color: #3d4566;
      min-width: 100px;
    }

    .legend-value {
      color: #3d4566;
      font-weight: 500;
      min-width: 80px;
      text-align: right;
    }

    .legend-percent {
      color: #818cae;
      min-width: 50px;
      text-align: right;
    }
  }
}

/* Responsive adjustments for charts */
@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .distribution-container {
    flex-direction: column;
  }

  .bar-group {
    min-width: 20px;

    .bar {
      width: 8px;
    }

    .bar.cost-bar {
      width: 14px;
    }
  }
}
</style>
