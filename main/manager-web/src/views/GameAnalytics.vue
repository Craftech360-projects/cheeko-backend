<template>
  <div class="game-analytics">
    <el-main class="main-content">
      <div class="page-head">
        <div>
          <h1 class="page-title">Game Analytics</h1>
          <p class="page-lead">Mode-by-mode play volume, accuracy and abandonment.</p>
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
          <el-button size="small" @click="exportToCsv" :disabled="isLoading">Export CSV</el-button>
        </div>
      </div>

      <!-- Overall Stats Cards -->
      <div class="stats-grid">
        <div class="stat-card card kpi">
          <div class="stat-icon sessions"><i class="el-icon-video-play"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatNumber(summary.total_sessions || 0) }}</div>
            <div class="stat-label">Total Sessions</div>
          </div>
        </div>

        <div class="stat-card card kpi">
          <div class="stat-icon time"><i class="el-icon-time"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatDurationHours(summary.total_time_seconds || 0) }}</div>
            <div class="stat-label">Time Spent</div>
          </div>
        </div>

        <div class="stat-card card kpi">
          <div class="stat-icon accuracy"><i class="el-icon-success"></i></div>
          <div class="stat-content">
            <div class="stat-value accuracy-value">{{ summary.avg_accuracy || 0 }}%</div>
            <div class="stat-label">Avg Accuracy</div>
          </div>
        </div>

        <div class="stat-card card kpi">
          <div class="stat-icon devices"><i class="el-icon-cpu"></i></div>
          <div class="stat-content">
            <div class="stat-value">{{ formatNumber(summary.active_device_count || 0) }}</div>
            <div class="stat-label">Active Devices</div>
          </div>
        </div>
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
        <ListToolbar
          :count="topDevices.length"
          count-noun="devices"
          :total="topDevices.length"
          :sort-options="sortOptions"
          :sort-by.sync="sortBy"
          :sort-dir.sync="sortDir"
          :group-options="groupOptions"
          :group-by.sync="groupBy"
          :selecting.sync="selecting"
          :selected-count="selectedCount"
          :all-selected="allSelected"
          :search.sync="listSearch"
          search-placeholder="Device MAC or alias"
          @select-all-matching="selectAllMatching"
          @clear-selection="clearSelection"
        />
        <el-table
          ref="table"
          :data="visibleRows"
          :row-class-name="rowClass"
          @sort-change="onTableSortChange"
          @selection-change="onSelectionChange"
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
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';
import Api from '@/apis/api';
import { STATUS_COLORS } from '@/components/charts/presets';

export default {
  name: 'GameAnalytics',
  mixins: [listControls],
  components: { ListToolbar, },
  data() {
    return {
      // list controls
      sortBy: 'session_count',
      sortDir: 'desc',
      sortOptions: [
        { label: 'Sessions', value: 'session_count' },
        { label: 'Device alias', value: 'alias' },
        { label: 'Owner', value: 'owner_name' },
        { label: 'Accuracy', value: 'accuracy' }
      ],
      groupOptions: [
        { label: 'None', value: '' },
        { label: 'Owner', value: 'owner_name' }
      ],
      searchFields: ['alias', 'owner_name', 'mac_address'],

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
    sourceRows() {
      return this.topDevices || [];
    },
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
        { type: 'easy', value: easy, color: STATUS_COLORS.good },
        { type: 'medium', value: medium, color: STATUS_COLORS.warning },
        { type: 'hard', value: hard, color: STATUS_COLORS.critical }
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

// Warm monochrome on the page canvas. Colour is reserved for the ordinal
// scales that actually mean something: difficulty and accuracy.
.game-analytics {
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

// .card and .kpi in ds.scss already carry the rule, the display numerals and
// the mono label. Only the icon and the layout are local.
.stat-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;

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

  .stat-value.accuracy-value {
    color: $text-dark;
  }

  .stat-label {
    margin-bottom: 12px;
  }
}

// ---------- Cards ---------------------------------------------------------
.table-card,
.chart-card {
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
    gap: 16px;
    font-size: 13.5px;
    font-weight: 590;
    letter-spacing: -0.01em;
    color: $text-dark;
  }
}

// ds.scss strips the body padding off every `shadow="never"` card so a table
// can sit flush to the rule. A chart is not a table, so it takes it back.
.chart-card.el-card {
  ::v-deep > .el-card__body {
    padding: 20px 22px;
  }
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

// ---------- Bar charts ----------------------------------------------------
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
    width: 18px;
    border-radius: 2px 2px 0 0;
    transition: height 0.3s ease;
    min-height: 2px;

    &.session-bar { background: $text-dark; }
    &.ttft-bar { background: $primary; }
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

// ---------- Accuracy by game type ----------------------------------------
.game-performance-chart {
  .game-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 11px 0;

    & + .game-bar {
      border-top: 1px solid $divider-color;
    }

    .game-info {
      width: 150px;
      flex: 0 0 auto;

      .game-name {
        display: block;
        font-size: 12.5px;
        color: $text-body;
      }

      .game-stats {
        font-family: $font-mono;
        font-size: 10px;
        color: $text-light;
      }
    }

    .bar-track {
      flex: 1;
      height: 5px;
      background: $surface-sunk;
      border-radius: 3px;
      overflow: hidden;

      .bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.5s ease;

        // Accuracy is a quality reading, so the fill carries the verdict.
        &.high { background: $success; }
        &.medium { background: $warning; }
        &.low { background: $danger; }
      }
    }

    .accuracy-percent {
      width: 44px;
      flex: 0 0 auto;
      font-family: $font-mono;
      font-size: 11.5px;
      color: $text-dark;
      text-align: right;
    }
  }

  .no-game-data {
    text-align: center;
    color: $text-light;
    font-size: 12.5px;
    padding: 40px 0;
  }
}

// ---------- Difficulty distribution --------------------------------------
.distribution-container {
  display: flex;
  align-items: center;
  gap: 40px;
  padding: 8px 0;
  flex-wrap: wrap;
  justify-content: center;
}

.donut-chart {
  position: relative;
  width: 170px;
  height: 170px;

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

      &.easy { background: $success; }
      &.medium { background: $warning; }
      &.hard { background: $danger; }
    }

    .legend-text {
      color: $text-body;
      min-width: 64px;
    }

    .legend-value {
      font-family: $font-mono;
      font-size: 12px;
      color: $text-dark;
      min-width: 50px;
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

// ---------- Table cells ---------------------------------------------------
.device-alias {
  color: $text-dark;
}

.owner-name {
  color: $text-body;
}

.mac-address {
  font-family: $font-mono;
  font-size: 11px;
  color: $text-gray;
  background: transparent;
  padding: 0;
}

.accuracy-badge {
  font-family: $font-mono;
  font-size: 11px;
  color: $text-body;

  &.high { color: $success; }
  &.medium { color: $warning; }
  &.low { color: $danger; }
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

    .bar { width: 12px; }
  }

  .game-performance-chart .game-bar {
    flex-wrap: wrap;

    .game-info {
      width: 100%;
      margin-bottom: 6px;
    }

    .bar-track {
      flex: 1;
      min-width: 150px;
    }
  }
}
</style>
