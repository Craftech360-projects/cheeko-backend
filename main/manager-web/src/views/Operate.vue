<template>
  <div class="operate-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Fleet &amp; Ops</h1>
        <p class="page-subtitle">Connectivity, firmware spread and the incidents worth acting on today · IST</p>
      </div>
      <div class="page-actions">
        <el-button size="small" @click="$router.push('/all-devices')">All devices</el-button>
        <el-button size="small" @click="$router.push('/ota-management')">OTA firmware</el-button>
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
      watchlist: []
    };
  },
  created() {
    this.loadOperate();
  },
  methods: {
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

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-family: $font-display;
  font-size: 34px;
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.025em;
  color: $text-dark;

}

.page-subtitle {
  margin: 7px 0 0;
  font-size: 13px;
  color: $text-gray;
  max-width: 62ch;

}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.card {
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 22px 24px;
  box-shadow: none;
  min-width: 0;

}

.kpi-value {
  font-family: $font-display;
  font-size: 40px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.03em;
  color: $text-dark;


  &.good { color: $success; }
  &.bad { color: $danger; }
}

.kpi-label {
  font-family: $font-mono;
  font-size: 9.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: $text-light;
  margin-top: 10px;

}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}

.card-subtitle {
  margin: 0 0 16px;
  font-size: 13.5px;
  font-weight: 590;
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
  color: $danger;
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

  &.latest { color: $success; font-weight: 700; }
}

.fw-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: $divider-color;
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

  &.warning { background: $warning; }
  &.serious { background: $primary; }
  &.critical { background: $danger; }
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






.section-title {
  margin: 30px 0 14px;
  font-family: $font-display;
  font-size: 22px;
  font-weight: 400;
  letter-spacing: -0.02em;
  color: $text-dark;

}

.card-empty {
  padding: 32px 0;
  text-align: center;
  color: $text-light;
  font-size: 12.5px;


  &.ok { color: $success; }
}

.muted {
  color: $text-gray;
  font-weight: 400;
}

.mono {
  font-family: $font-mono;
  font-size: 11.5px;
  letter-spacing: -0.01em;

}

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .two-col { grid-template-columns: 1fr; }
}
</style>
