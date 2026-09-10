<template>
  <div class="welcome">
    <div class="main-content">
      <div class="content-area">
        <div class="page-head">
          <div>
            <h1 class="page-title">Devices</h1>
            <p class="page-lead">Every toy in the fleet. Open one for its settings, analytics and warranty.</p>
          </div>
          <div class="page-actions">
            <el-button size="small" @click="refreshList">Refresh</el-button>
          </div>
        </div>

        <ListToolbar
          :count="visibleRows.length"
          count-noun="devices"
          :total="visibleRows.length"
          :sort-options="sortOptions"
          :sort-by.sync="sortBy"
          :sort-dir.sync="sortDir"
          :selecting.sync="selecting"
          :selected-count="selectedCount"
          :all-selected="allSelected"
          :search.sync="listSearch"
          search-placeholder="Alias, MAC or owner"
          @select-all-matching="selectAllMatching"
          @clear-selection="clearSelection"
        >
          <template #bulk>
            <el-button @click="bulkExport">Export</el-button>
          </template>
        </ListToolbar>

        <div class="card pad0 devices-table">
        <el-table
          ref="table"
          :data="paginatedDeviceList"
          v-loading="loading"
          style="width: 100%"
          :row-class-name="rowClass"
          @sort-change="onTableSortChange"
          @selection-change="onSelectionChange"
          @row-click="onRowClick"
        >
          <el-table-column v-if="selecting" type="selection" width="44" />
          <el-table-column label="MAC Address" prop="macAddress" min-width="170" sortable="custom">
            <template slot-scope="scope">
              <div class="rowid">
                <span class="rowid-mark accent"><i class="el-icon-cpu"></i></span>
                <span class="mac-address mono">{{ scope.row.macAddress }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="Parent" prop="userName" min-width="160" sortable="custom">
            <template slot-scope="scope">
              <span>{{ scope.row.userName || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Firmware" prop="appVersion" min-width="100" />
          <el-table-column :label="`Last Connected (${dayFormatHint})`" min-width="160">
            <template slot-scope="scope">
              {{ formatDate(scope.row.lastConnectedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="OTA" min-width="80" align="center">
            <template slot-scope="scope">
              <!-- click.stop: toggling OTA must not also open the device popup -->
              <span @click.stop>
                <el-switch
                  v-model="scope.row.otaSwitch"
                  size="mini"
                  active-color="#16130F"
                  inactive-color="#E7E2D9"
                  @change="handleOtaSwitchChange(scope.row)"
                />
              </span>
            </template>
          </el-table-column>
        </el-table>
        </div>

        <div class="pagination-container" v-if="visibleRows.length > 0">
          <span class="total-info">Total: {{ visibleRows.length }} devices</span>
          <el-pagination
            background
            layout="prev, pager, next"
            :total="visibleRows.length"
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
      :close-on-click-modal="dismissOnBackdrop"
      @open="markPristine"
      :visible.sync="detailDialogVisible"
      width="820px"
      top="6vh"
      custom-class="device-dialog"
      @close="onDetailDialogClosed"
    >
      <div slot="title" v-if="detailDevice" class="dd-head">
        <span class="rowid-mark accent"><i class="el-icon-cpu"></i></span>
        <div class="dd-head-text">
          <div class="dd-head-mac mono">{{ detailDevice.macAddress }}</div>
          <div class="dd-head-sub">
            {{ detailDevice.userName || 'Not bound' }}
            <span class="dd-dot">·</span> FW {{ detailDevice.appVersion || '-' }}
            <span class="dd-dot">·</span> Last connected ({{ dayFormatHint }}) {{ formatDate(detailDevice.lastConnectedAt) }}
          </div>
        </div>
        <div class="dd-head-actions">
          <el-button size="small" icon="el-icon-user" :disabled="!detailDevice.userId" @click="goKidProfile">Kid Profile</el-button>
          <el-button size="small" icon="el-icon-link" class="dd-unbind" :disabled="!detailDevice.userId" @click="handleUnbind(detailDevice)">Unbind</el-button>
        </div>
      </div>

      <el-tabs v-if="detailDevice" v-model="detailTab" class="dd-tabs">
        <!-- ============ Overview ============ -->
        <el-tab-pane label="Overview" name="overview">
          <section class="dd-section">
            <h4 class="dd-label">Device</h4>
            <dl class="dd-grid">
              <div class="dd-field"><dt>Parent</dt><dd>{{ detailDevice.userName || 'Not bound' }}</dd></div>
              <div class="dd-field"><dt>Board</dt><dd>{{ detailDevice.board || '-' }}</dd></div>
              <div class="dd-field"><dt>Firmware</dt><dd>{{ detailDevice.appVersion || '-' }}</dd></div>
              <div class="dd-field"><dt>Last connected ({{ dayFormatHint }})</dt><dd>{{ formatDate(detailDevice.lastConnectedAt) }}</dd></div>
              <div class="dd-field"><dt>Added to fleet ({{ dayFormatHint }})</dt><dd>{{ formatDate(detailDevice.createDate) }}</dd></div>
              <div class="dd-field">
                <dt>Active mode</dt>
                <dd>
                  <el-tag :type="getModeTagType(detailDevice.activeMode)" size="mini" effect="plain">
                    <i :class="getModeIcon(detailDevice.activeMode)"></i>
                    {{ detailDevice.activeMode || 'idle' }}
                  </el-tag>
                </dd>
              </div>
              <div class="dd-field">
                <dt>Mode</dt>
                <dd class="dd-switch">
                  <el-switch
                    v-model="detailDevice.modeSwitch"
                    active-color="#16130F"
                    inactive-color="#E7E2D9"
                    @change="handleModeSwitchChange(detailDevice)"
                  />
                  <span>{{ detailDevice.modeSwitch ? 'Auto' : 'Manual' }}</span>
                </dd>
              </div>
              <div class="dd-field">
                <dt>OTA auto-update</dt>
                <dd class="dd-switch">
                  <el-switch
                    v-model="detailDevice.otaSwitch"
                    active-color="#16130F"
                    inactive-color="#E7E2D9"
                    @change="handleOtaSwitchChange(detailDevice)"
                  />
                  <span>{{ detailDevice.otaSwitch ? 'On' : 'Off' }}</span>
                </dd>
              </div>
            </dl>
          </section>

          <section class="dd-section">
            <h4 class="dd-label">Alias</h4>
            <div class="dd-inline">
              <el-input
                v-model="detailAlias"
                size="small"
                placeholder="No alias"
                class="dd-alias-input"
                @keyup.enter.native="saveDetailAlias"
              />
              <el-button size="small" :disabled="!aliasChanged" @click="saveDetailAlias">Save</el-button>
            </div>
          </section>

          <section class="dd-section">
            <h4 class="dd-label">Warranty</h4>
            <div class="dd-summary" @click="detailTab = 'warranty'">
              <span class="dd-status" :class="`is-${warrantyTag.tone}`">
                <i class="dd-status-dot"></i>{{ warrantyLoading ? 'Loading…' : warrantyTag.label }}
              </span>
              <span v-if="warranty && warranty.registered" class="dd-summary-text">
                Ends ({{ dayFormatHint }}) {{ formatDay(warranty.warrantyEnd) }} · {{ warranty.daysRemaining }} days left
              </span>
              <span class="dd-summary-link">View <i class="el-icon-arrow-right"></i></span>
            </div>
          </section>
        </el-tab-pane>

        <!-- ============ Settings ============ -->
        <el-tab-pane label="Settings" name="settings">
          <div class="dd-toolbar dd-strip">
            <div class="dd-strip-meta">
              <span>
                Sync
                <el-tag :type="getSyncStatusTagType(settingsMeta.syncStatus)" size="mini">
                  {{ settingsMeta.syncStatus || 'unknown' }}
                </el-tag>
              </span>
              <span>Version <strong>{{ settingsMeta.settingsVersion || '-' }}</strong></span>
              <span>Applied <strong>{{ settingsMeta.lastAppliedVersion || '-' }}</strong></span>
            </div>
            <div class="dd-inline">
              <el-button size="small" icon="el-icon-refresh" :loading="settingsLoading" @click="loadSettingsTab">Refresh</el-button>
              <el-button size="small" type="primary" :loading="settingsSaving" :disabled="settingsLoading" @click="saveDeviceSettings">Save & Sync</el-button>
            </div>
          </div>

          <el-skeleton :rows="8" animated v-if="settingsLoading" />
          <template v-else>
            <section class="dd-section">
              <h4 class="dd-label">Runtime state</h4>
              <dl class="dd-grid">
                <div class="dd-field"><dt>Online</dt><dd>{{ yesNo(runtimeState.online) }}</dd></div>
                <div class="dd-field"><dt>Last seen ({{ dayFormatHint }})</dt><dd>{{ formatDate(runtimeState.last_seen_at) }}</dd></div>
                <div class="dd-field"><dt>Mode</dt><dd>{{ runtimeState.mode || '-' }}</dd></div>
                <div class="dd-field"><dt>Network</dt><dd>{{ runtimeState.network || '-' }}</dd></div>
                <div class="dd-field"><dt>Battery</dt><dd>{{ runtimeState.battery != null ? runtimeState.battery + '%' : '-' }}</dd></div>
                <div class="dd-field"><dt>Charging</dt><dd>{{ yesNo(runtimeState.charging) }}</dd></div>
                <div class="dd-field"><dt>Firmware</dt><dd>{{ runtimeState.firmware || '-' }}</dd></div>
                <div class="dd-field"><dt>Build label</dt><dd>{{ runtimeState.build_label || '-' }}</dd></div>
              </dl>
            </section>

            <section class="dd-section">
              <h4 class="dd-label">Settings</h4>
              <el-form :model="settingsForm" label-width="150px" size="small" class="dd-form">
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
            </section>

            <section class="dd-section">
              <h4 class="dd-label">Recent sync events</h4>
              <el-table :data="syncEvents" size="mini" max-height="240" style="width: 100%" class="dd-table">
                <el-table-column :label="`Time (${dayFormatHint})`" min-width="170">
                  <template slot-scope="scope">{{ formatDate(scope.row.created_at) }}</template>
                </el-table-column>
                <el-table-column label="Type" prop="event_type" min-width="120" />
                <el-table-column label="Version" min-width="90">
                  <template slot-scope="scope">{{ scope.row.version == null ? '-' : scope.row.version }}</template>
                </el-table-column>
                <el-table-column label="Status" prop="status" min-width="120" />
                <el-table-column label="Reason" prop="reason" min-width="220" show-overflow-tooltip />
              </el-table>
            </section>
          </template>
        </el-tab-pane>

        <!-- ============ Analytics ============ -->
        <el-tab-pane label="Analytics" name="analytics">
          <div class="dd-toolbar">
            <el-radio-group v-model="analyticsPeriod" size="mini" @change="onAnalyticsPeriodChange">
              <el-radio-button label="today">Today</el-radio-button>
              <el-radio-button label="week">Week</el-radio-button>
              <el-radio-button label="month">Month</el-radio-button>
            </el-radio-group>
            <el-button size="small" icon="el-icon-refresh" :loading="analyticsLoading" @click="loadAnalyticsTab">Refresh</el-button>
          </div>

          <el-skeleton :rows="6" animated v-if="analyticsLoading" />
          <template v-else>
            <div class="dd-stats">
              <div v-for="tile in analyticsTiles" :key="tile.label" class="dd-stat">
                <div class="dd-stat-value">{{ tile.value }}</div>
                <div class="dd-stat-label">{{ tile.label }}</div>
              </div>
            </div>
            <p class="dd-note">
              Usage window {{ progressSummary.startDate || '-' }} to {{ progressSummary.endDate || '-' }}
              <span class="dd-dot">·</span> Latest battery {{ latestBattery != null ? latestBattery + '%' : '-' }}
            </p>

            <section class="dd-section" v-if="analyticsPeriod !== 'today'">
              <h4 class="dd-label">Daily trend ({{ analyticsPeriod }})</h4>
              <el-table :data="progressTrend.slice().reverse()" size="mini" max-height="240" style="width: 100%" class="dd-table">
                <el-table-column label="Date" prop="date" min-width="120" />
                <el-table-column label="Usage (min)" min-width="95">
                  <template slot-scope="scope">{{ formatMinutesFromSeconds(scope.row.usageTimeSeconds) }}</template>
                </el-table-column>
                <el-table-column label="Card Taps" prop="cardTapCount" min-width="90" />
                <el-table-column label="AI Count" prop="aiInteractionCount" min-width="85" />
                <el-table-column label="Games" prop="gamesPlayed" min-width="80" />
              </el-table>
            </section>

            <section class="dd-section">
              <h4 class="dd-label">Recent firmware events</h4>
              <el-table :data="analyticsEvents" size="mini" max-height="260" style="width: 100%" class="dd-table">
                <el-table-column :label="`Time (${dayFormatHint})`" min-width="170">
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
            </section>
          </template>
        </el-tab-pane>

        <!-- ============ Warranty ============ -->
        <el-tab-pane label="Warranty" name="warranty">
          <el-skeleton :rows="4" animated v-if="warrantyLoading" />

          <div v-else-if="warrantyError" class="dd-empty">
            <p>Couldn't load the warranty: {{ warrantyError }}</p>
            <el-button size="small" @click="loadWarranty">Retry</el-button>
          </div>

          <el-form v-else-if="warrantyEditing" :model="warrantyForm" label-width="150px" size="small" class="dd-form">
            <!-- el-date-picker displays yyyy-MM-dd by default, not the locale order -->
            <el-form-item label="Start (YYYY-MM-DD)">
              <el-date-picker v-model="warrantyForm.warrantyStart" type="date" value-format="yyyy-MM-dd" placeholder="Start date" />
            </el-form-item>
            <el-form-item label="End (YYYY-MM-DD)">
              <el-date-picker
                v-model="warrantyForm.warrantyEnd"
                type="date"
                value-format="yyyy-MM-dd"
                :placeholder="`Start + ${warranty.warrantyMonths} months`"
              />
            </el-form-item>
            <el-form-item label="Note">
              <el-input v-model="warrantyForm.note" type="textarea" :rows="3" maxlength="500" placeholder="e.g. extended after a repair" />
            </el-form-item>
            <el-form-item>
              <el-button @click="warrantyEditing = false">Cancel</el-button>
              <el-button type="primary" :loading="warrantySaving" @click="saveWarranty">Save</el-button>
            </el-form-item>
          </el-form>

          <template v-else-if="warranty && warranty.registered">
            <div class="dd-hero" :class="`is-${warrantyTag.tone}`">
              <div class="dd-hero-top">
                <span class="dd-status" :class="`is-${warrantyTag.tone}`">
                  <i class="dd-status-dot"></i>{{ warrantyTag.label }}
                </span>
                <span class="dd-hero-days">
                  <strong>{{ warranty.daysRemaining }}</strong> days remaining
                </span>
              </div>
              <div class="dd-bar"><div class="dd-bar-fill" :style="{ width: warrantyElapsed + '%' }"></div></div>
              <div class="dd-hero-range">
                <span>{{ formatDay(warranty.warrantyStart) }}</span>
                <span>({{ dayFormatHint }})</span>
                <span>{{ formatDay(warranty.warrantyEnd) }}</span>
              </div>
            </div>

            <section class="dd-section">
              <h4 class="dd-label">Registration</h4>
              <dl class="dd-grid">
                <div class="dd-field">
                  <dt>First activated ({{ dayFormatHint }})</dt>
                  <dd>{{ warranty.activatedAt ? formatDate(warranty.activatedAt) : 'Added by admin' }}</dd>
                </div>
                <div class="dd-field"><dt>First registered by</dt><dd>{{ personName(warranty.firstUser) }}</dd></div>
                <div class="dd-field"><dt>Warranty start ({{ dayFormatHint }})</dt><dd>{{ formatDay(warranty.warrantyStart) }}</dd></div>
                <div class="dd-field"><dt>Warranty end ({{ dayFormatHint }})</dt><dd>{{ formatDay(warranty.warrantyEnd) }}</dd></div>
                <div class="dd-field"><dt>Period</dt><dd>{{ warranty.warrantyMonths }} months</dd></div>
                <div class="dd-field">
                  <dt>Last edited ({{ dayFormatHint }})</dt>
                  <dd>{{ warranty.updateDate ? `${formatDate(warranty.updateDate)} by ${personName(warranty.updatedBy)}` : '-' }}</dd>
                </div>
                <div v-if="warranty.note" class="dd-field span-all"><dt>Note</dt><dd>{{ warranty.note }}</dd></div>
              </dl>
            </section>

            <div class="dd-inline dd-actions">
              <el-button size="small" @click="startWarrantyEdit">Edit</el-button>
              <el-button size="small" type="text" class="danger-btn" @click="deleteWarranty">Delete record</el-button>
            </div>
          </template>

          <div v-else-if="warranty" class="dd-empty">
            <p>No warranty yet. It starts the first time a parent activates this toy with its 6-digit code.</p>
            <el-button size="small" @click="startWarrantyEdit">Add warranty</el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <version-footer />
  </div>
</template>

<script>
import dialogDismiss from '@/mixins/dialogDismiss';
import Api from '@/apis/api'
import VersionFooter from '@/components/VersionFooter.vue'
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';

export default {
  name: 'AllDevices',
  components: { VersionFooter, ListToolbar },
  mixins: [listControls, dialogDismiss],
  data() {
    return {
      // list controls
      rowKey: 'macAddress',
      sortBy: 'lastConnectedAt',
      sortDir: 'desc',
      sortOptions: [
        { label: 'Last connected', value: 'lastConnectedAt' },
        { label: 'MAC address', value: 'macAddress' },
        { label: 'Firmware', value: 'appVersion' },
        { label: 'Parent', value: 'userName' }
      ],
      searchFields: ['macAddress', 'alias', 'userName'],
      loading: false,
      deviceList: [],
      currentPage: 1,
      pageSize: 20,
      // device popup
      detailDialogVisible: false,
      detailDevice: null,
      detailTab: 'overview',
      detailAlias: '',
      // warranty tab
      warranty: null,
      warrantyLoading: false,
      warrantyError: '',
      warrantyEditing: false,
      warrantySaving: false,
      warrantyForm: { warrantyStart: '', warrantyEnd: '', note: '' },
      // settings tab
      settingsLoaded: false,
      settingsLoading: false,
      settingsSaving: false,
      settingsMeta: {
        syncStatus: null,
        settingsVersion: null,
        lastAckStatus: null,
        lastAckReason: null,
        lastAppliedVersion: null
      },
      runtimeState: {},
      syncEvents: [],
      // analytics tab
      analyticsLoaded: false,
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
    // Spells out the date order formatDay/formatDate's locale output uses, e.g. MM/DD/YYYY
    dayFormatHint() {
      const names = { day: 'DD', month: 'MM', year: 'YYYY' };
      return new Intl.DateTimeFormat().formatToParts(new Date())
        .map(p => names[p.type] || p.value).join('');
    },
    // The mixin searches and sorts the whole list; the page is a slice of the
    // result, so paging cannot reorder rows and search spans every device.
    paginatedDeviceList() {
      const start = (this.currentPage - 1) * this.pageSize;
      return this.visibleRows.slice(start, start + this.pageSize);
    },
    sourceRows() {
      return this.deviceList;
    },
    aliasChanged() {
      return !!this.detailDevice && this.detailAlias.trim() !== (this.detailDevice._originalAlias || '');
    },
    warrantyTag() {
      const status = this.warranty && this.warranty.status;
      if (status === 'active') return { tone: 'success', label: 'Active' };
      if (status === 'expired') return { tone: 'danger', label: 'Expired' };
      if (this.warrantyError) return { tone: 'muted', label: 'Unavailable' };
      return { tone: 'muted', label: 'Not registered' };
    },
    // How much of the warranty period has passed, for the progress bar
    warrantyElapsed() {
      const w = this.warranty;
      if (!w || !w.registered) return 0;
      const start = new Date(w.warrantyStart).getTime();
      const end = new Date(w.warrantyEnd).getTime();
      if (end <= start) return 100;
      return Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100)));
    },
    latestBattery() {
      const latest = this.analyticsBattery && this.analyticsBattery.latest;
      return latest && latest.battery != null ? latest.battery : null;
    },
    analyticsTiles() {
      const s = this.progressSummary || {};
      const minutes = key => `${this.formatMinutesFromSeconds(this.getUsageDurationSeconds(key))} min`;
      return [
        { label: 'Total usage', value: `${this.formatMinutesFromSeconds(s.usageTimeSeconds)} min` },
        { label: 'Card taps', value: s.cardTapCount || 0 },
        { label: 'AI interactions', value: s.aiInteractionCount || 0 },
        { label: 'Games played', value: s.gamesPlayed || 0 },
        { label: 'AI talk', value: minutes('ai_talk') },
        { label: 'Radio', value: minutes('radio') },
        { label: 'Games', value: minutes('game') },
        { label: 'Cards', value: minutes('card') }
      ];
    }
  },
  watch: {
    listSearch() {
      this.currentPage = 1;
    },
    sortBy() {
      this.currentPage = 1;
    },
    // Each tab fetches its data the first time it is opened
    detailTab(tab) {
      this.loadTab(tab);
    }
  },
  created() {
    this.loadDevices();
  },
  methods: {
    // What would be lost if the backdrop closed the popup
    dirtyState() {
      return {
        settings: this.settingsForm,
        alias: this.detailAlias,
        warranty: this.warrantyEditing ? this.warrantyForm : null
      };
    },

    bulkExport() {
      const rows = this.selectedRows;
      if (!rows.length) {
        this.$message.warning('Nothing to export.');
        return;
      }
      const cols = ['macAddress', 'alias', 'userName', 'firmwareVersion', 'lastConnectedAt'];
      const escape = value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
      const csv = [cols.join(',')]
        .concat(rows.map(row => cols.map(col => escape(row[col])).join(',')))
        .join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'devices.csv';
      link.click();
      URL.revokeObjectURL(url);
    },
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
            board: device.board || device.deviceType,
            appVersion: device.appVersion || device.app_version,
            lastConnectedAt: device.lastConnectedAt || device.last_connected_at || device.recentChatTime,
            createDate: device.createDate,
            userId: device.userId || device.user_id,
            userName: device.bindUserName || device.userName || device.username,
            agentId: device.agentId || device.agent_id,
            kidId: device.kidId || device.kid_id,
            deviceMode: device.deviceMode || device.device_mode || 'manual',
            modeSwitch: (device.deviceMode || device.device_mode || 'manual') === 'auto',
            otaSwitch: (device.autoUpdate || device.otaUpgrade || device.auto_update) === 1,
            activeMode: device.activeMode || device.active_mode || device.currentMode || 'idle'
          }));
        } else {
          this.$message.error(data.msg || 'Failed to load devices');
        }
      });
    },
    refreshList() {
      this.loadDevices();
    },
    handlePageChange(page) {
      this.currentPage = page;
    },
    formatDate(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleString();
    },
    formatDay(dateStr) {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleDateString();
    },
    // yyyy-MM-dd in local time, the date picker's value-format
    toPickerDay(dateStr) {
      const d = dateStr ? new Date(dateStr) : new Date();
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    personName(person) {
      if (!person) return '-';
      return person.name || `User #${person.id}`;
    },
    yesNo(value) {
      if (value === true) return 'Yes';
      if (value === false) return 'No';
      return '-';
    },

    // ---------- device popup ----------
    onRowClick(row, column) {
      if (column && column.type === 'selection') return;
      this.openDeviceDialog(row);
    },
    openDeviceDialog(row, tab = 'overview') {
      this.resetDetailState();
      this.detailDevice = row;
      this.detailAlias = row.alias || '';
      this.detailTab = tab;
      this.detailDialogVisible = true;
      // The overview shows a warranty summary, so it loads with the popup
      this.loadWarranty();
      this.loadTab(tab);
    },
    resetDetailState() {
      this.warranty = null;
      this.warrantyLoading = false;
      this.warrantyError = '';
      this.warrantyEditing = false;
      this.settingsLoaded = false;
      this.settingsLoading = false;
      this.settingsSaving = false;
      this.settingsMeta = {
        syncStatus: null,
        settingsVersion: null,
        lastAckStatus: null,
        lastAckReason: null,
        lastAppliedVersion: null
      };
      this.runtimeState = {};
      this.syncEvents = [];
      this.settingsForm = this.getDefaultSettingsForm();
      this.analyticsLoaded = false;
      this.analyticsLoading = false;
      this.analyticsPeriod = 'today';
      this.progressSummary = {};
      this.progressUsageBreakdown = [];
      this.progressTrend = [];
      this.analyticsEvents = [];
      this.analyticsBattery = null;
    },
    onDetailDialogClosed() {
      this.detailDevice = null;
      this.resetDetailState();
    },
    // A response for a device the popup has since moved on from is dropped
    isCurrentDevice(mac) {
      return !!this.detailDevice && this.detailDevice.macAddress === mac;
    },
    loadTab(tab) {
      if (!this.detailDevice) return;
      if (tab === 'settings' && !this.settingsLoaded) this.loadSettingsTab();
      if (tab === 'analytics' && !this.analyticsLoaded) this.loadAnalyticsTab();
    },
    saveDetailAlias() {
      if (!this.aliasChanged) return;
      this.detailDevice.alias = this.detailAlias;
      this.submitAlias(this.detailDevice);
    },
    goKidProfile() {
      const row = this.detailDevice;
      this.detailDialogVisible = false;
      this.handleKidProfile(row);
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
            this.detailDialogVisible = false;
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

    // ---------- settings tab ----------
    loadSettingsTab() {
      const mac = this.detailDevice && this.detailDevice.macAddress;
      if (!mac) return;
      this.settingsLoaded = true;
      this.settingsLoading = true;

      Promise.all([
        this.fetchDeviceSettings(mac),
        this.fetchDeviceRuntimeState(mac),
        this.fetchDeviceSyncEvents(mac, 20)
      ]).then(([settingsRes, stateRes, eventsRes]) => {
        if (!this.isCurrentDevice(mac)) return;
        const settingsData = settingsRes?.data || {};
        const eventsData = eventsRes?.data?.events || [];

        this.settingsMeta = {
          syncStatus: settingsData.syncStatus || null,
          settingsVersion: settingsData.settingsVersion || null,
          lastAckStatus: settingsData.lastAckStatus || null,
          lastAckReason: settingsData.lastAckReason || null,
          lastAppliedVersion: settingsData.lastAppliedVersion || null
        };
        this.runtimeState = stateRes?.data?.state || {};
        this.syncEvents = Array.isArray(eventsData) ? eventsData : [];
        this.settingsForm = this.mapSettingsDataToForm(settingsData.settings || {});
        // The loaded values are the baseline, not an edit
        this.markPristine();
      }).catch((error) => {
        if (this.isCurrentDevice(mac)) this.$message.error(error?.message || 'Failed to load settings sync data');
      }).finally(() => {
        if (this.isCurrentDevice(mac)) this.settingsLoading = false;
      });
    },

    // ---------- analytics tab ----------
    loadAnalyticsTab() {
      const mac = this.detailDevice && this.detailDevice.macAddress;
      if (!mac) return;
      this.analyticsLoaded = true;
      this.analyticsLoading = true;

      Promise.all([
        this.fetchDeviceAnalyticsEvents(mac, 20),
        this.fetchDeviceAnalyticsBattery(mac)
      ]).then(([analyticsEventsRes, batteryRes]) => {
        if (!this.isCurrentDevice(mac)) return;
        const analyticsEventsData = analyticsEventsRes?.data?.events || [];
        this.analyticsEvents = Array.isArray(analyticsEventsData) ? analyticsEventsData : [];
        this.analyticsBattery = batteryRes?.data || null;
      }).catch((error) => {
        if (this.isCurrentDevice(mac)) this.$message.error(error?.message || 'Failed to load analytics');
      }).then(() => this.loadProgressAnalyticsForPeriod());
    },
    onAnalyticsPeriodChange() {
      this.loadProgressAnalyticsForPeriod();
    },
    loadProgressAnalyticsForPeriod() {
      if (!this.detailDevice || !this.detailDevice.macAddress) {
        return Promise.resolve();
      }
      const mac = this.detailDevice.macAddress;
      const period = this.analyticsPeriod || 'today';
      const trendPeriod = period === 'today' ? null : period;

      this.analyticsLoading = true;
      return Promise.all([
        this.fetchDeviceProgressSummary(mac, period),
        this.fetchDeviceProgressDetails(mac, 'usage', period),
        trendPeriod ? this.fetchDeviceProgressTrend(mac, trendPeriod) : Promise.resolve({ data: { points: [] } }),
      ]).then(([summaryRes, usageRes, trendRes]) => {
        if (!this.isCurrentDevice(mac)) return;
        this.progressSummary = summaryRes?.data || {};
        this.progressUsageBreakdown = Array.isArray(usageRes?.data?.items) ? usageRes.data.items : [];
        this.progressTrend = Array.isArray(trendRes?.data?.points) ? trendRes.data.points : [];
      }).catch((error) => {
        if (this.isCurrentDevice(mac)) this.$message.error(error?.message || 'Failed to load progress analytics');
      }).finally(() => {
        if (this.isCurrentDevice(mac)) this.analyticsLoading = false;
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
      if (!this.detailDevice || !this.detailDevice.macAddress) {
        return;
      }

      const qhStart = this.settingsForm.quiet_hours?.start;
      const qhEnd = this.settingsForm.quiet_hours?.end;
      if (!this.isValidHourMinute(qhStart) || !this.isValidHourMinute(qhEnd)) {
        this.$message.warning('Quiet hours start/end must be in HH:mm format');
        return;
      }

      const mac = this.detailDevice.macAddress;
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
          this.loadSettingsTab();
        } else {
          this.$message.error(data?.msg || 'Failed to save settings');
        }
      });
    },

    // ---------- warranty tab ----------
    loadWarranty() {
      const mac = this.detailDevice && this.detailDevice.macAddress;
      if (!mac) return;
      this.warrantyLoading = true;
      this.warrantyError = '';
      Api.admin.getDeviceWarranty(mac, ({ data }) => {
        if (!this.isCurrentDevice(mac)) return;
        this.warrantyLoading = false;
        if (data && data.code === 0) {
          this.warranty = data.data;
        } else {
          this.warranty = null;
          this.warrantyError = (data && data.msg) || 'request failed';
        }
      });
    },
    startWarrantyEdit() {
      const w = this.warranty;
      this.warrantyForm = w && w.registered
        ? { warrantyStart: this.toPickerDay(w.warrantyStart), warrantyEnd: this.toPickerDay(w.warrantyEnd), note: w.note || '' }
        : { warrantyStart: this.toPickerDay(), warrantyEnd: '', note: '' };
      this.warrantyEditing = true;
    },
    saveWarranty() {
      const { warrantyStart, warrantyEnd, note } = this.warrantyForm;
      if (!warrantyStart) {
        this.$message.warning('Pick a start date');
        return;
      }
      if (warrantyEnd && warrantyEnd < warrantyStart) {
        this.$message.warning('End date cannot be before the start date');
        return;
      }
      const mac = this.detailDevice.macAddress;
      this.warrantySaving = true;
      Api.admin.updateDeviceWarranty(mac, { warrantyStart, warrantyEnd: warrantyEnd || null, note }, ({ data }) => {
        this.warrantySaving = false;
        if (!this.isCurrentDevice(mac)) return;
        if (data && data.code === 0) {
          this.warranty = data.data;
          this.warrantyEditing = false;
          this.markPristine();
          this.$message.success('Warranty saved');
        } else {
          this.$message.error((data && data.msg) || 'Failed to save warranty');
        }
      });
    },
    deleteWarranty() {
      const mac = this.detailDevice.macAddress;
      this.$confirm(
        'Delete this warranty record? The next time a parent activates this toy with its 6-digit code, a fresh warranty starts.',
        'Delete warranty',
        { confirmButtonText: 'Delete', cancelButtonText: 'Cancel', type: 'warning' }
      ).then(() => {
        Api.admin.deleteDeviceWarranty(mac, ({ data }) => {
          if (data && data.code === 0) {
            this.$message.success('Warranty record deleted');
            if (this.isCurrentDevice(mac)) this.loadWarranty();
          } else {
            this.$message.error((data && data.msg) || 'Failed to delete warranty');
          }
        });
      }).catch(() => {});
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
@import '@/styles/theme.scss';

.welcome {
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.main-content {
  // The layout already provides the page gutter; a second one pushed the
  // whole page in from the rail.
  flex: 1;
  padding: 0;
  max-width: 1440px;
  margin: 0;
  width: 100%;
}

.content-area {
  background: transparent;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
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

.devices-table ::v-deep .el-table__row {
  cursor: pointer;
}

.danger-btn {
  color: $danger !important;
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
  color: $text-light;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: $text-light;

  i {
    font-size: 48px;
    margin-bottom: 15px;
  }

  p {
    margin: 0;
  }
}

// ============ Device popup ============
.dd-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 36px; // clear of the close button
}

.dd-head-text {
  min-width: 0;
}

.dd-head-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.dd-unbind:not(.is-disabled) {
  color: $danger;
  border-color: rgba(153, 49, 41, 0.35);

  &:hover,
  &:focus {
    color: $danger;
    background: $danger-bg;
    border-color: $danger;
  }
}

.dd-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dd-head-mac {
  font-size: 18px;
  color: $text-dark;
  letter-spacing: 0.02em;
}

.dd-head-sub {
  margin-top: 3px;
  font-size: 12.5px;
  color: $text-light;
}

.dd-dot {
  margin: 0 4px;
}

// The tab bar stays put; only the tab's content scrolls
.dd-tabs ::v-deep .el-tabs__header {
  margin-bottom: 20px;
}

.dd-tabs ::v-deep .el-tabs__content {
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}

.dd-section + .dd-section,
.dd-strip + .dd-section,
.dd-hero + .dd-section {
  margin-top: 24px;
}

.dd-label {
  margin: 0 0 10px;
  font-family: $font-mono;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: $text-light;
}

// Hairline grid: the 1px gap shows the divider colour between cells
.dd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  background: $divider-color;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  overflow: hidden;
}

.dd-field {
  padding: 11px 14px;
  background: $surface;

  dt {
    margin-bottom: 4px;
    font-size: 11.5px;
    color: $text-light;
  }

  dd {
    margin: 0;
    min-height: 20px;
    font-size: 13.5px;
    color: $text-dark;
    word-break: break-word;
  }

  &.span-all {
    grid-column: 1 / -1;
  }
}

.dd-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.dd-alias-input {
  width: 260px;
}

.dd-actions {
  margin-top: 16px;
}

.dd-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  cursor: pointer;

  &:hover {
    background: $background-soft;
  }
}

.dd-summary-text {
  font-size: 13px;
  color: $text-body;
}

.dd-summary-link {
  margin-left: auto;
  font-size: 12.5px;
  color: $text-light;
}

.dd-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 550;
  color: $text-gray;

  &.is-success { color: $success; }
  &.is-danger { color: $danger; }
}

.dd-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.dd-strip-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
}

.dd-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  padding: 8px 8px 8px 14px;
  background: $surface-sunk;
  border-radius: $radius-md;
  font-size: 13px;
  color: $text-light;

  strong {
    margin-left: 4px;
    color: $text-dark;
    font-weight: 550;
  }

  .el-tag {
    margin-left: 6px;
  }
}

.dd-form {
  padding: 16px 16px 0 0;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.dd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.dd-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: $divider-color;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  overflow: hidden;
}

.dd-stat {
  padding: 14px;
  background: $surface;
}

.dd-stat-value {
  font-size: 20px;
  letter-spacing: -0.02em;
  color: $text-dark;
}

.dd-stat-label {
  margin-top: 2px;
  font-size: 11.5px;
  color: $text-light;
}

.dd-note {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: $text-light;
}

.dd-table {
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.dd-hero {
  padding: 16px 18px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $background-soft;

  &.is-success { background: $success-bg; border-color: transparent; }
  &.is-danger { background: $danger-bg; border-color: transparent; }
}

.dd-hero-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.dd-hero-days {
  font-size: 13px;
  color: $text-body;

  strong {
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: $text-dark;
  }
}

.dd-bar {
  height: 6px;
  margin: 12px 0 6px;
  border-radius: 3px;
  background: rgba(22, 19, 15, 0.08);
  overflow: hidden;
}

.dd-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: currentColor;
  color: $text-gray;

  .is-success & { color: $success; }
  .is-danger & { color: $danger; }
}

.dd-hero-range {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: $text-light;
}

.dd-empty {
  padding: 28px 20px;
  text-align: center;
  border: 1px dashed $border-color;
  border-radius: $radius-md;

  p {
    margin: 0 0 12px;
    font-size: 13px;
    color: $text-body;
  }
}

@media (max-width: 860px) {
  .dd-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
