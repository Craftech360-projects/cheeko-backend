<template>
  <div class="welcome">
    <HeaderBar />
    <el-main style="padding: 20px;">
      <div class="settings-container">
        <h2 class="page-title">OpenClaw Settings</h2>

        <!-- Current Status Section -->
        <el-card class="settings-card" shadow="never">
          <div slot="header" class="card-header">
            <span>Current Status</span>
            <el-button v-if="currentUrl" size="mini" type="text" @click="checkConnection" :loading="checking">
              {{ checking ? 'Checking...' : 'Check Connection' }}
            </el-button>
          </div>

          <div v-if="loading" class="loading-state">
            <i class="el-icon-loading"></i> Loading configuration...
          </div>

          <div v-else-if="currentUrl" class="status-row">
            <div class="status-info">
              <div class="status-label">Voice URL</div>
              <div class="status-value">
                <code>{{ currentUrl }}</code>
                <span class="status-dot" :class="connectionStatus"></span>
                <span class="status-text" :class="connectionStatus">{{ statusLabel }}</span>
              </div>
            </div>
          </div>

          <div v-else class="not-configured">
            <i class="el-icon-warning-outline"></i>
            <span>OpenClaw is not configured. Your devices won't respond to voice commands.</span>
          </div>
        </el-card>

        <!-- Change URL Section -->
        <el-card class="settings-card" shadow="never">
          <div slot="header" class="card-header">
            <span>{{ currentUrl ? 'Change URL' : 'Connect Manually' }}</span>
          </div>
          <div class="url-entry">
            <el-input v-model="manualUrl" placeholder="ws://192.168.1.10:8765/" style="flex: 1;">
              <template slot="prepend">URL</template>
            </el-input>
            <el-button type="primary" @click="testAndSave" :loading="saving" style="margin-left: 10px;">
              {{ saving ? 'Saving...' : 'Test & Save' }}
            </el-button>
          </div>
          <div v-if="testResult" class="test-result" :class="testResult.ok ? 'success' : 'error'" style="margin-top: 10px;">
            <i :class="testResult.ok ? 'el-icon-circle-check' : 'el-icon-circle-close'"></i>
            <span v-if="testResult.ok">Connected! Latency: {{ testResult.latencyMs }}ms</span>
            <span v-else>{{ testResult.error || 'Connection failed' }}</span>
          </div>
        </el-card>

        <!-- Reconnect via Pairing Section -->
        <el-card class="settings-card" shadow="never">
          <div slot="header" class="card-header">
            <span>{{ currentUrl ? 'Reconnect (if your IP changed)' : 'Connect via Pairing' }}</span>
          </div>
          <p class="section-desc">Run this on your Mac or Linux machine:</p>
          <div class="command-block">
            <code>
              <div>openclaw channels configure esp32voice</div>
            </code>
            <el-button size="small" type="text" class="copy-btn" @click="copyCommand">
              {{ copied ? 'Copied!' : 'Copy' }}
            </el-button>
          </div>
          <div class="pair-row">
            <span class="pair-label">Pairing token:</span>
            <code class="pair-token">{{ pairToken || '------' }}</code>
            <el-button size="small" type="text" @click="copyToken" style="margin-left: 8px;">Copy</el-button>
            <el-button size="small" type="text" @click="regenerateToken" :loading="generatingToken">
              {{ generatingToken ? 'Generating...' : 'Refresh' }}
            </el-button>
          </div>
          <div class="polling-status" v-if="pairToken && polling">
            <i class="el-icon-loading"></i>
            <span>Waiting for reconnect...</span>
          </div>
        </el-card>

        <!-- Disconnect Section -->
        <el-card v-if="currentUrl" class="settings-card disconnect-card" shadow="never">
          <el-button type="danger" plain @click="handleDisconnect" :loading="disconnecting">
            Disconnect OpenClaw
          </el-button>
          <span class="disconnect-hint">This will clear the URL from your profile and all devices.</span>
        </el-card>
      </div>
    </el-main>
  </div>
</template>

<script>
import Api from '@/apis/api';
import HeaderBar from '@/components/HeaderBar.vue';
import { showDanger, showSuccess } from '@/utils';

export default {
  name: 'OpenClawSettings',
  components: { HeaderBar },
  data() {
    return {
      loading: true,
      currentUrl: '',
      currentToken: '',
      manualUrl: '',
      saving: false,
      testResult: null,
      checking: false,
      connectionStatus: 'unknown', // 'online', 'offline', 'unknown'
      pairToken: '',
      polling: false,
      pollTimer: null,
      generatingToken: false,
      copied: false,
      disconnecting: false
    };
  },
  computed: {
    statusLabel() {
      if (this.connectionStatus === 'online') return 'Online';
      if (this.connectionStatus === 'offline') return 'Offline';
      return 'Unknown';
    }
  },
  mounted() {
    this.loadConfig();
    this.generateToken();
  },
  beforeDestroy() {
    this.stopPolling();
  },
  methods: {
    loadConfig() {
      this.loading = true;
      Api.openclaw.getConfig((res) => {
        this.loading = false;
        const config = res.data && res.data.data;
        if (config && config.openclaw_url) {
          this.currentUrl = config.openclaw_url;
          this.currentToken = config.openclaw_token || '';
          this.checkConnection();
        }
      }, () => {
        this.loading = false;
      });
    },

    checkConnection() {
      if (!this.currentUrl) return;
      this.checking = true;
      this.connectionStatus = 'unknown';
      Api.openclaw.testConnection(this.currentUrl, (res) => {
        this.checking = false;
        const data = res.data && res.data.data ? res.data.data : res.data;
        if (data && data.ok) {
          this.connectionStatus = 'online';
        } else {
          this.connectionStatus = 'offline';
        }
      }, () => {
        this.checking = false;
        this.connectionStatus = 'offline';
      });
    },

    testAndSave() {
      if (!this.manualUrl) {
        showDanger('Please enter a WebSocket URL');
        return;
      }
      if (!this.manualUrl.startsWith('ws://') && !this.manualUrl.startsWith('wss://')) {
        showDanger('URL must start with ws:// or wss://');
        return;
      }

      this.saving = true;
      this.testResult = null;

      // Test first
      Api.openclaw.testConnection(this.manualUrl, (res) => {
        const data = res.data && res.data.data ? res.data.data : res.data;
        this.testResult = data;

        if (data && data.ok) {
          // Save the URL
          Api.openclaw.setConfig({ openclaw_url: this.manualUrl }, () => {
            this.saving = false;
            this.currentUrl = this.manualUrl;
            this.connectionStatus = 'online';
            this.manualUrl = '';
            showSuccess('OpenClaw URL saved and propagated to all devices!');
          }, () => {
            this.saving = false;
            showDanger('Connection succeeded but failed to save configuration');
          });
        } else {
          this.saving = false;
          // Still offer to save even if test failed
          this.$confirm(
            'Connection test failed. Save this URL anyway?',
            'Warning',
            { confirmButtonText: 'Save Anyway', cancelButtonText: 'Cancel', type: 'warning' }
          ).then(() => {
            this.saving = true;
            Api.openclaw.setConfig({ openclaw_url: this.manualUrl }, () => {
              this.saving = false;
              this.currentUrl = this.manualUrl;
              this.connectionStatus = 'offline';
              this.manualUrl = '';
              showSuccess('URL saved (connection test failed)');
            }, () => {
              this.saving = false;
              showDanger('Failed to save configuration');
            });
          }).catch(() => {});
        }
      }, () => {
        this.saving = false;
        this.testResult = { ok: false, error: 'Network error testing connection' };
      });
    },

    generateToken() {
      this.generatingToken = true;
      Api.openclaw.generatePairToken((res) => {
        this.generatingToken = false;
        const data = res.data && res.data.data ? res.data.data : res.data;
        if (data && data.token) {
          this.pairToken = data.token;
          this.startPolling();
        }
      }, () => {
        this.generatingToken = false;
      });
    },

    regenerateToken() {
      this.stopPolling();
      this.generateToken();
    },

    startPolling() {
      this.stopPolling();
      this.polling = true;
      this.pollTimer = setInterval(() => {
        if (!this.pairToken) return;
        Api.openclaw.getPairStatus(this.pairToken, (res) => {
          const data = res.data && res.data.data ? res.data.data : res.data;
          if (data && data.paired) {
            this.stopPolling();
            this.currentUrl = data.url;
            this.connectionStatus = 'online';
            showSuccess('OpenClaw reconnected: ' + data.url);
            this.generateToken(); // Generate fresh token for next time
          } else if (data && data.expired) {
            this.stopPolling();
            this.generateToken();
          }
        });
      }, 3000);
    },

    stopPolling() {
      this.polling = false;
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },

    handleDisconnect() {
      this.$confirm(
        'This will remove the OpenClaw URL from your profile and all your devices. Devices will stop responding to voice commands until reconnected.',
        'Disconnect OpenClaw',
        { confirmButtonText: 'Disconnect', cancelButtonText: 'Cancel', type: 'warning' }
      ).then(() => {
        this.disconnecting = true;
        Api.openclaw.setConfig({ openclaw_url: null, openclaw_token: null }, () => {
          this.disconnecting = false;
          this.currentUrl = '';
          this.currentToken = '';
          this.connectionStatus = 'unknown';
          this.testResult = null;
          showSuccess('OpenClaw disconnected from your profile and all devices');
        }, () => {
          this.disconnecting = false;
          showDanger('Failed to disconnect');
        });
      }).catch(() => {});
    },

    copyCommand() {
      const cmd = 'openclaw channels configure esp32voice';
      navigator.clipboard.writeText(cmd).then(() => {
        this.copied = true;
        setTimeout(() => { this.copied = false; }, 2000);
      });
    },

    copyToken() {
      if (!this.pairToken) return;
      navigator.clipboard.writeText(this.pairToken).then(() => {
        showSuccess('Token copied!');
      });
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.settings-container {
  max-width: 700px;
  margin: 0 auto;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: #3d4566;
  margin-bottom: 20px;
}

.settings-card {
  margin-bottom: 16px;
  border-radius: 12px;

  ::v-deep .el-card__header {
    padding: 14px 20px;
    border-bottom: 1px solid #f0f2f5;
  }

  ::v-deep .el-card__body {
    padding: 20px;
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: #3d4566;
}

.loading-state {
  color: #818cae;
  padding: 10px 0;

  i {
    margin-right: 8px;
  }
}

.status-row {
  display: flex;
  align-items: center;
}

.status-info {
  flex: 1;
}

.status-label {
  font-size: 12px;
  color: #818cae;
  margin-bottom: 4px;
}

.status-value {
  display: flex;
  align-items: center;
  gap: 10px;

  code {
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 14px;
    color: #3d4566;
    background: #f6f8fb;
    padding: 4px 10px;
    border-radius: 6px;
  }
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;

  &.online {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  }

  &.offline {
    background: #ef4444;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
  }

  &.unknown {
    background: #d1d5db;
  }
}

.status-text {
  font-size: 13px;
  font-weight: 500;

  &.online {
    color: #22c55e;
  }

  &.offline {
    color: #ef4444;
  }

  &.unknown {
    color: #9ca3af;
  }
}

.not-configured {
  color: #e6a23c;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;

  i {
    font-size: 18px;
  }
}

.url-entry {
  display: flex;
  align-items: center;
}

.test-result {
  padding: 10px 15px;
  border-radius: 8px;
  font-size: 14px;

  i {
    margin-right: 8px;
  }

  &.success {
    background: #f0fdf4;
    color: #166534;
  }

  &.error {
    background: #fef2f2;
    color: #991b1b;
  }
}

.section-desc {
  color: #818cae;
  font-size: 14px;
  margin: 0 0 12px;
}

.command-block {
  position: relative;
  background: #1e1e2e;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;

  code {
    color: #a6e3a1;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    line-height: 1.8;
  }

  .copy-btn {
    position: absolute;
    top: 8px;
    right: 10px;
    color: #cdd6f4;

    &:hover {
      color: #fff;
    }
  }
}

.pair-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pair-label {
  color: #818cae;
  font-size: 14px;
}

.pair-token {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 16px;
  font-weight: 700;
  color: $primary;
  background: #fff7f0;
  padding: 4px 12px;
  border-radius: 6px;
  letter-spacing: 2px;
}

.polling-status {
  margin-top: 12px;
  color: #818cae;
  font-size: 13px;

  i {
    margin-right: 6px;
    color: $primary;
  }
}

.disconnect-card {
  ::v-deep .el-card__body {
    display: flex;
    align-items: center;
    gap: 16px;
  }
}

.disconnect-hint {
  color: #818cae;
  font-size: 13px;
}
</style>
