<template>
  <div class="welcome">
    <header-bar />
    <div class="main-content">
      <div class="content-area">
        <div class="toolbar">
          <div class="left-actions">
            <el-input
              v-model="searchKeyword"
              placeholder="Search by MAC address, alias..."
              prefix-icon="el-icon-search"
              class="search-input"
              clearable
              @keyup.enter.native="handleSearch"
              @clear="handleSearch"
            />
            <el-button type="primary" size="small" @click="handleSearch">Search</el-button>
          </div>
          <div class="right-actions">
            <el-button size="small" @click="refreshList">
              <i class="el-icon-refresh"></i> Refresh
            </el-button>
          </div>
        </div>

        <el-table
          :data="paginatedDeviceList"
          v-loading="loading"
          style="width: 100%"
          :header-cell-style="{ background: '#f5f7fa', color: '#606266' }"
        >
          <el-table-column label="MAC Address" min-width="160">
            <template slot-scope="scope">
              <span class="mac-address">{{ scope.row.macAddress }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Alias" min-width="120">
            <template slot-scope="scope">
              <el-input
                v-if="scope.row.isEdit"
                v-model="scope.row.alias"
                size="mini"
                @blur="onAliasBlur(scope.row)"
                @keyup.enter.native="onAliasEnter(scope.row)"
              />
              <span v-else @dblclick="scope.row.isEdit = true" class="editable-text">
                {{ scope.row.alias || '-' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="User" min-width="120">
            <template slot-scope="scope">
              <span>{{ scope.row.userName || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Board" prop="board" min-width="100" />
          <el-table-column label="Firmware" prop="appVersion" min-width="100" />
          <el-table-column label="Last Connected" min-width="160">
            <template slot-scope="scope">
              {{ formatDate(scope.row.lastConnectedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="Active Mode" min-width="120" align="center">
            <template slot-scope="scope">
              <el-tag
                :type="getModeTagType(scope.row.activeMode)"
                size="small"
                effect="plain"
              >
                <i :class="getModeIcon(scope.row.activeMode)"></i>
                {{ scope.row.activeMode || 'idle' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Mode" min-width="100" align="center">
            <template slot-scope="scope">
              <el-switch
                v-model="scope.row.modeSwitch"
                size="mini"
                active-color="#67c23a"
                inactive-color="#909399"
                active-text="Auto"
                inactive-text="Manual"
                @change="handleModeSwitchChange(scope.row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="OTA" min-width="80" align="center">
            <template slot-scope="scope">
              <el-switch
                v-model="scope.row.otaSwitch"
                size="mini"
                active-color="#13ce66"
                inactive-color="#ff4949"
                @change="handleOtaSwitchChange(scope.row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="Actions" min-width="260" align="center">
            <template slot-scope="scope">
              <el-button
                type="text"
                size="small"
                @click="openSettingsDialog(scope.row)"
              >
                Settings Sync
              </el-button>
              <el-button
                type="text"
                size="small"
                @click="openAnalyticsDialog(scope.row)"
              >
                Analytics
              </el-button>
              <el-button
                type="text"
                size="small"
                @click="handleKidProfile(scope.row)"
                :disabled="!scope.row.userId"
              >
                Kid Profile
              </el-button>
              <el-button
                type="text"
                size="small"
                class="danger-btn"
                @click="handleUnbind(scope.row)"
                :disabled="!scope.row.userId"
              >
                Unbind
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-container" v-if="filteredDeviceList.length > 0">
          <span class="total-info">Total: {{ filteredDeviceList.length }} devices</span>
          <el-pagination
            background
            layout="prev, pager, next"
            :total="filteredDeviceList.length"
            :page-size="pageSize"
            :current-page.sync="currentPage"
            @current-change="handlePageChange"
          />
        </div>

        <div v-if="deviceList.length === 0 && !loading" class="empty-state">
          <i class="el-icon-monitor"></i>
          <p>No devices found</p>
        </div>
      </div>
    </div>

    <el-dialog
      title="Device Settings Sync"
      :visible.sync="settingsDialogVisible"
      width="760px"
      @close="onSettingsDialogClosed"
    >
      <div v-if="selectedSettingsDevice" class="settings-device-header">
        <div><strong>MAC:</strong> {{ selectedSettingsDevice.macAddress }}</div>
        <div><strong>Alias:</strong> {{ selectedSettingsDevice.alias || '-' }}</div>
        <div>
          <strong>Sync:</strong>
          <el-tag :type="getSyncStatusTagType(settingsMeta.syncStatus)" size="mini">
            {{ settingsMeta.syncStatus || 'unknown' }}
          </el-tag>
        </div>
        <div><strong>Version:</strong> {{ settingsMeta.settingsVersion || '-' }}</div>
      </div>

      <el-skeleton :rows="6" animated v-if="settingsLoading" />

      <div v-else>
        <el-card shadow="never" class="settings-section-card">
          <div slot="header" class="settings-section-title">Runtime State</div>
          <div class="runtime-grid">
            <div><strong>Online:</strong> {{ runtimeState.online === true ? 'Yes' : (runtimeState.online === false ? 'No' : '-') }}</div>
            <div><strong>Last Seen:</strong> {{ formatDate(runtimeState.last_seen_at) }}</div>
            <div><strong>Mode:</strong> {{ runtimeState.mode || '-' }}</div>
            <div><strong>Network:</strong> {{ runtimeState.network || '-' }}</div>
            <div><strong>Battery:</strong> {{ runtimeState.battery != null ? runtimeState.battery + '%' : '-' }}</div>
            <div><strong>Charging:</strong> {{ runtimeState.charging === true ? 'Yes' : (runtimeState.charging === false ? 'No' : '-') }}</div>
            <div><strong>Firmware:</strong> {{ runtimeState.firmware || '-' }}</div>
            <div><strong>Build Label:</strong> {{ runtimeState.build_label || '-' }}</div>
          </div>
        </el-card>

        <el-card shadow="never" class="settings-section-card">
          <div slot="header" class="settings-section-title">Settings</div>
          <el-form :model="settingsForm" label-width="140px" size="small">
            <el-form-item label="Volume">
              <el-slider v-model="settingsForm.volume" :min="0" :max="100" :show-input="true" />
            </el-form-item>
            <el-form-item label="Brightness">
              <el-slider v-model="settingsForm.brightness" :min="10" :max="100" :show-input="true" />
            </el-form-item>
            <el-form-item label="Theme">
              <el-select v-model="settingsForm.theme" style="width: 160px;">
                <el-option v-for="(name, idx) in themeNames" :key="idx" :label="name" :value="idx" />
              </el-select>
            </el-form-item>
            <el-form-item label="Auto Listen">
              <el-switch v-model="settingsForm.auto_listen" />
            </el-form-item>
            <el-form-item label="System Sound">
              <el-switch v-model="settingsForm.system_sound" />
            </el-form-item>
            <el-form-item label="System Prompt">
              <el-switch v-model="settingsForm.system_prompt" />
            </el-form-item>
            <el-form-item label="Vibration">
              <el-switch v-model="settingsForm.vibration" />
            </el-form-item>
            <el-form-item label="Sleep Enabled">
              <el-switch v-model="settingsForm.sleep_enabled" />
            </el-form-item>
            <el-form-item label="Quiet Hours Enabled">
              <el-switch v-model="settingsForm.quiet_hours.enabled" />
            </el-form-item>
            <el-form-item label="Quiet Start (HH:mm)">
              <el-input v-model="settingsForm.quiet_hours.start" maxlength="5" placeholder="21:00" style="width: 120px;" />
            </el-form-item>
            <el-form-item label="Quiet End (HH:mm)">
              <el-input v-model="settingsForm.quiet_hours.end" maxlength="5" placeholder="07:00" style="width: 120px;" />
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="settings-section-card">
          <div slot="header" class="settings-section-title">Recent Sync Events</div>
          <el-table :data="syncEvents" size="mini" max-height="220" style="width: 100%">
            <el-table-column label="Time" min-width="170">
              <template slot-scope="scope">{{ formatDate(scope.row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="Type" prop="event_type" min-width="120" />
            <el-table-column label="Version" min-width="90">
              <template slot-scope="scope">{{ scope.row.version == null ? '-' : scope.row.version }}</template>
            </el-table-column>
            <el-table-column label="Status" prop="status" min-width="120" />
            <el-table-column label="Reason" prop="reason" min-width="220" show-overflow-tooltip />
          </el-table>
        </el-card>

        <el-card shadow="never" class="settings-section-card">
          <div slot="header" class="settings-section-header">
            <span class="settings-section-title">Progress Analytics</span>
            <el-radio-group v-model="analyticsPeriod" size="mini" @change="onAnalyticsPeriodChange">
              <el-radio-button label="today">Today</el-radio-button>
              <el-radio-button label="week">Week</el-radio-button>
              <el-radio-button label="month">Month</el-radio-button>
            </el-radio-group>
          </div>
          <el-skeleton :rows="4" animated v-if="analyticsLoading" />
          <div v-else class="analytics-grid">
            <div><strong>Total Usage:</strong> {{ formatMinutesFromSeconds(progressSummary.usageTimeSeconds) }} min</div>
            <div><strong>Card Taps:</strong> {{ progressSummary.cardTapCount || 0 }}</div>
            <div><strong>AI Interactions:</strong> {{ progressSummary.aiInteractionCount || 0 }}</div>
            <div><strong>Games Played:</strong> {{ progressSummary.gamesPlayed || 0 }}</div>
            <div><strong>AI Minutes:</strong> {{ formatMinutesFromSeconds(getUsageDurationSeconds('ai_talk')) }}</div>
            <div><strong>Radio Minutes:</strong> {{ formatMinutesFromSeconds(getUsageDurationSeconds('radio')) }}</div>
            <div><strong>Game Minutes:</strong> {{ formatMinutesFromSeconds(getUsageDurationSeconds('game')) }}</div>
            <div><strong>Card Minutes:</strong> {{ formatMinutesFromSeconds(getUsageDurationSeconds('card')) }}</div>
            <div><strong>Usage Window:</strong> {{ progressSummary.startDate || '-' }} to {{ progressSummary.endDate || '-' }}</div>
            <div><strong>Latest Battery:</strong> {{ analyticsBattery?.latest?.battery != null ? (analyticsBattery.latest.battery + '%') : '-' }}</div>
          </div>
        </el-card>

        <el-card shadow="never" class="settings-section-card" v-if="analyticsPeriod !== 'today'">
          <div slot="header" class="settings-section-title">Daily Trend ({{ analyticsPeriod }})</div>
          <el-table :data="progressTrend.slice().reverse()" size="mini" max-height="220" style="width: 100%">
            <el-table-column label="Date" prop="date" min-width="120" />
            <el-table-column label="Usage (min)" min-width="95">
              <template slot-scope="scope">{{ formatMinutesFromSeconds(scope.row.usageTimeSeconds) }}</template>
            </el-table-column>
            <el-table-column label="Card Taps" prop="cardTapCount" min-width="90" />
            <el-table-column label="AI Count" prop="aiInteractionCount" min-width="85" />
            <el-table-column label="Games" prop="gamesPlayed" min-width="80" />
          </el-table>
        </el-card>

        <el-card shadow="never" class="settings-section-card">
          <div slot="header" class="settings-section-title">Recent Firmware Events</div>
          <el-table :data="analyticsEvents" size="mini" max-height="260" style="width: 100%">
            <el-table-column label="Time" min-width="170">
              <template slot-scope="scope">{{ formatDate(scope.row.timestamp) }}</template>
            </el-table-column>
            <el-table-column label="Event" prop="event" min-width="130" />
            <el-table-column label="Duration (min)" min-width="110">
              <template slot-scope="scope">{{ formatMinutesFromMs(scope.row.durationMs) }}</template>
            </el-table-column>
            <el-table-column label="Score" min-width="80">
              <template slot-scope="scope">{{ scope.row.score == null ? '-' : scope.row.score }}</template>
            </el-table-column>
            <el-table-column label="Reason" prop="reason" min-width="160" show-overflow-tooltip />
          </el-table>
        </el-card>
      </div>

      <span slot="footer" class="dialog-footer">
        <el-button @click="refreshSettingsDialog" :loading="settingsLoading">Refresh</el-button>
        <el-button type="primary" @click="saveDeviceSettings" :loading="settingsSaving">Save & Sync</el-button>
      </span>
    </el-dialog>

    <version-footer />
  </div>
</template>

<script>
import Api from '@/apis/api'
import HeaderBar from '@/components/HeaderBar.vue'
import VersionFooter from '@/components/VersionFooter.vue'

export default {
  name: 'AllDevices',
  components: { HeaderBar, VersionFooter },
  data() {
    return {
      loading: false,
      deviceList: [],
      searchKeyword: '',
      activeSearchKeyword: '',
      currentPage: 1,
      pageSize: 20,
      settingsDialogVisible: false,
      settingsLoading: false,
      settingsSaving: false,
      selectedSettingsDevice: null,
      settingsMeta: {
        syncStatus: null,
        settingsVersion: null,
        lastAckStatus: null,
        lastAckReason: null,
        lastAppliedVersion: null
      },
      runtimeState: {},
      syncEvents: [],
      analyticsLoading: false,
      analyticsPeriod: 'today',
      progressSummary: {},
      progressUsageBreakdown: [],
      progressTrend: [],
      analyticsEvents: [],
      analyticsBattery: null,
      themeNames: ['Sunny', 'Night', 'Ocean', 'Candy', 'Orange', 'White', 'Pink'],
      settingsForm: {
        volume: 70,
        brightness: 80,
        theme: 0,
        auto_listen: false,
        system_sound: true,
        system_prompt: true,
        vibration: true,
        sleep_enabled: true,
        quiet_hours: {
          enabled: false,
          start: '21:00',
          end: '07:00'
        }
      }
    }
  },
  computed: {
    filteredDeviceList() {
      if (!this.activeSearchKeyword) return this.deviceList;
      const keyword = this.activeSearchKeyword.toLowerCase();
      return this.deviceList.filter(device => {
        return (
          (device.macAddress && device.macAddress.toLowerCase().includes(keyword)) ||
          (device.alias && device.alias.toLowerCase().includes(keyword)) ||
          (device.userName && device.userName.toLowerCase().includes(keyword))
        );
      });
    },
    paginatedDeviceList() {
      const start = (this.currentPage - 1) * this.pageSize;
      return this.filteredDeviceList.slice(start, start + this.pageSize);
    }
  },
  created() {
    this.loadDevices();
  },
  methods: {
    loadDevices() {
      this.loading = true;
      Api.admin.getAllDevices({ page: 1, limit: 1000 }, ({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.deviceList = (data.data.list || data.data).map(device => ({
            id: device.id,
            macAddress: device.macAddress || device.mac_address,
            alias: device.alias,
            _originalAlias: device.alias,
            isEdit: false,
            board: device.board || device.deviceType,
            appVersion: device.appVersion || device.app_version,
            lastConnectedAt: device.lastConnectedAt || device.last_connected_at || device.recentChatTime,
            userId: device.userId || device.user_id,
            userName: device.bindUserName || device.userName || device.username,
            agentId: device.agentId || device.agent_id,
            kidId: device.kidId || device.kid_id,
            deviceMode: device.deviceMode || device.device_mode || 'manual',
            modeSwitch: (device.deviceMode || device.device_mode || 'manual') === 'auto',
            otaSwitch: (device.autoUpdate || device.otaUpgrade || device.auto_update) === 1,
            activeMode: device.activeMode || device.active_mode || device.currentMode || 'idle'
          }));
          // Fetch active modes for all devices
          this.fetchActiveModes();
        } else {
          this.$message.error(data.msg || 'Failed to load devices');
        }
      });
    },
    refreshList() {
      this.loadDevices();
    },
    handleSearch() {
      this.activeSearchKeyword = this.searchKeyword;
      this.currentPage = 1;
    },
    handlePageChange(page) {
      this.currentPage = page;
    },
    formatDate(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleString();
    },
    onAliasBlur(row) {
      row.isEdit = false;
      this.submitAlias(row);
    },
    onAliasEnter(row) {
      row.isEdit = false;
      this.submitAlias(row);
    },
    submitAlias(row) {
      const newAlias = (row.alias || '').trim();
      if (newAlias === row._originalAlias) return;

      Api.device.updateDeviceInfo(row.id, { alias: newAlias }, ({ data }) => {
        if (data.code === 0) {
          row._originalAlias = newAlias;
          this.$message.success('Alias updated');
        } else {
          row.alias = row._originalAlias;
          this.$message.error(data.msg || 'Failed to update alias');
        }
      });
    },
    handleOtaSwitchChange(row) {
      Api.device.updateDeviceInfo(row.id, { autoUpdate: row.otaSwitch ? 1 : 0 }, ({ data }) => {
        if (data.code === 0) {
          this.$message.success(row.otaSwitch ? 'Auto-upgrade enabled' : 'Auto-upgrade disabled');
        } else {
          row.otaSwitch = !row.otaSwitch;
          this.$message.error(data.msg || 'Failed to update OTA setting');
        }
      });
    },
    handleModeSwitchChange(row) {
      const newMode = row.modeSwitch ? 'auto' : 'manual';
      Api.device.updateDeviceInfo(row.id, { deviceMode: newMode }, ({ data }) => {
        if (data.code === 0) {
          row.deviceMode = newMode;
          this.$message.success(row.modeSwitch ? 'Mode changed to Auto' : 'Mode changed to Manual');
        } else {
          row.modeSwitch = !row.modeSwitch;
          this.$message.error(data.msg || 'Failed to update device mode');
        }
      });
    },
    handleKidProfile(row) {
      if (!row.userId) {
        this.$message.warning('Device is not bound to any user. Cannot view kid profiles.');
        return;
      }
      this.$router.push({
        path: '/kid-profiles',
        query: {
          deviceId: row.id,
          macAddress: row.macAddress,
          kidId: row.kidId,
          userId: row.userId // Pass device owner's userId for admin view
        }
      });
    },
    handleUnbind(row) {
      if (!row.userId) {
        this.$message.warning('Device is not bound to any user');
        return;
      }

      this.$confirm('Are you sure you want to unbind this device?', 'Warning', {
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        Api.device.unbindDevice(row.id, ({ data }) => {
          if (data.code === 0) {
            this.$message.success('Device unbound successfully');
            this.loadDevices();
          } else {
            this.$message.error(data.msg || 'Failed to unbind device');
          }
        });
      }).catch(() => {});
    },
    getDefaultSettingsForm() {
      return {
        volume: 70,
        brightness: 80,
        theme: 0,
        auto_listen: false,
        system_sound: true,
        system_prompt: true,
        vibration: true,
        sleep_enabled: true,
        quiet_hours: {
          enabled: false,
          start: '21:00',
          end: '07:00'
        }
      };
    },
    resetSettingsDialogState() {
      this.settingsMeta = {
        syncStatus: null,
        settingsVersion: null,
        lastAckStatus: null,
        lastAckReason: null,
        lastAppliedVersion: null
      };
      this.runtimeState = {};
      this.syncEvents = [];
      this.analyticsLoading = false;
      this.analyticsPeriod = 'today';
      this.progressSummary = {};
      this.progressUsageBreakdown = [];
      this.progressTrend = [];
      this.analyticsEvents = [];
      this.analyticsBattery = null;
      this.settingsForm = this.getDefaultSettingsForm();
    },
    onSettingsDialogClosed() {
      this.selectedSettingsDevice = null;
      this.settingsLoading = false;
      this.settingsSaving = false;
      this.resetSettingsDialogState();
    },
    getSyncStatusTagType(status) {
      const map = {
        synced: 'success',
        syncing: 'warning',
        pending_offline: 'info',
        rejected: 'danger',
        stale: 'warning'
      };
      return map[status] || 'info';
    },
    isValidHourMinute(value) {
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
    },
    openSettingsDialog(row) {
      this.selectedSettingsDevice = row;
      this.settingsDialogVisible = true;
      this.loadSettingsDialogData();
    },
    openAnalyticsDialog(row) {
      this.openSettingsDialog(row);
      this.$nextTick(() => {
        setTimeout(() => {
          const sectionCards = this.$el.querySelectorAll('.settings-section-card');
          const analyticsCard = Array.from(sectionCards).find((node) => {
            return node.textContent && node.textContent.includes('Progress Analytics');
          });
          if (analyticsCard && typeof analyticsCard.scrollIntoView === 'function') {
            analyticsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);
      });
    },
    refreshSettingsDialog() {
      this.loadSettingsDialogData();
    },
    onAnalyticsPeriodChange() {
      this.loadProgressAnalyticsForPeriod();
    },
    loadSettingsDialogData() {
      if (!this.selectedSettingsDevice || !this.selectedSettingsDevice.macAddress) {
        return;
      }

      const mac = this.selectedSettingsDevice.macAddress;
      this.settingsLoading = true;

      this.analyticsLoading = true;

      Promise.all([
        this.fetchDeviceSettings(mac),
        this.fetchDeviceRuntimeState(mac),
        this.fetchDeviceSyncEvents(mac, 20),
        this.fetchDeviceAnalyticsEvents(mac, 20),
        this.fetchDeviceAnalyticsBattery(mac)
      ]).then(([settingsRes, stateRes, eventsRes, analyticsEventsRes, batteryRes]) => {
        const settingsData = settingsRes?.data || {};
        const runtimeData = stateRes?.data?.state || {};
        const eventsData = eventsRes?.data?.events || [];
        const analyticsEventsData = analyticsEventsRes?.data?.events || [];
        const batteryData = batteryRes?.data || null;

        this.settingsMeta = {
          syncStatus: settingsData.syncStatus || null,
          settingsVersion: settingsData.settingsVersion || null,
          lastAckStatus: settingsData.lastAckStatus || null,
          lastAckReason: settingsData.lastAckReason || null,
          lastAppliedVersion: settingsData.lastAppliedVersion || null
        };
        this.runtimeState = runtimeData || {};
        this.syncEvents = Array.isArray(eventsData) ? eventsData : [];
        this.analyticsEvents = Array.isArray(analyticsEventsData) ? analyticsEventsData : [];
        this.analyticsBattery = batteryData;
        this.settingsForm = this.mapSettingsDataToForm(settingsData.settings || {});
        return this.loadProgressAnalyticsForPeriod();
      }).catch((error) => {
        this.$message.error(error?.message || 'Failed to load settings sync data');
      }).finally(() => {
        this.settingsLoading = false;
        this.analyticsLoading = false;
      });
    },
    loadProgressAnalyticsForPeriod() {
      if (!this.selectedSettingsDevice || !this.selectedSettingsDevice.macAddress) {
        return Promise.resolve();
      }
      const mac = this.selectedSettingsDevice.macAddress;
      const period = this.analyticsPeriod || 'today';
      const trendPeriod = period === 'today' ? null : period;

      this.analyticsLoading = true;
      return Promise.all([
        this.fetchDeviceProgressSummary(mac, period),
        this.fetchDeviceProgressDetails(mac, 'usage', period),
        trendPeriod ? this.fetchDeviceProgressTrend(mac, trendPeriod) : Promise.resolve({ data: { points: [] } }),
      ]).then(([summaryRes, usageRes, trendRes]) => {
        this.progressSummary = summaryRes?.data || {};
        this.progressUsageBreakdown = Array.isArray(usageRes?.data?.items) ? usageRes.data.items : [];
        this.progressTrend = Array.isArray(trendRes?.data?.points) ? trendRes.data.points : [];
      }).catch((error) => {
        this.$message.error(error?.message || 'Failed to load progress analytics');
      }).finally(() => {
        this.analyticsLoading = false;
      });
    },
    fetchDeviceSettings(mac) {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceSettingsByMac(mac, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch device settings'));
          }
        });
      });
    },
    fetchDeviceRuntimeState(mac) {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceRuntimeStateByMac(mac, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch device runtime state'));
          }
        });
      });
    },
    fetchDeviceSyncEvents(mac, limit = 20) {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceSyncEventsByMac(mac, { limit }, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch device sync events'));
          }
        });
      });
    },
    fetchDeviceProgressSummary(mac, period = 'today') {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceProgressSummaryByMac(mac, { period }, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch progress summary'));
          }
        });
      });
    },
    fetchDeviceProgressDetails(mac, metric, period = 'today') {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceProgressDetailsByMac(mac, { metric, period, page: 1, limit: 10 }, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch progress details'));
          }
        });
      });
    },
    fetchDeviceProgressTrend(mac, period = 'week') {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceProgressTrendByMac(mac, { period }, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch progress trend'));
          }
        });
      });
    },
    fetchDeviceAnalyticsEvents(mac, limit = 20) {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceAnalyticsEventsByMac(mac, { limit }, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch analytics events'));
          }
        });
      });
    },
    fetchDeviceAnalyticsBattery(mac) {
      return new Promise((resolve, reject) => {
        Api.admin.getDeviceAnalyticsBatteryByMac(mac, {}, ({ data }) => {
          if (data && data.code === 0) {
            resolve(data);
          } else {
            reject(new Error(data?.msg || 'Failed to fetch analytics battery'));
          }
        });
      });
    },
    formatMinutesFromMs(value) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return 0;
      return Math.round(num / 60000);
    },
    formatMinutesFromSeconds(value) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return 0;
      return Math.round(num / 60);
    },
    getUsageDurationSeconds(key) {
      if (!Array.isArray(this.progressUsageBreakdown)) return 0;
      const row = this.progressUsageBreakdown.find(item => item && item.key === key);
      if (!row) return 0;
      return Number(row.durationSeconds || row.duration_seconds || 0) || 0;
    },
    mapSettingsDataToForm(settings) {
      const defaults = this.getDefaultSettingsForm();
      return {
        ...defaults,
        ...settings,
        quiet_hours: {
          ...defaults.quiet_hours,
          ...((settings && settings.quiet_hours) || {})
        }
      };
    },
    saveDeviceSettings() {
      if (!this.selectedSettingsDevice || !this.selectedSettingsDevice.macAddress) {
        return;
      }

      const qhStart = this.settingsForm.quiet_hours?.start;
      const qhEnd = this.settingsForm.quiet_hours?.end;
      if (!this.isValidHourMinute(qhStart) || !this.isValidHourMinute(qhEnd)) {
        this.$message.warning('Quiet hours start/end must be in HH:mm format');
        return;
      }

      const mac = this.selectedSettingsDevice.macAddress;
      const payload = {
        settings: {
          volume: Number(this.settingsForm.volume),
          brightness: Number(this.settingsForm.brightness),
          theme: Number(this.settingsForm.theme),
          auto_listen: Boolean(this.settingsForm.auto_listen),
          system_sound: Boolean(this.settingsForm.system_sound),
          system_prompt: Boolean(this.settingsForm.system_prompt),
          vibration: Boolean(this.settingsForm.vibration),
          sleep_enabled: Boolean(this.settingsForm.sleep_enabled),
          quiet_hours: {
            enabled: Boolean(this.settingsForm.quiet_hours.enabled),
            start: qhStart,
            end: qhEnd
          }
        }
      };

      this.settingsSaving = true;
      Api.admin.updateDeviceSettingsByMac(mac, payload, ({ data }) => {
        this.settingsSaving = false;
        if (data && data.code === 0) {
          this.$message.success('Settings saved successfully');
          const updated = data.data || {};
          this.settingsMeta.syncStatus = updated.syncStatus || this.settingsMeta.syncStatus;
          this.settingsMeta.settingsVersion = updated.settingsVersion || this.settingsMeta.settingsVersion;
          this.settingsMeta.lastAckStatus = updated.lastAckStatus || this.settingsMeta.lastAckStatus;
          this.settingsMeta.lastAckReason = updated.lastAckReason || this.settingsMeta.lastAckReason;
          this.settingsMeta.lastAppliedVersion = updated.lastAppliedVersion || this.settingsMeta.lastAppliedVersion;
          this.settingsForm = this.mapSettingsDataToForm(updated.settings || payload.settings);
          this.loadSettingsDialogData();
        } else {
          this.$message.error(data?.msg || 'Failed to save settings');
        }
      });
    },
    fetchActiveModes() {
      // Fetch active mode for each device that has a MAC address
      this.deviceList.forEach(device => {
        if (device.macAddress) {
          Api.device.getDeviceMode(device.macAddress, ({ data }) => {
            if (data.code === 0 && data.data) {
              const mode = data.data.mode || data.data.currentMode || 'idle';
              const index = this.deviceList.findIndex(d => d.macAddress === device.macAddress);
              if (index !== -1) {
                this.$set(this.deviceList[index], 'activeMode', mode);
              }
            }
          });
        }
      });
    },
    getModeTagType(mode) {
      const types = {
        conversation: 'primary',
        music: 'success',
        story: 'warning',
        game: 'danger',
        idle: 'info'
      };
      return types[mode] || 'info';
    },
    getModeIcon(mode) {
      const icons = {
        conversation: 'el-icon-chat-dot-round',
        music: 'el-icon-headset',
        story: 'el-icon-reading',
        game: 'el-icon-trophy',
        idle: 'el-icon-moon'
      };
      return icons[mode] || 'el-icon-question';
    }
  }
}
</script>

<style scoped lang="scss">
.welcome {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(to bottom right, #fff5eb, #fff7f0, #ffe8d6);
}

.main-content {
  flex: 1;
  padding: 20px 40px;
  max-width: 1800px;
  margin: 0 auto;
  width: 100%;
}

.content-area {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 10px;
}

.left-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.search-input {
  width: 300px;
}

.mac-address {
  font-family: monospace;
  font-size: 13px;
}

.editable-text {
  cursor: pointer;

  &:hover {
    color: #5f70f3;
  }
}

.danger-btn {
  color: #f56c6c !important;
}

.pagination-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #ebeef5;
}

.total-info {
  color: #909399;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #909399;

  i {
    font-size: 48px;
    margin-bottom: 15px;
  }

  p {
    margin: 0;
  }
}

.settings-device-header {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.settings-section-card {
  margin-top: 12px;
}

.settings-section-title {
  font-weight: 600;
  color: #303133;
}

.settings-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.runtime-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  font-size: 13px;
  color: #606266;
}

.analytics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  font-size: 13px;
  color: #606266;
}
</style>
