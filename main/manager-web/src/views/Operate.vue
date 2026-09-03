<template>
  <div class="operate-page">
    <div class="operate-header">
      <div>
        <h2 class="page-title">Operate</h2>
        <p class="page-subtitle">Fleet health at a glance · IST</p>
      </div>
      <div class="header-links">
        <el-button size="small" icon="el-icon-monitor" @click="$router.push('/all-devices')">All devices</el-button>
        <el-button size="small" icon="el-icon-upload" @click="$router.push('/ota-management')">OTA firmware</el-button>
      </div>
    </div>

    <div v-loading="loading">
      <!-- Fleet KPIs -->
      <div class="kpi-row">
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.fleetSize }}</div>
          <div class="kpi-label">fleet size</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value good">{{ kpis.onlineNow }}</div>
          <div class="kpi-label">online now</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.latestFirmwarePercent === null ? '—' : kpis.latestFirmwarePercent + '%' }}</div>
          <div class="kpi-label">on latest fw{{ kpis.latestFirmwareVersion ? ` (v${kpis.latestFirmwareVersion})` : '' }}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ kpis.avgBattery === null || kpis.avgBattery === undefined ? '—' : kpis.avgBattery + '%' }}</div>
          <div class="kpi-label">avg battery</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value" :class="{ bad: kpis.deviceErrors7d > 0 }">{{ kpis.deviceErrors7d }}</div>
          <div class="kpi-label">device errors (7d)</div>
        </div>
      </div>

      <div class="two-col">
        <!-- OTA rollout + firmware distribution -->
        <div class="card">
          <h4 class="card-subtitle">Firmware rollout</h4>
          <template v-if="otaRollout">
            <div class="rollout-row">
              <span class="rollout-version">v{{ otaRollout.version }}</span>
              <span v-if="otaRollout.forceUpdate" class="force-badge">force update ON</span>
              <span class="rollout-count">{{ otaRollout.updatedCount }}/{{ otaRollout.fleetSize }} updated</span>
            </div>
            <el-progress :percentage="otaRollout.percent" :stroke-width="10" class="rollout-bar" />
          </template>
          <div v-else class="card-empty">No firmware releases yet.</div>

          <h4 class="card-subtitle spacing-top">Version distribution</h4>
          <div v-if="firmwareCoverage.length" class="fw-list">
            <div v-for="fw in firmwareCoverage" :key="fw.version" class="fw-row">
              <span class="fw-version mono" :class="{ latest: fw.isLatest }">{{ fw.version }}<i v-if="fw.isLatest" class="el-icon-check"></i></span>
              <div class="fw-bar"><div class="fw-fill" :style="{ width: fw.percent + '%' }"></div></div>
              <span class="fw-count">{{ fw.count }} · {{ fw.percent }}%</span>
            </div>
          </div>
          <div v-else class="card-empty">No devices reporting firmware.</div>
        </div>

        <!-- Watchlist -->
        <div class="card">
          <h4 class="card-subtitle">Needs a human</h4>
          <div v-if="watchlist.length" class="watch-list">
            <div v-for="item in watchlist" :key="item.macAddress + item.issue" class="watch-row">
              <span class="attention-dot" :class="attentionLevel(item)"></span>
              <div class="watch-main">
                <span class="watch-name">{{ item.alias }}<span v-if="item.kidName" class="muted"> · {{ item.kidName }}</span></span>
                <span class="watch-reason">{{ item.issue }}</span>
              </div>
              <span class="watch-mac mono">{{ item.macAddress }}</span>
            </div>
          </div>
          <div v-else class="card-empty ok">All quiet — nothing needs a human right now.</div>
        </div>
      </div>

      <!-- Recent events -->
      <h3 class="section-title">Recent fleet events</h3>
      <div class="card">
        <div v-if="recentEvents.length" class="event-list">
          <div v-for="(event, i) in recentEvents" :key="i" class="event-row">
            <span class="event-type" :class="{ error: event.severity === 'critical' }">{{ event.source }}</span>
            <span class="event-text"><b>{{ event.title }}</b> — {{ event.detail }} <span class="mono muted">{{ event.macAddress }}</span></span>
            <span class="event-time">{{ shortDate(event.createdAt) }}</span>
          </div>
        </div>
        <div v-else class="card-empty">No recent device events.</div>
      </div>
    </div>
  </div>
</template>

<script>
import Api from '@/apis/api';

export default {
  name: 'Operate',
  data() {
    return {
      loading: false,
      kpis: {},
      firmwareCoverage: [],
      otaRollout: null,
      watchlist: [],
      recentEvents: []
    };
  },
  created() {
    this.loadOperate();
  },
  methods: {
    shortDate(value) {
      if (!value) return '—';
      return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    },
    attentionLevel(item) {
      return item.severity || 'warning';
    },
    loadOperate() {
      this.loading = true;
      Api.admin.getFounderOperate(({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.kpis = data.data.kpis || {};
          this.firmwareCoverage = (data.data.sections && data.data.sections.firmwareCoverage) || [];
          this.otaRollout = (data.data.sections && data.data.sections.otaRollout) || null;
          this.watchlist = (data.data.sections && data.data.sections.watchlist) || [];
          this.recentEvents = (data.data.sections && data.data.sections.recentEvents) || [];
        } else {
          this.$message.error(data.msg || 'Failed to load fleet health');
        }
      });
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.operate-page {
  max-width: 1280px;
}

.operate-header {
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

.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: $text-dark;
  font-variant-numeric: tabular-nums;

  &.good { color: #0ca30c; }
  &.bad { color: #d03b3b; }
}

.kpi-label {
  font-size: 11.5px;
  color: $text-gray;
  margin-top: 2px;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}

.card-subtitle {
  margin: 0 0 10px;
  font-size: 13px;
  color: $text-dark;

  &.spacing-top { margin-top: 16px; }
}

.rollout-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.rollout-version {
  font-weight: 700;
  color: $text-dark;
}

.force-badge {
  font-size: 10.5px;
  font-weight: 600;
  color: #d03b3b;
  background: rgba(208, 59, 59, 0.1);
  border-radius: 8px;
  padding: 2px 8px;
}

.rollout-count {
  margin-left: auto;
  font-size: 12px;
  color: $text-gray;
  font-variant-numeric: tabular-nums;
}

.rollout-bar {
  margin-bottom: 6px;
}

.fw-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fw-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fw-version {
  width: 80px;
  font-size: 12px;
  color: $text-dark;

  &.latest { color: #0a7a0a; font-weight: 700; }
}

.fw-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: #f0f1f7;
  overflow: hidden;

  .fw-fill {
    height: 100%;
    background: $primary;
    border-radius: 4px;
  }
}

.fw-count {
  width: 90px;
  text-align: right;
  font-size: 11.5px;
  color: $text-gray;
  font-variant-numeric: tabular-nums;
}

.watch-list {
  display: flex;
  flex-direction: column;
  max-height: 340px;
  overflow-y: auto;
}

.watch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #f4f5fa;

  &:last-child { border-bottom: none; }
}

.attention-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.warning { background: #fab219; }
  &.serious { background: #ec835a; }
  &.critical { background: #d03b3b; }
}

.watch-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.watch-name {
  font-size: 12.5px;
  color: $text-dark;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-reason {
  font-size: 11px;
  color: $text-gray;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-mac {
  font-size: 10.5px;
  color: $text-gray;
}

.event-list {
  max-height: 300px;
  overflow-y: auto;
}

.event-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid #f4f5fa;
  font-size: 12px;

  &:last-child { border-bottom: none; }
}

.event-type {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 8px;
  background: #f0f1f7;
  color: $text-gray;
  flex-shrink: 0;

  &.error { background: rgba(208, 59, 59, 0.1); color: #d03b3b; }
  &.sync { background: rgba(42, 120, 214, 0.1); color: #2a78d6; }
}

.event-text {
  flex: 1;
  color: $text-dark;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-time {
  color: $text-gray;
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
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
  padding: 20px 0;

  &.ok { color: #0ca30c; }
}

.muted {
  color: $text-gray;
  font-weight: 400;
}

.mono {
  font-family: 'Consolas', 'Menlo', monospace;
}

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .two-col { grid-template-columns: 1fr; }
}
</style>
