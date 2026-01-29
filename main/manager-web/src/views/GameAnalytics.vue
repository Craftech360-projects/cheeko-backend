<template>
  <div class="game-analytics">
    <HeaderBar />
    <el-main class="main-content">
      <!-- Page Title -->
      <div class="page-header">
        <h1>Game Analytics Dashboard</h1>
        <p class="subtitle">Monitor learning sessions, game performance, and engagement metrics</p>
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
          <el-button type="success" @click="exportToCsv" :disabled="isLoading">
            <i class="el-icon-download"></i> Export CSV
          </el-button>
        </div>
      </el-card>

      <!-- Overall Stats Cards -->
      <div class="stats-grid">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon sessions"><i class="el-icon-video-play"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatNumber(summary.total_sessions || 0) }}</div>
            <div class="stat-label">Total Sessions</div>
          </div>
        </el-card>

        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon time"><i class="el-icon-time"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatDurationHours(summary.total_time_seconds || 0) }}</div>
            <div class="stat-label">Time Spent</div>
          </div>
        </el-card>

        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon accuracy"><i class="el-icon-success"></i></div>
          <div class="stat-content">
            <div class="stat-value accuracy-value">{{ summary.avg_accuracy || 0 }}%</div>
            <div class="stat-label">Avg Accuracy</div>
          </div>
        </el-card>

        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon devices"><i class="el-icon-cpu"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatNumber(summary.active_device_count || 0) }}</div>
            <div class="stat-label">Active Devices</div>
          </div>
        </el-card>
      </div>

      <!-- Charts Section Row 1 -->
      <div class="charts-grid">
        <!-- Activity Trend Chart -->
        <el-card class="chart-card" shadow="never">
          <div slot="header" class="card-header">
            <span>Activity Trend (Sessions per Day)</span>
          </div>
          <div class="bar-chart-container single-series" v-if="sessionsPerDay.length > 0">
            <div class="chart-y-axis">
              <span>{{ maxDailySessions }}</span>
              <span>{{ Math.round(maxDailySessions / 2) }}</span>
              <span>0</span>
            </div>
            <div class="bar-chart">
              <div
                v-for="(day, index) in activityChartData"
                :key="index"
                class="bar-group single"
                :title="`${day.date}: ${day.sessions} sessions`"
              >
                <div class="bars">
                  <div
                    class="bar session-bar"
                    :style="{ height: getSessionBarHeight(day.sessions) + '%' }"
                  ></div>
                </div>
                <span class="bar-label">{{ day.shortDate }}</span>
              </div>
            </div>
          </div>
          <div v-else class="no-chart-data">
            <i class="el-icon-data-line"></i>
            <p>No session data for selected period</p>
          </div>
        </el-card>

        <!-- Game Performance Chart -->
        <el-card class="chart-card" shadow="never">
          <div slot="header" class="card-header">
            <span>Game Performance (Accuracy by Type)</span>
          </div>
          <div class="game-performance-chart" v-if="hasGameData">
            <div class="game-bar" v-for="(game, key) in gameAccuracy" :key="key">
              <div class="game-info">
                <span class="game-name">{{ formatGameType(key) }}</span>
                <span class="game-stats">{{ game.correct_attempts }}/{{ game.total_attempts }}</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :class="getAccuracyClass(game.accuracy)"
                  :style="{ width: game.accuracy + '%' }"
                ></div>
              </div>
              <span class="accuracy-percent">{{ game.accuracy }}%</span>
            </div>
            <div v-if="Object.keys(gameAccuracy).length === 0" class="no-game-data">
              <p>No game attempts recorded</p>
            </div>
          </div>
          <div v-else class="no-chart-data">
            <i class="el-icon-trophy"></i>
            <p>No game data for selected period</p>
          </div>
        </el-card>
      </div>

      <!-- Charts Section Row 2 -->
      <div class="charts-grid">
        <!-- Difficulty Distribution Pie Chart -->
        <el-card class="chart-card" shadow="never">
          <div slot="header" class="card-header">
            <span>Difficulty Distribution</span>
          </div>
          <div class="distribution-container" v-if="hasDifficultyData">
            <div class="donut-chart">
              <svg viewBox="0 0 100 100" class="donut-svg">
                <circle
                  v-for="(segment, index) in difficultyDistributionChart"
                  :key="index"
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  :stroke="segment.color"
                  stroke-width="15"
                  :stroke-dasharray="segment.dashArray"
                  :stroke-dashoffset="segment.offset"
                  class="donut-segment"
                />
              </svg>
              <div class="donut-center">
                <span class="total-label">Total</span>
                <span class="total-value">{{ totalDifficultyAttempts }}</span>
              </div>
            </div>
            <div class="distribution-legend">
              <div class="legend-row">
                <span class="legend-color easy"></span>
                <span class="legend-text">Easy</span>
                <span class="legend-value">{{ difficultyDistribution.easy?.count || 0 }}</span>
                <span class="legend-percent">{{ getDifficultyPercent('easy') }}%</span>
              </div>
              <div class="legend-row">
                <span class="legend-color medium"></span>
                <span class="legend-text">Medium</span>
                <span class="legend-value">{{ difficultyDistribution.medium?.count || 0 }}</span>
                <span class="legend-percent">{{ getDifficultyPercent('medium') }}%</span>
              </div>
              <div class="legend-row">
                <span class="legend-color hard"></span>
                <span class="legend-text">Hard</span>
                <span class="legend-value">{{ difficultyDistribution.hard?.count || 0 }}</span>
                <span class="legend-percent">{{ getDifficultyPercent('hard') }}%</span>
              </div>
            </div>
          </div>
          <div v-else class="no-chart-data">
            <i class="el-icon-s-data"></i>
            <p>No difficulty data available</p>
          </div>
        </el-card>

        <!-- Response Time Trend Chart -->
        <el-card class="chart-card" shadow="never">
          <div slot="header" class="card-header">
            <span>Response Time Trend (ms)</span>
          </div>
          <div class="bar-chart-container single-series" v-if="ttftTrend.length > 0">
            <div class="chart-y-axis">
              <span>{{ formatMs(maxTtft) }}</span>
              <span>{{ formatMs(maxTtft / 2) }}</span>
              <span>0</span>
            </div>
            <div class="bar-chart">
              <div
                v-for="(day, index) in ttftChartData"
                :key="index"
                class="bar-group single"
                :title="`${day.date}: ${day.avgMs}ms (${day.attempts} attempts)`"
              >
                <div class="bars">
                  <div
                    class="bar ttft-bar"
                    :style="{ height: getTtftBarHeight(day.avgMs) + '%' }"
                  ></div>
                </div>
                <span class="bar-label">{{ day.shortDate }}</span>
              </div>
            </div>
          </div>
          <div v-else class="no-chart-data">
            <i class="el-icon-timer"></i>
            <p>No response time data available</p>
          </div>
        </el-card>
      </div>

      <!-- Top 10 Active Devices Table -->
      <el-card class="table-card" shadow="never">
        <div slot="header" class="card-header">
          <span>Top 10 Active Devices</span>
        </div>
        <el-table
          :data="topDevices"
          v-loading="isLoading"
          stripe
          style="width: 100%"
        >
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="alias" label="Device Alias" min-width="120">
            <template slot-scope="scope">
              <span class="device-alias">{{ scope.row.alias || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="owner_name" label="Owner" min-width="120">
            <template slot-scope="scope">
              <span class="owner-name">{{ scope.row.owner_name || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="mac_address" label="MAC Address" min-width="150">
            <template slot-scope="scope">
              <code class="mac-address">{{ scope.row.mac_address }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="session_count" label="Sessions" min-width="90" align="center" />
          <el-table-column label="Duration" min-width="100" align="center">
            <template slot-scope="scope">
              {{ formatDuration(scope.row.total_duration_seconds) }}
            </template>
          </el-table-column>
          <el-table-column label="Modes" min-width="150">
            <template slot-scope="scope">
              <el-tag
                v-for="mode in scope.row.modes"
                :key="mode"
                size="mini"
                :type="getModeTagType(mode)"
                style="margin-right: 4px; margin-bottom: 4px;"
              >
                {{ mode }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Accuracy" min-width="90" align="center">
            <template slot-scope="scope">
              <span :class="['accuracy-badge', getAccuracyClass(scope.row.accuracy)]">
                {{ scope.row.accuracy }}%
              </span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- Recent Sessions Table -->
      <el-card class="table-card" shadow="never">
        <div slot="header" class="card-header">
          <span>Recent Sessions</span>
          <el-pagination
            v-if="recentSessions.total > 0"
            small
            layout="prev, pager, next"
            :total="recentSessions.total"
            :page-size="recentSessions.limit"
            :current-page="recentSessions.page"
            @current-change="handlePageChange"
          />
        </div>
        <el-table
          :data="recentSessions.list"
          v-loading="isLoading"
          stripe
          style="width: 100%"
        >
          <el-table-column prop="mac_address" label="Device" min-width="150">
            <template slot-scope="scope">
              <code class="mac-address">{{ scope.row.mac_address }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="mode_type" label="Mode" min-width="120">
            <template slot-scope="scope">
              <el-tag size="small" :type="getModeTagType(scope.row.mode_type)">
                {{ scope.row.mode_type }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Duration" min-width="100" align="center">
            <template slot-scope="scope">
              {{ formatDuration(scope.row.duration_seconds) }}
            </template>
          </el-table-column>
          <el-table-column prop="interaction_count" label="Interactions" min-width="100" align="center" />
          <el-table-column prop="completion_status" label="Status" min-width="110">
            <template slot-scope="scope">
              <el-tag size="mini" :type="getStatusTagType(scope.row.completion_status)">
                {{ scope.row.completion_status || 'in-progress' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Started At" min-width="160">
            <template slot-scope="scope">
              {{ formatDateTime(scope.row.started_at) }}
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
  name: 'GameAnalytics',
  components: { HeaderBar },
  data() {
    return {
      isLoading: false,
      dateRange: this.getDefaultDateRange(),
      summary: {},
      sessionsPerDay: [],
      gameAccuracy: {},
      difficultyDistribution: {},
      ttftTrend: [],
      topDevices: [],
      recentSessions: {
        list: [],
        total: 0,
        page: 1,
        limit: 10
      },
      datePickerOptions: {
        shortcuts: [
          {
            text: 'Today',
            onClick(picker) {
              const today = new Date();
              picker.$emit('pick', [today, today]);
            }
          },
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
    hasGameData() {
      return Object.keys(this.gameAccuracy).length > 0;
    },
    hasDifficultyData() {
      return this.totalDifficultyAttempts > 0;
    },
    totalDifficultyAttempts() {
      const d = this.difficultyDistribution;
      return (d.easy?.count || 0) + (d.medium?.count || 0) + (d.hard?.count || 0);
    },
    activityChartData() {
      const data = [...this.sessionsPerDay].slice(-14);
      return data.map(day => ({
        date: this.formatDate(day.date),
        shortDate: this.formatShortDate(day.date),
        sessions: day.session_count || 0
      }));
    },
    maxDailySessions() {
      if (this.activityChartData.length === 0) return 10;
      const max = Math.max(...this.activityChartData.map(d => d.sessions));
      return max || 10;
    },
    ttftChartData() {
      const data = [...this.ttftTrend].slice(-14);
      return data.map(day => ({
        date: this.formatDate(day.date),
        shortDate: this.formatShortDate(day.date),
        avgMs: day.avg_response_time_ms || 0,
        attempts: day.total_attempts || 0
      }));
    },
    maxTtft() {
      if (this.ttftChartData.length === 0) return 1000;
      const max = Math.max(...this.ttftChartData.map(d => d.avgMs));
      return max || 1000;
    },
    difficultyDistributionChart() {
      const total = this.totalDifficultyAttempts;
      if (total === 0) return [];

      const easy = this.difficultyDistribution.easy?.count || 0;
      const medium = this.difficultyDistribution.medium?.count || 0;
      const hard = this.difficultyDistribution.hard?.count || 0;

      const circumference = 2 * Math.PI * 40;
      let offset = 0;

      const segments = [
        { type: 'easy', value: easy, color: '#52c41a' },
        { type: 'medium', value: medium, color: '#faad14' },
        { type: 'hard', value: hard, color: '#f5222d' }
      ].filter(s => s.value > 0);

      return segments.map(segment => {
        const percent = segment.value / total;
        const dashLength = percent * circumference;
        const gapLength = circumference - dashLength;
        const result = {
          ...segment,
          dashArray: `${dashLength} ${gapLength}`,
          offset: -offset + circumference * 0.25
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

      Promise.all([
        this.fetchSummary(params),
        this.fetchSessionsPerDay(params),
        this.fetchGameAccuracy(params),
        this.fetchDifficultyDistribution(params),
        this.fetchTtftTrend(params),
        this.fetchTopDevices(params),
        this.fetchRecentSessions(params)
      ]).finally(() => {
        this.isLoading = false;
      });
    },
    fetchSummary(params) {
      return new Promise((resolve) => {
        Api.analytics.getDashboardSummary(params, (res) => {
          if (res.data && res.data.code === 0) {
            this.summary = res.data.data || {};
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchSessionsPerDay(params) {
      return new Promise((resolve) => {
        Api.analytics.getSessionsPerDay(params, (res) => {
          if (res.data && res.data.code === 0) {
            this.sessionsPerDay = res.data.data || [];
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchGameAccuracy(params) {
      return new Promise((resolve) => {
        Api.analytics.getGameAccuracy(params, (res) => {
          if (res.data && res.data.code === 0) {
            this.gameAccuracy = res.data.data || {};
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchDifficultyDistribution(params) {
      return new Promise((resolve) => {
        Api.analytics.getDifficultyDistribution(params, (res) => {
          if (res.data && res.data.code === 0) {
            this.difficultyDistribution = res.data.data || {};
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchTtftTrend(params) {
      return new Promise((resolve) => {
        Api.analytics.getTtftTrend(params, (res) => {
          if (res.data && res.data.code === 0) {
            this.ttftTrend = res.data.data || [];
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchTopDevices(params) {
      return new Promise((resolve) => {
        Api.analytics.getTopDevices({ ...params, limit: 10 }, (res) => {
          if (res.data && res.data.code === 0) {
            this.topDevices = res.data.data || [];
          }
          resolve();
        }, () => resolve());
      });
    },
    fetchRecentSessions(params) {
      return new Promise((resolve) => {
        const sessionParams = {
          ...params,
          page: this.recentSessions.page,
          limit: this.recentSessions.limit
        };
        Api.analytics.getRecentSessions(sessionParams, (res) => {
          if (res.data && res.data.code === 0) {
            const data = res.data.data || {};
            this.recentSessions.list = data.list || [];
            this.recentSessions.total = data.total || 0;
          }
          resolve();
        }, () => resolve());
      });
    },
    handlePageChange(page) {
      this.recentSessions.page = page;
      const params = {};
      if (this.dateRange && this.dateRange.length === 2) {
        params.startDate = this.dateRange[0];
        params.endDate = this.dateRange[1];
      }
      this.fetchRecentSessions(params);
    },
    formatNumber(num) {
      if (num === null || num === undefined) return '0';
      return num.toLocaleString();
    },
    formatDurationHours(seconds) {
      if (!seconds) return '0h';
      const hours = seconds / 3600;
      if (hours < 1) {
        const mins = Math.round(seconds / 60);
        return `${mins}m`;
      }
      return hours.toFixed(1) + 'h';
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
    formatDateTime(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-IN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },
    formatMs(ms) {
      if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
      return Math.round(ms) + 'ms';
    },
    formatGameType(type) {
      const typeMap = {
        'math_tutor': 'Math Tutor',
        'riddle_solver': 'Riddle Solver',
        'word_ladder': 'Word Ladder'
      };
      return typeMap[type] || type;
    },
    getSessionBarHeight(value) {
      if (this.maxDailySessions === 0) return 0;
      return Math.max(2, (value / this.maxDailySessions) * 100);
    },
    getTtftBarHeight(value) {
      if (this.maxTtft === 0) return 0;
      return Math.max(2, (value / this.maxTtft) * 100);
    },
    getDifficultyPercent(level) {
      const total = this.totalDifficultyAttempts;
      if (total === 0) return 0;
      const count = this.difficultyDistribution[level]?.count || 0;
      return ((count / total) * 100).toFixed(1);
    },
    getAccuracyClass(accuracy) {
      if (accuracy >= 80) return 'high';
      if (accuracy >= 60) return 'medium';
      return 'low';
    },
    getModeTagType(mode) {
      const modeTypes = {
        'Math': 'primary',
        'Riddle': 'success',
        'WordLadder': 'warning',
        'Music': 'info',
        'Story': 'danger',
        'Conversation': ''
      };
      return modeTypes[mode] || '';
    },
    getStatusTagType(status) {
      const statusTypes = {
        'completed': 'success',
        'victory': 'success',
        'interrupted': 'warning',
        'switched': 'info',
        'failure': 'danger'
      };
      return statusTypes[status] || 'info';
    },
    exportToCsv() {
      const rows = [];

      // Summary section
      rows.push(['=== Game Analytics Summary ===']);
      rows.push(['Date Range', this.dateRange ? `${this.dateRange[0]} to ${this.dateRange[1]}` : 'All time']);
      rows.push(['Total Sessions', this.summary.total_sessions || 0]);
      rows.push(['Total Time (seconds)', this.summary.total_time_seconds || 0]);
      rows.push(['Avg Accuracy (%)', this.summary.avg_accuracy || 0]);
      rows.push(['Active Devices', this.summary.active_device_count || 0]);
      rows.push([]);

      // Game accuracy section
      rows.push(['=== Game Accuracy by Type ===']);
      rows.push(['Game Type', 'Total Attempts', 'Correct Attempts', 'Accuracy (%)']);
      Object.entries(this.gameAccuracy).forEach(([type, data]) => {
        rows.push([this.formatGameType(type), data.total_attempts, data.correct_attempts, data.accuracy]);
      });
      rows.push([]);

      // Top devices section
      rows.push(['=== Top Active Devices ===']);
      rows.push(['Rank', 'Device Alias', 'Owner', 'MAC Address', 'Sessions', 'Duration (s)', 'Accuracy (%)']);
      this.topDevices.forEach((device, index) => {
        rows.push([
          index + 1,
          device.alias || '-',
          device.owner_name || '-',
          device.mac_address,
          device.session_count,
          device.total_duration_seconds,
          device.accuracy
        ]);
      });

      // Convert to CSV
      const csvContent = rows.map(row => row.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `game-analytics-${this.dateRange[0]}-to-${this.dateRange[1]}.csv`;
      link.click();
    }
  }
};
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.game-analytics {
  min-height: 100vh;
  background: linear-gradient(145deg, #f0f7ff, #f5faff);
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

    &.sessions { background: rgba(#1890ff, 0.1); color: #1890ff; }
    &.time { background: rgba(#722ed1, 0.1); color: #722ed1; }
    &.accuracy { background: rgba(#52c41a, 0.1); color: #52c41a; }
    &.devices { background: rgba($primary, 0.1); color: $primary; }
  }

  .stat-content {
    flex: 1;
  }

  .stat-value {
    font-size: 24px;
    font-weight: 700;
    color: #3d4566;

    &.accuracy-value {
      color: #52c41a;
    }
  }

  .stat-label {
    font-size: 13px;
    color: #818cae;
    margin-top: 4px;
  }
}

.table-card, .chart-card {
  border-radius: 12px;
  border: none;
  margin-bottom: 20px;

  .card-header {
    font-size: 16px;
    font-weight: 600;
    color: #3d4566;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

/* Bar Chart Styles */
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
    width: 20px;
    border-radius: 3px 3px 0 0;
    transition: height 0.3s ease;
    min-height: 2px;

    &.session-bar {
      background: linear-gradient(180deg, #1890ff, #40a9ff);
    }

    &.ttft-bar {
      background: linear-gradient(180deg, #722ed1, #9254de);
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

/* Game Performance Chart */
.game-performance-chart {
  padding: 20px 0;

  .game-bar {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 20px;

    .game-info {
      width: 140px;

      .game-name {
        display: block;
        font-weight: 500;
        color: #3d4566;
        font-size: 14px;
      }

      .game-stats {
        font-size: 12px;
        color: #818cae;
      }
    }

    .bar-track {
      flex: 1;
      height: 24px;
      background: #f0f0f0;
      border-radius: 12px;
      overflow: hidden;

      .bar-fill {
        height: 100%;
        border-radius: 12px;
        transition: width 0.5s ease;

        &.high { background: linear-gradient(90deg, #52c41a, #73d13d); }
        &.medium { background: linear-gradient(90deg, #faad14, #ffc53d); }
        &.low { background: linear-gradient(90deg, #f5222d, #ff4d4f); }
      }
    }

    .accuracy-percent {
      width: 50px;
      font-weight: 600;
      color: #3d4566;
      text-align: right;
    }
  }

  .no-game-data {
    text-align: center;
    color: #818cae;
    padding: 40px;
  }
}

/* Difficulty Distribution */
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
  width: 180px;
  height: 180px;

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

      &.easy { background: #52c41a; }
      &.medium { background: #faad14; }
      &.hard { background: #f5222d; }
    }

    .legend-text {
      color: #3d4566;
      min-width: 60px;
    }

    .legend-value {
      color: #3d4566;
      font-weight: 500;
      min-width: 50px;
      text-align: right;
    }

    .legend-percent {
      color: #818cae;
      min-width: 50px;
      text-align: right;
    }
  }
}

/* Table Styles */
.device-alias {
  font-weight: 500;
  color: #1890ff;
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

.accuracy-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
  font-size: 12px;

  &.high {
    background: rgba(#52c41a, 0.1);
    color: #52c41a;
  }
  &.medium {
    background: rgba(#faad14, 0.1);
    color: #d48806;
  }
  &.low {
    background: rgba(#f5222d, 0.1);
    color: #f5222d;
  }
}

::v-deep .el-table {
  border-radius: 8px;

  th {
    background: #fafafa !important;
    color: #3d4566;
    font-weight: 600;
  }
}

/* Responsive */
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
      width: 14px;
    }
  }

  .game-performance-chart .game-bar {
    flex-wrap: wrap;

    .game-info {
      width: 100%;
      margin-bottom: 5px;
    }

    .bar-track {
      flex: 1;
      min-width: 150px;
    }
  }
}
</style>
