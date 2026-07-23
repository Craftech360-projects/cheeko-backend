<template>
  <div class="subscription-admin">
    <HeaderBar />
    <div class="page-body">
      <!-- Metrics -->
      <el-card shadow="never" class="block">
        <div slot="header" class="metrics-header">
          <span>Subscription Metrics</span>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="yyyy-MM-dd"
            range-separator="–"
            start-placeholder="From"
            end-placeholder="To"
            size="small"
            :clearable="true"
            @change="loadMetrics"
          />
        </div>
        <div v-if="metrics" class="metrics-row">
          <div class="metric">
            <div class="metric-label">Devices bound</div>
            <div class="metric-value">{{ metrics.funnel.devices_bound }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Trials started</div>
            <div class="metric-value">{{ metrics.funnel.trials_started }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">On trial now</div>
            <div class="metric-value">{{ metrics.funnel.trial_now }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Paying now</div>
            <div class="metric-value">{{ metrics.funnel.paid_now }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">In grace</div>
            <div class="metric-value">{{ metrics.funnel.grace_now }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Lapsed</div>
            <div class="metric-value">{{ metrics.funnel.lapsed_now }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">MRR (₹)</div>
            <div class="metric-value">{{ metrics.mrr_inr }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Churn events</div>
            <div class="metric-value">{{ churnTotal }}</div>
          </div>
        </div>
        <div v-if="metrics && Object.keys(metrics.mrr_by_tier).length" class="gate-hits">
          <span class="metric-label">MRR by plan:</span>
          <el-tag v-for="(inr, tier) in metrics.mrr_by_tier" :key="tier" size="small" type="success" class="gate-tag">
            {{ tier }}: ₹{{ inr }}
          </el-tag>
        </div>
        <div v-if="metrics && metrics.trends" class="trends-row">
          <div v-for="t in trendBlocks" :key="t.label" class="trend">
            <div class="metric-label">{{ t.label }} ({{ t.total }})</div>
            <svg viewBox="0 0 120 30" class="spark" preserveAspectRatio="none">
              <polyline :points="sparkPoints(t.series)" fill="none" stroke="#409EFF" stroke-width="1.5" />
            </svg>
          </div>
        </div>
        <div v-if="metrics && Object.keys(metrics.gate_hits).length" class="gate-hits">
          <span class="metric-label">Gate hits by reason (click to drill down):</span>
          <el-tag
            v-for="(count, reason) in metrics.gate_hits"
            :key="reason"
            size="small"
            class="gate-tag gate-tag-click"
            @click.native="openGateHits(reason)"
          >
            {{ reason }}: {{ count }}
          </el-tag>
        </div>
      </el-card>

      <!-- Search -->
      <el-card shadow="never" class="block">
        <div slot="header">Find a subscription</div>
        <el-input
          v-model="query"
          placeholder="MAC, parent email/name/phone, or RevenueCat txn id"
          clearable
          style="max-width: 420px"
          @keyup.enter.native="search"
        >
          <el-button slot="append" icon="el-icon-search" @click="search">Search</el-button>
        </el-input>
        <el-select
          v-model="statusFilter"
          placeholder="Browse by status"
          clearable
          style="width: 180px; margin-left: 12px"
          @change="browseStatus"
        >
          <el-option v-for="s in statuses" :key="s" :label="s" :value="s" />
        </el-select>

        <p v-if="results.length" class="results-hint">Click a row to open the device detail drawer.</p>
        <el-table v-if="results.length" :data="results" size="small" class="results-table row-clickable" @row-click="openDetail">
          <el-table-column prop="mac_address" label="MAC" width="170" />
          <el-table-column label="Parent" min-width="160">
            <template slot-scope="{ row }">
              <div>{{ (row.device && (row.device.parent_email || row.device.parent_name)) || '—' }}</div>
              <div v-if="row.device && row.device.parent_phone" class="sub-line">{{ row.device.parent_phone }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="Status" width="80" />
          <el-table-column label="Plan" width="160">
            <template slot-scope="{ row }">
              <span v-if="row.plan">{{ row.plan.name }} <span class="sub-line">({{ row.plan.tier }})</span> · ₹{{ row.plan.price_inr }}</span>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="Flags" width="150">
            <template slot-scope="{ row }">
              <el-tag v-if="row.cancel_at_period_end" size="mini" type="warning">cancelling</el-tag>
              <el-tag v-if="row.status === 'grace' && row.grace_until" size="mini" type="danger">grace {{ countdown(row.grace_until) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Ends" width="110">
            <template slot-scope="{ row }">{{ fmtDate(row.status === 'trial' ? row.trial_ends_at : row.current_period_end) }}</template>
          </el-table-column>
          <el-table-column label="Actions" width="230">
            <template slot-scope="{ row }">
              <el-button size="mini" :disabled="row.status === 'none'" @click.native.stop="openComp(row)">Comp days</el-button>
              <el-button size="mini" :disabled="row.status === 'none'" @click.native.stop="openRegrant(row)">Re-grant trial</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- Audit trail -->
      <el-card shadow="never" class="block">
        <div slot="header">Recent overrides (audit trail)</div>
        <el-table :data="audit" size="small">
          <el-table-column label="When" width="160">
            <template slot-scope="{ row }">{{ fmtDate(row.created_at, true) }}</template>
          </el-table-column>
          <el-table-column prop="admin_user" label="Admin" width="140" />
          <el-table-column prop="action" label="Action" width="150" />
          <el-table-column prop="mac_address" label="MAC" width="170" />
          <el-table-column prop="reason" label="Reason" min-width="160" />
        </el-table>
      </el-card>

      <!-- Refunds policy note + lookup path -->
      <el-card shadow="never" class="block refund-note">
        <div slot="header">Refunds</div>
        Refunds are handled in the stores (App Store / Google Play), not here — the 7-day
        policy applies. A store refund reaches us as a RevenueCat CANCELLATION webhook and
        lapses the device automatically. To confirm one landed, paste the RevenueCat
        transaction id into the search above, open the device drawer, and check its event
        timeline for the CANCELLATION / EXPIRATION event.
      </el-card>
    </div>

    <!-- Comp/extend dialog -->
    <el-dialog :title="`Comp days — ${dialogMac}`" :visible.sync="compVisible" width="420px">
      <el-form label-width="80px">
        <el-form-item label="Days">
          <el-input-number v-model="compDays" :min="1" :max="365" />
        </el-form-item>
        <el-form-item label="Reason">
          <el-input v-model="dialogReason" placeholder="Why (goes to the audit trail)" />
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button @click="compVisible = false">Cancel</el-button>
        <el-button type="primary" :loading="acting" @click="doComp">Extend</el-button>
      </span>
    </el-dialog>

    <!-- Re-grant trial dialog -->
    <el-dialog :title="`Re-grant trial — ${dialogMac}`" :visible.sync="regrantVisible" width="420px">
      <p class="regrant-note">
        Starts a fresh trial window for this device. The permanent "trial used" flag stays
        set — this is a one-off, audited exception, not a new automatic trial.
      </p>
      <el-form label-width="80px">
        <el-form-item label="Days">
          <el-input-number v-model="regrantDays" :min="1" :max="90" />
        </el-form-item>
        <el-form-item label="Reason">
          <el-input v-model="dialogReason" placeholder="Why (goes to the audit trail)" />
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button @click="regrantVisible = false">Cancel</el-button>
        <el-button type="primary" :loading="acting" @click="doRegrant">Re-grant</el-button>
      </span>
    </el-dialog>

    <!-- Gate-hit drill-down (SUB-20) -->
    <el-dialog :title="`Gate hits — ${gateHits ? gateHits.reason : ''}`" :visible.sync="gateHitsVisible" width="620px">
      <el-table
        v-if="gateHits && gateHits.devices.length"
        :data="gateHits.devices"
        size="small"
        class="row-clickable"
        @row-click="openGateHitDevice"
      >
        <el-table-column prop="mac_address" label="MAC" width="160" />
        <el-table-column prop="alias" label="Device" width="110" />
        <el-table-column prop="parent" label="Parent" min-width="140" />
        <el-table-column prop="flow" label="Flow" width="80" />
        <el-table-column prop="hits" label="Hits" width="60" />
        <el-table-column label="Last hit" width="140">
          <template slot-scope="{ row }">{{ fmtDate(row.last_hit, true) }}</template>
        </el-table-column>
      </el-table>
      <em v-else class="muted">No devices hit this gate in the selected range.</em>
    </el-dialog>

    <!-- Device detail drawer (SUB-18) -->
    <el-drawer
      :title="detail ? `Device — ${detail.mac_address}` : 'Device'"
      :visible.sync="detailVisible"
      size="46%"
      :destroy-on-close="true"
    >
      <div v-loading="detailLoading" class="drawer-body">
        <template v-if="detail">
          <!-- Status & why gated -->
          <div class="drawer-section">
            <el-tag :type="statusTagType(detail.status)" size="small">{{ detail.status }}</el-tag>
            <el-tag v-if="!detail.gate.allowed" type="danger" size="small" class="ml8">gated: {{ detail.gate.reason }}</el-tag>
            <el-tag v-else type="success" size="small" class="ml8">can start sessions</el-tag>
            <span v-if="!detail.enforcement_enabled" class="muted ml8">(enforcement off — verdict is advisory)</span>
          </div>

          <!-- Support actions (SUB-19) — all audited, reason mandatory -->
          <div class="drawer-section">
            <el-button size="mini" :disabled="detail.status === 'none'" @click="openAction('cancel')">
              {{ detail.cancel_at_period_end ? 'Undo cancel' : 'Cancel at period end' }}
            </el-button>
            <el-button size="mini" :disabled="detail.status === 'none'" @click="openAction('status')">Force status</el-button>
            <el-button size="mini" :disabled="detail.status === 'none'" @click="openAction('plan')">Change plan</el-button>
          </div>

          <!-- Plan & limits -->
          <div v-if="detail.plan" class="drawer-section">
            <h4>Plan</h4>
            <div>{{ detail.plan.name }} ({{ detail.plan.tier }}) · ₹{{ detail.plan.price_inr }}/{{ detail.billing_cycle || 'month' }}</div>
            <div class="muted">
              Questions {{ detail.plan.monthly_question_limit }}/mo, {{ detail.plan.daily_question_limit }}/day ·
              {{ detail.plan.daily_minutes_limit }} min/day ·
              Images {{ detail.plan.daily_image_limit == null ? '—' : detail.plan.daily_image_limit + '/day' }}{{ detail.plan.monthly_image_limit == null ? '' : ', ' + detail.plan.monthly_image_limit + '/mo' }}
            </div>
          </div>
          <div v-else class="drawer-section"><em class="muted">No plan on this device.</em></div>

          <!-- Usage vs limits -->
          <div v-if="usageBars.length" class="drawer-section">
            <h4>Usage vs limits</h4>
            <div v-for="b in usageBars" :key="b.label" class="usage-bar">
              <span class="usage-label">{{ b.label }}</span>
              <el-progress :percentage="b.pct" :status="b.pct >= 100 ? 'exception' : undefined" :stroke-width="12" class="usage-progress" />
              <span class="usage-num">{{ b.used }} / {{ b.limit }}</span>
            </div>
          </div>

          <!-- Period / trial / grace -->
          <div class="drawer-section">
            <h4>Period &amp; trial</h4>
            <div v-if="detail.period"><span class="k">Period</span> {{ fmtDate(detail.period.start) }} → {{ fmtDate(detail.period.end) }}</div>
            <div><span class="k">Grace until</span> {{ detail.grace_until ? `${fmtDate(detail.grace_until, true)} (${countdown(detail.grace_until)})` : '—' }}</div>
            <div><span class="k">Cancel at period end</span> {{ detail.cancel_at_period_end ? 'yes' : 'no' }}</div>
            <div v-if="detail.trial"><span class="k">Trial</span> {{ fmtDate(detail.trial.started_at) }} → {{ fmtDate(detail.trial.ends_at) }} · used: {{ detail.trial.used ? 'yes' : 'no' }}</div>
          </div>

          <!-- Store -->
          <div v-if="detail.store" class="drawer-section">
            <h4>Store</h4>
            <div><span class="k">Store</span> {{ detail.store.store || '—' }}</div>
            <div><span class="k">RC txn id</span> {{ detail.store.rc_original_transaction_id || '—' }}</div>
          </div>

          <!-- Event timeline -->
          <div class="drawer-section">
            <h4>Event timeline</h4>
            <el-table v-if="detail.events.length" :data="detail.events" size="mini">
              <el-table-column prop="event_type" label="Event" min-width="150" />
              <el-table-column label="Received" width="150"><template slot-scope="{ row }">{{ fmtDate(row.created_at, true) }}</template></el-table-column>
              <el-table-column label="Processed" width="150"><template slot-scope="{ row }">{{ fmtDate(row.processed_at, true) }}</template></el-table-column>
            </el-table>
            <em v-else class="muted">No webhook events.</em>
          </div>

          <!-- Override history -->
          <div class="drawer-section">
            <h4>Override history</h4>
            <el-table v-if="detail.audit.length" :data="detail.audit" size="mini">
              <el-table-column label="When" width="150"><template slot-scope="{ row }">{{ fmtDate(row.created_at, true) }}</template></el-table-column>
              <el-table-column prop="action" label="Action" min-width="130" />
              <el-table-column prop="admin_user" label="Admin" width="120" />
              <el-table-column prop="reason" label="Reason" min-width="120" />
            </el-table>
            <em v-else class="muted">No overrides.</em>
          </div>
        </template>
      </div>
    </el-drawer>

    <!-- Write-action confirm dialog (SUB-19) -->
    <el-dialog :title="actionTitle" :visible.sync="actionVisible" width="440px" append-to-body>
      <p v-if="actionType === 'cancel'" class="regrant-note">
        {{ detail && detail.cancel_at_period_end
          ? 'Clears the cancel flag — the subscription keeps renewing.'
          : 'Marks the subscription to end at the current period. No refund is issued here.' }}
      </p>
      <el-form label-width="80px">
        <el-form-item v-if="actionType === 'status'" label="Status">
          <el-select v-model="actionStatus" placeholder="Target status">
            <el-option v-for="s in overrideStatuses" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="actionType === 'plan'" label="Plan">
          <el-select v-model="actionTier" placeholder="Target plan">
            <el-option v-for="p in plans" :key="p.tier" :label="`${p.name} (${p.tier}) · ₹${p.price_inr}`" :value="p.tier" />
          </el-select>
        </el-form-item>
        <el-form-item label="Reason">
          <el-input v-model="actionReason" placeholder="Required — goes to the audit trail" />
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button @click="actionVisible = false">Cancel</el-button>
        <el-button type="primary" :loading="actionBusy" :disabled="!actionReady" @click="doAction">Confirm</el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import subscriptionAdminApi from '@/apis/module/subscriptionAdmin'
import HeaderBar from '@/components/HeaderBar.vue'

export default {
  name: 'SubscriptionAdmin',
  components: { HeaderBar },
  data() {
    return {
      metrics: null,
      query: '',
      statusFilter: '',
      statuses: ['trial', 'active', 'grace', 'lapsed', 'cancelled'],
      results: [],
      audit: [],
      compVisible: false,
      regrantVisible: false,
      dialogMac: '',
      dialogReason: '',
      compDays: 7,
      regrantDays: 30,
      acting: false,
      detail: null,
      detailVisible: false,
      detailLoading: false,
      actionType: null,
      actionVisible: false,
      actionReason: '',
      actionStatus: 'active',
      actionTier: '',
      actionBusy: false,
      overrideStatuses: ['active', 'trial', 'lapsed'],
      plans: [],
      dateRange: null,
      gateHits: null,
      gateHitsVisible: false,
    }
  },
  computed: {
    churnTotal() {
      if (!this.metrics) return 0
      return Object.values(this.metrics.churn).reduce((a, b) => a + b, 0)
    },
    trendBlocks() {
      const t = this.metrics && this.metrics.trends
      if (!t) return []
      const sum = (a) => a.reduce((x, y) => x + y, 0)
      return [
        { label: 'Trials started', series: t.trials, total: sum(t.trials) },
        { label: 'Paid events', series: t.paid, total: sum(t.paid) },
        { label: 'Lapses', series: t.lapsed, total: sum(t.lapsed) },
      ]
    },
    usageBars() {
      const d = this.detail
      if (!d || !d.usage || !d.plan) return []
      const u = d.usage.used
      const p = d.plan
      const bars = [
        { label: 'Questions (month)', used: u.questions_month, limit: p.monthly_question_limit },
        { label: 'Questions (today)', used: u.questions_today, limit: p.daily_question_limit },
        { label: 'Minutes (today)', used: u.minutes_today, limit: p.daily_minutes_limit },
      ]
      if (p.daily_image_limit != null && u.images_today != null) {
        bars.push({ label: 'Images (today)', used: u.images_today, limit: p.daily_image_limit })
      }
      return bars
        .filter((b) => b.limit != null && b.used != null)
        .map((b) => ({ ...b, pct: b.limit > 0 ? Math.min(100, Math.round((b.used / b.limit) * 100)) : 0 }))
    },
    actionTitle() {
      const mac = this.detail ? this.detail.mac_address : ''
      if (this.actionType === 'cancel') {
        return `${this.detail && this.detail.cancel_at_period_end ? 'Undo cancel' : 'Cancel at period end'} — ${mac}`
      }
      if (this.actionType === 'status') return `Force status — ${mac}`
      if (this.actionType === 'plan') return `Change plan — ${mac}`
      return ''
    },
    actionReady() {
      if (!this.actionReason.trim()) return false
      if (this.actionType === 'plan') return !!this.actionTier
      return true
    },
  },
  mounted() {
    this.loadMetrics()
    this.loadAudit()
  },
  methods: {
    fmtDate(v, withTime) {
      if (!v) return '—'
      const d = new Date(v)
      const date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
      if (!withTime) return date
      return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    },
    rangeParams() {
      if (!this.dateRange || this.dateRange.length !== 2) return {}
      // End of the picked "to" day, so that day's events are included.
      return { from: this.dateRange[0], to: `${this.dateRange[1]}T23:59:59.999Z` }
    },
    loadMetrics() {
      subscriptionAdminApi.getMetrics(this.rangeParams(), ({ data }) => {
        if (data.code === 0) this.metrics = data.data
      })
    },
    openGateHits(reason) {
      subscriptionAdminApi.getGateHits({ reason, ...this.rangeParams() }, ({ data }) => {
        if (data.code === 0) {
          this.gateHits = data.data
          this.gateHitsVisible = true
        } else {
          this.$message.error(data.msg || 'Drill-down failed')
        }
      })
    },
    openGateHitDevice(row) {
      this.gateHitsVisible = false
      this.openDetail(row)
    },
    sparkPoints(series) {
      if (!series || !series.length) return ''
      const max = Math.max(...series, 1)
      const w = 120
      const h = 30
      const pad = 2
      const step = series.length > 1 ? (w - 2 * pad) / (series.length - 1) : 0
      return series
        .map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - (v / max) * (h - 2 * pad)).toFixed(1)}`)
        .join(' ')
    },
    loadAudit() {
      subscriptionAdminApi.getAuditLog({ limit: 50 }, ({ data }) => {
        if (data.code === 0) this.audit = data.data
      })
    },
    search() {
      const q = this.query.trim()
      if (!q) return
      this.statusFilter = ''
      subscriptionAdminApi.searchSubscriptions(q, ({ data }) => {
        if (data.code === 0) {
          this.results = data.data
          if (!this.results.length) this.$message.info('No devices matched')
        } else {
          this.$message.error(data.msg || 'Search failed')
        }
      })
    },
    browseStatus(status) {
      if (!status) return
      this.query = ''
      subscriptionAdminApi.listByStatus(status, ({ data }) => {
        if (data.code === 0) {
          this.results = data.data
          if (!this.results.length) this.$message.info(`No devices in "${status}"`)
        } else {
          this.$message.error(data.msg || 'List failed')
        }
      })
    },
    countdown(v) {
      if (!v) return ''
      const ms = new Date(v).getTime() - Date.now()
      if (ms <= 0) return 'expired'
      const h = Math.floor(ms / 3600000)
      const days = Math.floor(h / 24)
      if (days >= 1) return `${days}d ${h % 24}h`
      const m = Math.floor((ms % 3600000) / 60000)
      return `${h}h ${m}m`
    },
    statusTagType(s) {
      return { active: 'success', trial: '', grace: 'warning', lapsed: 'info', cancelled: 'danger', none: 'info' }[s] || 'info'
    },
    openDetail(row) {
      if (!row || !row.mac_address) return
      this.detail = null
      this.detailLoading = true
      this.detailVisible = true
      subscriptionAdminApi.getDetail(row.mac_address, ({ data }) => {
        this.detailLoading = false
        if (data.code === 0) this.detail = data.data
        else this.$message.error(data.msg || 'Detail failed')
      })
    },
    openAction(type) {
      this.actionType = type
      this.actionReason = ''
      this.actionStatus = 'active'
      this.actionTier = ''
      if (type === 'plan' && !this.plans.length) {
        subscriptionAdminApi.getPlans(({ data }) => {
          if (data.code === 0) this.plans = data.data
        })
      }
      this.actionVisible = true
    },
    doAction() {
      const mac = this.detail.mac_address
      const reason = this.actionReason.trim()
      const done = ({ data }) => {
        this.actionBusy = false
        if (data.code === 0) {
          this.$message.success('Done')
          this.actionVisible = false
          this.refreshDetail(mac)
          this.afterAction()
        } else {
          this.$message.error(data.msg || 'Action failed')
        }
      }
      this.actionBusy = true
      if (this.actionType === 'cancel') {
        subscriptionAdminApi.setCancel(mac, { cancel: !this.detail.cancel_at_period_end, reason }, done)
      } else if (this.actionType === 'status') {
        subscriptionAdminApi.setStatus(mac, { status: this.actionStatus, reason }, done)
      } else {
        subscriptionAdminApi.changePlan(mac, { tier: this.actionTier, reason }, done)
      }
    },
    refreshDetail(mac) {
      this.detailLoading = true
      subscriptionAdminApi.getDetail(mac, ({ data }) => {
        this.detailLoading = false
        if (data.code === 0) this.detail = data.data
      })
    },
    openComp(row) {
      this.dialogMac = row.mac_address
      this.dialogReason = ''
      this.compDays = 7
      this.compVisible = true
    },
    openRegrant(row) {
      this.dialogMac = row.mac_address
      this.dialogReason = ''
      this.regrantDays = 30
      this.regrantVisible = true
    },
    doComp() {
      this.acting = true
      subscriptionAdminApi.compExtend(this.dialogMac, { days: this.compDays, reason: this.dialogReason }, ({ data }) => {
        this.acting = false
        if (data.code === 0) {
          this.$message.success('Extended')
          this.compVisible = false
          this.afterAction()
        } else {
          this.$message.error(data.msg || 'Extend failed')
        }
      })
    },
    doRegrant() {
      this.acting = true
      subscriptionAdminApi.regrantTrial(this.dialogMac, { days: this.regrantDays, reason: this.dialogReason }, ({ data }) => {
        this.acting = false
        if (data.code === 0) {
          this.$message.success('Trial re-granted')
          this.regrantVisible = false
          this.afterAction()
        } else {
          this.$message.error(data.msg || 'Re-grant failed')
        }
      })
    },
    afterAction() {
      if (this.statusFilter) {
        this.browseStatus(this.statusFilter)
      } else {
        this.search()
      }
      this.loadAudit()
      this.loadMetrics()
    },
  },
}
</script>

<style scoped>
.page-body {
  max-width: 1100px;
  margin: 20px auto;
  padding: 0 16px;
}
.block {
  margin-bottom: 18px;
}
.metrics-row {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.metric-label {
  font-size: 12px;
  color: #909399;
}
.metric-value {
  font-size: 22px;
  font-weight: 600;
}
.gate-hits {
  margin-top: 14px;
}
.gate-tag {
  margin-left: 8px;
}
.gate-tag-click {
  cursor: pointer;
}
.metrics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.trends-row {
  display: flex;
  gap: 32px;
  margin-top: 14px;
}
.trend {
  width: 160px;
}
.spark {
  width: 100%;
  height: 30px;
  margin-top: 4px;
}
.results-table {
  margin-top: 14px;
}
.refund-note {
  color: #606266;
  font-size: 13px;
}
.regrant-note {
  font-size: 13px;
  color: #909399;
  margin: 0 0 12px;
}
.results-hint {
  font-size: 12px;
  color: #909399;
  margin: 14px 0 0;
}
.row-clickable >>> .el-table__row {
  cursor: pointer;
}
.sub-line {
  font-size: 12px;
  color: #909399;
}
.ml8 {
  margin-left: 8px;
}
.muted {
  color: #909399;
  font-size: 12px;
}
.drawer-body {
  padding: 0 20px 20px;
}
.drawer-section {
  margin-bottom: 20px;
}
.drawer-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
}
.drawer-section .k {
  display: inline-block;
  min-width: 150px;
  color: #909399;
}
.usage-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.usage-label {
  width: 130px;
  font-size: 13px;
}
.usage-progress {
  flex: 1;
}
.usage-num {
  width: 80px;
  text-align: right;
  font-size: 12px;
  color: #606266;
}
</style>
