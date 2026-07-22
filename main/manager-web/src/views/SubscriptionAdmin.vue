<template>
  <div class="subscription-admin">
    <HeaderBar />
    <div class="page-body">
      <!-- Metrics -->
      <el-card shadow="never" class="block">
        <div slot="header">Subscription Metrics (last 30 days)</div>
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
            <div class="metric-label">Churn events 30d</div>
            <div class="metric-value">{{ churnTotal }}</div>
          </div>
        </div>
        <div v-if="metrics && Object.keys(metrics.gate_hits_30d).length" class="gate-hits">
          <span class="metric-label">Gate hits by reason:</span>
          <el-tag v-for="(count, reason) in metrics.gate_hits_30d" :key="reason" size="small" class="gate-tag">
            {{ reason }}: {{ count }}
          </el-tag>
        </div>
      </el-card>

      <!-- Search -->
      <el-card shadow="never" class="block">
        <div slot="header">Find a subscription</div>
        <el-input
          v-model="query"
          placeholder="MAC fragment, parent email, name or phone"
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

        <el-table v-if="results.length" :data="results" size="small" class="results-table">
          <el-table-column prop="mac_address" label="MAC" width="170" />
          <el-table-column label="Parent" min-width="160">
            <template slot-scope="{ row }">
              {{ (row.device && (row.device.parent_email || row.device.parent_name)) || '—' }}
            </template>
          </el-table-column>
          <el-table-column prop="status" label="Status" width="90" />
          <el-table-column label="Plan" width="110">
            <template slot-scope="{ row }">{{ row.plan ? row.plan.name : '—' }}</template>
          </el-table-column>
          <el-table-column label="Ends" width="120">
            <template slot-scope="{ row }">{{ fmtDate(row.status === 'trial' ? row.trial_ends_at : row.current_period_end) }}</template>
          </el-table-column>
          <el-table-column label="Actions" width="230">
            <template slot-scope="{ row }">
              <el-button size="mini" :disabled="row.status === 'none'" @click="openComp(row)">Comp days</el-button>
              <el-button size="mini" :disabled="row.status === 'none'" @click="openRegrant(row)">Re-grant trial</el-button>
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

      <!-- Refunds policy note (deliberately informational only) -->
      <el-card shadow="never" class="block refund-note">
        <div slot="header">Refunds</div>
        Refunds are handled in the stores (App Store / Google Play), not here — the 7-day
        policy applies. A store refund reaches us as a RevenueCat CANCELLATION webhook and
        lapses the device automatically; there is nothing to click in this dashboard.
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
    }
  },
  computed: {
    churnTotal() {
      if (!this.metrics) return 0
      return Object.values(this.metrics.churn_30d).reduce((a, b) => a + b, 0)
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
    loadMetrics() {
      subscriptionAdminApi.getMetrics(({ data }) => {
        if (data.code === 0) this.metrics = data.data
      })
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
</style>
