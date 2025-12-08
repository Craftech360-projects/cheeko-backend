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
            <h4>Gemini 2.5 Flash Native Audio (INR)</h4>
            <div class="pricing-item">
              <span class="label">Text Input:</span>
              <span class="rate">₹41.67/1M</span>
            </div>
            <div class="pricing-item">
              <span class="label">Audio Input:</span>
              <span class="rate">₹250/1M</span>
            </div>
            <div class="pricing-item">
              <span class="label">Text Output:</span>
              <span class="rate">₹166.67/1M</span>
            </div>
            <div class="pricing-item">
              <span class="label">Audio Output:</span>
              <span class="rate">₹1,000/1M</span>
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
          <el-table-column prop="owner_name" label="Owner" min-width="140">
            <template slot-scope="scope">
              <span class="owner-name">{{ scope.row.owner_name || 'Unknown' }}</span>
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
</style>
