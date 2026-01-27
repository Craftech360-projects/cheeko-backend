<template>
  <div class="welcome">
    <!-- Common Header -->
    <HeaderBar />
    <div class="role-config-container">
      <div class="header-bar">
        <h2 class="page-title">Email Report Settings</h2>
        <p class="page-description">Configure daily email reports for system activity summaries</p>
      </div>

      <el-card class="settings-card" shadow="never">
        <div class="settings-section">
          <div class="section-header">
            <h3>Report Configuration</h3>
          </div>

          <el-form :model="config" label-width="160px" class="config-form">
            <el-form-item label="Daily Reports">
              <el-switch
                v-model="config.enabled"
                active-text="Enabled"
                inactive-text="Disabled"
                @change="handleConfigChange"
              />
            </el-form-item>

            <el-form-item label="Schedule Time">
              <el-select v-model="config.scheduleHour" placeholder="Select hour" @change="handleConfigChange">
                <el-option
                  v-for="hour in 24"
                  :key="hour - 1"
                  :label="formatHour(hour - 1)"
                  :value="hour - 1"
                />
              </el-select>
              <span class="form-hint">Reports will be sent at this hour daily</span>
            </el-form-item>

            <el-form-item label="Timezone">
              <el-select v-model="config.scheduleTimezone" placeholder="Select timezone" @change="handleConfigChange">
                <el-option label="Asia/Kolkata (IST)" value="Asia/Kolkata" />
                <el-option label="America/New_York (EST)" value="America/New_York" />
                <el-option label="America/Los_Angeles (PST)" value="America/Los_Angeles" />
                <el-option label="Europe/London (GMT)" value="Europe/London" />
                <el-option label="Asia/Tokyo (JST)" value="Asia/Tokyo" />
                <el-option label="UTC" value="UTC" />
              </el-select>
            </el-form-item>

            <el-form-item label="Recipients">
              <div class="recipients-list">
                <el-tag
                  v-for="(email, index) in config.recipients"
                  :key="index"
                  closable
                  type="info"
                  @close="removeRecipient(index)"
                  class="recipient-tag"
                >
                  {{ email }}
                </el-tag>
                <el-input
                  v-if="showAddRecipient"
                  v-model="newRecipient"
                  placeholder="Enter email address"
                  size="small"
                  class="new-recipient-input"
                  @keyup.enter.native="addRecipient"
                  @blur="addRecipient"
                  ref="recipientInput"
                />
                <el-button
                  v-else
                  size="small"
                  type="primary"
                  plain
                  @click="showAddRecipientInput"
                  class="add-recipient-btn"
                >
                  <i class="el-icon-plus"></i> Add Recipient
                </el-button>
              </div>
            </el-form-item>

            <el-form-item label="Report Sections">
              <div class="sections-checkboxes">
                <el-checkbox v-model="config.sections.summary" @change="handleConfigChange">Executive Summary</el-checkbox>
                <el-checkbox v-model="config.sections.devices" @change="handleConfigChange">Device Activity</el-checkbox>
                <el-checkbox v-model="config.sections.learning" @change="handleConfigChange">Learning Progress</el-checkbox>
                <el-checkbox v-model="config.sections.content" @change="handleConfigChange">Content Engagement</el-checkbox>
                <el-checkbox v-model="config.sections.tokens" @change="handleConfigChange">Token Usage & Cost</el-checkbox>
                <el-checkbox v-model="config.sections.alerts" @change="handleConfigChange">Alerts & Warnings</el-checkbox>
              </div>
            </el-form-item>
          </el-form>

          <div class="action-buttons">
            <el-button type="primary" :loading="saving" @click="saveConfig">
              <i class="el-icon-check"></i> Save Settings
            </el-button>
            <el-button type="info" plain @click="showTestEmailDialog">
              <i class="el-icon-message"></i> Send Test Email
            </el-button>
            <el-button type="success" plain :loading="generating" @click="generateNow">
              <i class="el-icon-s-promotion"></i> Generate Now
            </el-button>
            <el-button type="warning" plain @click="previewReport">
              <i class="el-icon-view"></i> Preview
            </el-button>
          </div>
        </div>
      </el-card>

      <el-card class="history-card" shadow="never">
        <div class="section-header">
          <h3>Email History</h3>
          <el-button size="small" @click="fetchHistory">
            <i class="el-icon-refresh"></i> Refresh
          </el-button>
        </div>

        <el-table :data="historyList" class="transparent-table" v-loading="historyLoading" empty-text="No email history">
          <el-table-column label="Date" prop="reportDate" min-width="120">
            <template slot-scope="scope">
              {{ formatDate(scope.row.reportDate) }}
            </template>
          </el-table-column>
          <el-table-column label="Recipients" min-width="200">
            <template slot-scope="scope">
              <span>{{ (scope.row.recipients || []).length }} recipient(s)</span>
              <el-tooltip v-if="scope.row.recipients && scope.row.recipients.length > 0" :content="scope.row.recipients.join(', ')" placement="top">
                <i class="el-icon-info" style="margin-left: 4px; color: #909399;"></i>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="Status" min-width="100" align="center">
            <template slot-scope="scope">
              <el-tag :type="getStatusType(scope.row.status)" size="small">
                {{ scope.row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="Error" min-width="150">
            <template slot-scope="scope">
              <span v-if="scope.row.errorMessage" class="error-text">{{ scope.row.errorMessage }}</span>
              <span v-else class="success-text">-</span>
            </template>
          </el-table-column>
          <el-table-column label="Sent At" min-width="160">
            <template slot-scope="scope">
              {{ formatDateTime(scope.row.sentAt) }}
            </template>
          </el-table-column>
          <el-table-column label="Actions" min-width="100" align="center">
            <template slot-scope="scope">
              <el-button
                type="text"
                size="small"
                @click="viewHistoryReport(scope.row)"
                :disabled="!scope.row.reportData"
              >
                <i class="el-icon-view"></i> View
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-container" v-if="historyTotal > historyLimit">
          <el-pagination
            background
            layout="prev, pager, next"
            :total="historyTotal"
            :page-size="historyLimit"
            :current-page.sync="historyPage"
            @current-change="fetchHistory"
          />
        </div>
      </el-card>
    </div>

    <!-- Test Email Dialog -->
    <el-dialog title="Send Test Email" :visible.sync="testEmailDialogVisible" width="400px">
      <el-form>
        <el-form-item label="Recipient Email">
          <el-input v-model="testEmailRecipient" placeholder="Enter email address" />
        </el-form-item>
      </el-form>
      <div slot="footer">
        <el-button @click="testEmailDialogVisible = false">Cancel</el-button>
        <el-button type="primary" :loading="sendingTest" @click="sendTestEmail">Send Test</el-button>
      </div>
    </el-dialog>

    <!-- Preview Dialog -->
    <el-dialog title="Report Preview" :visible.sync="previewDialogVisible" width="700px" top="5vh">
      <div class="preview-container" v-if="previewHtml" v-html="previewHtml"></div>
      <div v-else class="preview-loading">
        <i class="el-icon-loading"></i> Loading preview...
      </div>
      <div slot="footer">
        <el-button @click="previewDialogVisible = false">Close</el-button>
      </div>
    </el-dialog>

    <!-- History Report Dialog -->
    <el-dialog :title="'Report - ' + (selectedHistoryReport.reportDate || '')" :visible.sync="historyReportDialogVisible" width="700px" top="5vh">
      <div class="report-data-container" v-if="selectedHistoryReport.reportData">
        <!-- Summary -->
        <div class="report-section" v-if="selectedHistoryReport.reportData.summary">
          <h4>Executive Summary</h4>
          <div class="report-stats">
            <div class="report-stat">
              <span class="stat-value">{{ selectedHistoryReport.reportData.summary.totalUsers || 0 }}</span>
              <span class="stat-label">Total Users</span>
            </div>
            <div class="report-stat">
              <span class="stat-value">{{ selectedHistoryReport.reportData.summary.totalDevices || 0 }}</span>
              <span class="stat-label">Total Devices</span>
            </div>
            <div class="report-stat">
              <span class="stat-value">{{ selectedHistoryReport.reportData.summary.totalAgents || 0 }}</span>
              <span class="stat-label">AI Agents</span>
            </div>
          </div>
        </div>

        <!-- Devices -->
        <div class="report-section" v-if="selectedHistoryReport.reportData.devices">
          <h4>Device Activity</h4>
          <p>Active Today: <strong>{{ selectedHistoryReport.reportData.devices.activeToday || 0 }}</strong></p>
        </div>

        <!-- Learning -->
        <div class="report-section" v-if="selectedHistoryReport.reportData.learning">
          <h4>Learning Progress</h4>
          <div class="report-stats">
            <div class="report-stat">
              <span class="stat-value">{{ selectedHistoryReport.reportData.learning.totalSessions || 0 }}</span>
              <span class="stat-label">Sessions</span>
            </div>
            <div class="report-stat">
              <span class="stat-value">{{ selectedHistoryReport.reportData.learning.accuracy || 0 }}%</span>
              <span class="stat-label">Accuracy</span>
            </div>
            <div class="report-stat">
              <span class="stat-value">{{ selectedHistoryReport.reportData.learning.totalAttempts || 0 }}</span>
              <span class="stat-label">Attempts</span>
            </div>
          </div>
        </div>

        <!-- Tokens -->
        <div class="report-section" v-if="selectedHistoryReport.reportData.tokens">
          <h4>Token Usage</h4>
          <div class="report-stats">
            <div class="report-stat">
              <span class="stat-value">{{ (selectedHistoryReport.reportData.tokens.totalTokens || 0).toLocaleString() }}</span>
              <span class="stat-label">Total Tokens</span>
            </div>
            <div class="report-stat">
              <span class="stat-value">${{ selectedHistoryReport.reportData.tokens.estimatedCost || '0.00' }}</span>
              <span class="stat-label">Est. Cost</span>
            </div>
          </div>
        </div>

        <!-- Alerts -->
        <div class="report-section" v-if="selectedHistoryReport.reportData.alerts && selectedHistoryReport.reportData.alerts.length > 0">
          <h4>Alerts</h4>
          <div v-for="(alert, index) in selectedHistoryReport.reportData.alerts" :key="index" class="alert-item">
            <el-tag :type="alert.type === 'warning' ? 'warning' : 'info'" size="small">{{ alert.title }}</el-tag>
            <span style="margin-left: 8px;">{{ alert.message }}</span>
          </div>
        </div>

        <!-- Test indicator -->
        <div class="report-section" v-if="selectedHistoryReport.reportData.test">
          <el-tag type="info">Test Email</el-tag>
        </div>
      </div>
      <div v-else class="no-data">
        <i class="el-icon-warning-outline"></i>
        <p>No report data available</p>
      </div>
      <div slot="footer">
        <el-button @click="historyReportDialogVisible = false">Close</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import Api from '@/apis/api';
import HeaderBar from '@/components/HeaderBar.vue';

export default {
  name: 'EmailReportSettings',
  components: {
    HeaderBar
  },
  data() {
    return {
      config: {
        enabled: false,
        scheduleHour: 8,
        scheduleTimezone: 'Asia/Kolkata',
        recipients: [],
        sections: {
          summary: true,
          devices: true,
          learning: true,
          content: true,
          tokens: true,
          alerts: true
        }
      },
      saving: false,
      generating: false,
      loading: true,
      showAddRecipient: false,
      newRecipient: '',
      historyList: [],
      historyTotal: 0,
      historyPage: 1,
      historyLimit: 10,
      historyLoading: false,
      testEmailDialogVisible: false,
      testEmailRecipient: '',
      sendingTest: false,
      previewDialogVisible: false,
      previewHtml: '',
      historyReportDialogVisible: false,
      selectedHistoryReport: { reportData: null }
    };
  },
  created() {
    this.fetchConfig();
    this.fetchHistory();
  },
  methods: {
    fetchConfig() {
      this.loading = true;
      Api.emailReport.getConfig(({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.config = {
            enabled: data.data.enabled || false,
            scheduleHour: data.data.scheduleHour ?? 8,
            scheduleTimezone: data.data.scheduleTimezone || 'Asia/Kolkata',
            recipients: data.data.recipients || [],
            sections: data.data.sections || {
              summary: true,
              devices: true,
              learning: true,
              content: true,
              tokens: true,
              alerts: true
            }
          };
        }
      });
    },

    handleConfigChange() {
      // Debounce auto-save
      if (this.saveTimeout) clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(() => {
        this.saveConfig(true);
      }, 1000);
    },

    saveConfig(silent = false) {
      this.saving = true;
      Api.emailReport.updateConfig(this.config, ({ data }) => {
        this.saving = false;
        if (data.code === 0) {
          if (!silent) {
            this.$message.success('Settings saved successfully');
          }
        } else {
          this.$message.error(data.msg || 'Failed to save settings');
        }
      });
    },

    showAddRecipientInput() {
      this.showAddRecipient = true;
      this.$nextTick(() => {
        if (this.$refs.recipientInput) {
          this.$refs.recipientInput.focus();
        }
      });
    },

    addRecipient() {
      if (!this.newRecipient.trim()) {
        this.showAddRecipient = false;
        return;
      }

      const email = this.newRecipient.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        this.$message.error('Please enter a valid email address');
        return;
      }

      if (this.config.recipients.includes(email)) {
        this.$message.warning('This email is already in the list');
        this.newRecipient = '';
        this.showAddRecipient = false;
        return;
      }

      this.config.recipients.push(email);
      this.newRecipient = '';
      this.showAddRecipient = false;
      this.handleConfigChange();
    },

    removeRecipient(index) {
      this.config.recipients.splice(index, 1);
      this.handleConfigChange();
    },

    fetchHistory() {
      this.historyLoading = true;
      Api.emailReport.getHistory({ page: this.historyPage, limit: this.historyLimit }, ({ data }) => {
        this.historyLoading = false;
        if (data.code === 0 && data.data) {
          this.historyList = data.data.list || [];
          this.historyTotal = data.data.total || 0;
        }
      });
    },

    showTestEmailDialog() {
      this.testEmailRecipient = this.config.recipients[0] || '';
      this.testEmailDialogVisible = true;
    },

    sendTestEmail() {
      if (!this.testEmailRecipient.trim()) {
        this.$message.error('Please enter an email address');
        return;
      }

      this.sendingTest = true;
      Api.emailReport.sendTestEmail(this.testEmailRecipient, ({ data }) => {
        this.sendingTest = false;
        if (data.code === 0) {
          this.$message.success('Test email sent successfully');
          this.testEmailDialogVisible = false;
          this.fetchHistory();
        } else {
          this.$message.error(data.msg || 'Failed to send test email');
        }
      });
    },

    generateNow() {
      this.$confirm('This will generate and send the daily report now. Continue?', 'Generate Report', {
        confirmButtonText: 'Generate',
        cancelButtonText: 'Cancel',
        type: 'info'
      }).then(() => {
        this.generating = true;
        Api.emailReport.generateReport(({ data }) => {
          this.generating = false;
          if (data.code === 0) {
            this.$message.success('Report generated and sent successfully');
            this.fetchHistory();
          } else {
            this.$message.error(data.msg || 'Failed to generate report');
          }
        });
      }).catch(() => {});
    },

    previewReport() {
      this.previewHtml = '';
      this.previewDialogVisible = true;
      Api.emailReport.previewReport(({ data }) => {
        if (data.code === 0 && data.data) {
          this.previewHtml = data.data.html;
        } else {
          this.previewHtml = '<p style="color: red;">Failed to load preview</p>';
        }
      });
    },

    viewHistoryReport(row) {
      this.selectedHistoryReport = {
        reportDate: row.reportDate,
        reportData: row.reportData || null
      };
      this.historyReportDialogVisible = true;
    },

    formatHour(hour) {
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:00 ${ampm}`;
    },

    formatDate(dateStr) {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    },

    formatDateTime(dateStr) {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },

    getStatusType(status) {
      switch (status) {
        case 'sent': return 'success';
        case 'failed': return 'danger';
        case 'partial': return 'warning';
        default: return 'info';
      }
    }
  }
};
</script>

<style lang="scss" scoped>
.welcome {
  min-width: 900px;
  background: linear-gradient(135deg, #667eea11 0%, #764ba211 100%);
  min-height: 100vh;
}

.role-config-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.header-bar {
  margin-bottom: 20px;

  .page-title {
    color: #3d4566;
    font-size: 24px;
    margin: 0 0 8px 0;
  }

  .page-description {
    color: #909399;
    font-size: 14px;
    margin: 0;
  }
}

.settings-card,
.history-card {
  margin-bottom: 20px;
  border-radius: 12px;
  border: none;

  :deep(.el-card__body) {
    padding: 24px;
  }
}

.settings-section {
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid #eee;

    h3 {
      margin: 0;
      color: #3d4566;
      font-size: 16px;
    }
  }
}

.config-form {
  max-width: 600px;

  .form-hint {
    color: #909399;
    font-size: 12px;
    margin-left: 12px;
  }
}

.recipients-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;

  .recipient-tag {
    font-size: 13px;
  }

  .new-recipient-input {
    width: 220px;
  }

  .add-recipient-btn {
    font-size: 13px;
  }
}

.sections-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-buttons {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
  display: flex;
  gap: 12px;
}

.history-card {
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;

    h3 {
      margin: 0;
      color: #3d4566;
      font-size: 16px;
    }
  }
}

.transparent-table {
  background: transparent !important;

  :deep(.el-table__header-wrapper th) {
    background: #f8f9fa !important;
    color: #606266;
    font-weight: 600;
  }

  :deep(.el-table__body-wrapper td) {
    background: transparent !important;
  }

  :deep(.el-table__row:hover td) {
    background: #f5f7fa !important;
  }
}

.error-text {
  color: #f56c6c;
  font-size: 13px;
}

.success-text {
  color: #909399;
}

.pagination-container {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.preview-container {
  max-height: 70vh;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 8px;

  :deep(body) {
    margin: 0;
    padding: 0;
  }
}

.preview-loading {
  text-align: center;
  padding: 40px;
  color: #909399;

  i {
    font-size: 24px;
    margin-bottom: 12px;
    display: block;
  }
}

.report-data-container {
  max-height: 60vh;
  overflow-y: auto;
}

.report-section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;

  &:last-child {
    border-bottom: none;
  }

  h4 {
    margin: 0 0 12px 0;
    color: #3d4566;
    font-size: 14px;
    font-weight: 600;
  }

  p {
    margin: 0;
    color: #606266;
    font-size: 13px;
  }
}

.report-stats {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.report-stat {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 100px;
  text-align: center;

  .stat-value {
    display: block;
    font-size: 20px;
    font-weight: 700;
    color: #FF6B35;
  }

  .stat-label {
    display: block;
    font-size: 11px;
    color: #909399;
    text-transform: uppercase;
    margin-top: 4px;
  }
}

.alert-item {
  margin-bottom: 8px;
}

.no-data {
  text-align: center;
  padding: 40px;
  color: #909399;

  i {
    font-size: 48px;
    margin-bottom: 12px;
    display: block;
  }

  p {
    margin: 0;
    font-size: 14px;
  }
}
</style>
