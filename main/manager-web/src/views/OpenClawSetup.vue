<template>
  <div class="openclaw-setup">
    <el-container style="height: 100%;">
      <el-header>
        <div style="display: flex;align-items: center;margin-top: 15px;margin-left: 10px;gap: 10px;">
          <img loading="lazy" alt="" src="@/assets/cheeko-logo.svg" style="width: 45px;height: 45px;" />
        </div>
      </el-header>

      <el-main>
        <div class="setup-card">
          <!-- Steps indicator -->
          <el-steps :active="currentStep" finish-status="success" simple style="margin-bottom: 30px;">
            <el-step title="Account"></el-step>
            <el-step title="Connect AI"></el-step>
            <el-step title="Add Device"></el-step>
          </el-steps>

          <!-- Step 2: Connect OpenClaw -->
          <div v-if="currentStep === 1 && !paired">
            <h2 class="step-title">Connect Your AI Engine</h2>
            <p class="step-desc">Cheeko uses OpenClaw to power conversations. Run this on your Mac or Linux machine:</p>

            <div class="command-block">
              <code>
                <div>npm install -g openclaw</div>
                <div>openclaw plugins install @openclaw/esp32-voice</div>
                <div>CHEEKO_PAIR={{ pairToken }} openclaw gateway</div>
              </code>
              <el-button size="small" type="text" class="copy-btn" @click="copyCommand">
                {{ copied ? 'Copied!' : 'Copy' }}
              </el-button>
            </div>

            <div class="polling-status" v-if="pairToken && !paired">
              <i class="el-icon-loading"></i>
              <span>Waiting for your OpenClaw to connect...</span>
              <div class="polling-hint">(this page updates automatically)</div>
            </div>

            <el-divider>Or enter your URL manually</el-divider>

            <div class="manual-entry">
              <el-input v-model="manualUrl" placeholder="ws://192.168.1.10:8765/" style="flex: 1;">
                <template slot="prepend">URL</template>
              </el-input>
              <el-button type="primary" @click="testAndSaveManualUrl" :loading="testing" style="margin-left: 10px;">
                {{ testing ? 'Testing...' : 'Connect' }}
              </el-button>
            </div>

            <div v-if="testResult" class="test-result" :class="testResult.ok ? 'success' : 'error'">
              <i :class="testResult.ok ? 'el-icon-circle-check' : 'el-icon-circle-close'"></i>
              <span v-if="testResult.ok">Connected! Latency: {{ testResult.latencyMs }}ms</span>
              <span v-else>{{ testResult.error || 'Connection failed' }}</span>
            </div>
          </div>

          <!-- Step 2: Connected! -->
          <div v-if="currentStep === 1 && paired" class="connected-state">
            <div class="connected-icon">
              <i class="el-icon-circle-check"></i>
            </div>
            <h2 class="step-title">OpenClaw Connected!</h2>
            <p class="connected-url">{{ connectedUrl }}</p>
            <el-button type="primary" size="large" @click="goToStep3">Continue</el-button>
          </div>

          <!-- Step 3: Add Device (existing flow - just shows instructions) -->
          <div v-if="currentStep === 2">
            <h2 class="step-title">Add Your Cheeko Device</h2>
            <div class="device-instructions">
              <div class="instruction-step">
                <div class="step-number">1</div>
                <div>Power on your Cheeko device</div>
              </div>
              <div class="instruction-step">
                <div class="step-number">2</div>
                <div>Wait for it to connect to WiFi</div>
              </div>
              <div class="instruction-step">
                <div class="step-number">3</div>
                <div>It will speak a 6-digit code</div>
              </div>
            </div>

            <p class="step-desc" style="margin-top: 20px;">Enter the code your device spoke:</p>

            <div class="otp-input-row">
              <el-input
                v-for="(digit, i) in otpDigits"
                :key="i"
                :ref="'otp' + i"
                v-model="otpDigits[i]"
                maxlength="1"
                class="otp-input"
                @input="onOtpInput(i)"
                @keydown.native.backspace="onOtpBackspace(i, $event)"
              />
            </div>

            <el-button type="primary" size="large" @click="bindDevice" :loading="binding" :disabled="otpCode.length !== 6"
              style="margin-top: 20px; width: 100%;">
              Add Device
            </el-button>

            <div class="skip-link" @click="goToDashboard">
              Skip for now - go to dashboard
            </div>
          </div>

          <!-- Step 4: Done -->
          <div v-if="currentStep === 3" class="done-state">
            <div class="connected-icon">
              <i class="el-icon-circle-check"></i>
            </div>
            <h2 class="step-title">Your Cheeko is ready!</h2>
            <div class="done-details" v-if="boundDevice">
              <div class="detail-row">
                <span class="detail-label">Device</span>
                <span>{{ boundDevice.alias || boundDevice.macAddress }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">AI Engine</span>
                <span>{{ connectedUrl }}</span>
                <span class="status-dot online"></span>
              </div>
            </div>
            <p class="step-desc">Say "Hey Cheeko" to start talking!</p>
            <el-button type="primary" size="large" @click="goToDashboard" style="margin-top: 20px;">
              Go to Dashboard
            </el-button>
          </div>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script>
import Api from '@/apis/api';
import { goToPage, showDanger, showSuccess } from '@/utils';

export default {
  name: 'OpenClawSetup',
  data() {
    return {
      currentStep: 1,
      pairToken: '',
      paired: false,
      connectedUrl: '',
      manualUrl: '',
      testing: false,
      testResult: null,
      copied: false,
      pollTimer: null,
      otpDigits: ['', '', '', '', '', ''],
      binding: false,
      boundDevice: null,
      defaultAgentId: null
    };
  },
  computed: {
    otpCode() {
      return this.otpDigits.join('');
    },
    fullCommand() {
      return `npm install -g openclaw\nopenclaw plugins install @openclaw/esp32-voice\nCHEEKO_PAIR=${this.pairToken} openclaw gateway`;
    }
  },
  mounted() {
    // Check if user already has OpenClaw configured
    Api.openclaw.getConfig((res) => {
      const config = res.data && res.data.data;
      if (config && config.openclaw_url) {
        this.connectedUrl = config.openclaw_url;
        this.paired = true;
      } else {
        this.generateToken();
      }
    });

    // Load user's agents for binding — auto-create from template if none exist
    this.loadOrCreateAgent();
  },
  beforeDestroy() {
    this.stopPolling();
  },
  methods: {
    loadOrCreateAgent() {
      Api.agent.getUserAgentList({ page: 1, limit: 10 }, (res) => {
        const list = res.data && res.data.data && res.data.data.list
          ? res.data.data.list
          : (res.data && res.data.list ? res.data.list : []);
        if (list.length > 0) {
          this.defaultAgentId = list[0].id;
        } else {
          // No agents — auto-create one from the first available template
          this.autoCreateDefaultAgent();
        }
      });
    },

    autoCreateDefaultAgent() {
      Api.agent.getAgentTemplate((res) => {
        if (res.data && res.data.code === 0) {
          const templates = res.data.data || [];
          if (templates.length === 0) {
            console.warn('No agent templates available for auto-creation');
            return;
          }
          const template = templates[0];
          const agentData = {
            agentCode: template.agentCode,
            agentName: template.agentName,
            asrModelId: template.asrModelId,
            vadModelId: template.vadModelId,
            llmModelId: template.llmModelId,
            vllmModelId: template.vllmModelId,
            ttsModelId: template.ttsModelId,
            ttsVoiceId: template.ttsVoiceId,
            memModelId: template.memModelId,
            intentModelId: template.intentModelId,
            chatHistoryConf: template.chatHistoryConf || 0,
            systemPrompt: template.systemPrompt,
            summaryMemory: template.summaryMemory,
            langCode: template.langCode || 'en',
            language: template.language || 'English',
            sort: template.sort || 0
          };
          Api.agent.createAgent(agentData, (createRes) => {
            if (createRes.data && createRes.data.code === 0) {
              this.defaultAgentId = createRes.data.data;
              console.log('Auto-created default agent:', this.defaultAgentId);
            } else {
              console.warn('Failed to auto-create agent:', createRes.data && createRes.data.msg);
            }
          });
        }
      });
    },

    generateToken() {
      Api.openclaw.generatePairToken((res) => {
        const data = res.data && res.data.data ? res.data.data : res.data;
        if (data && data.token) {
          this.pairToken = data.token;
          this.startPolling();
        }
      }, () => {
        showDanger('Failed to generate pairing token');
      });
    },

    startPolling() {
      this.stopPolling();
      this.pollTimer = setInterval(() => {
        if (!this.pairToken || this.paired) return;
        Api.openclaw.getPairStatus(this.pairToken, (res) => {
          const data = res.data && res.data.data ? res.data.data : res.data;
          if (data && data.paired) {
            this.paired = true;
            this.connectedUrl = data.url;
            this.stopPolling();
          } else if (data && data.expired) {
            this.stopPolling();
            this.generateToken();
          }
        });
      }, 3000);
    },

    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },

    copyCommand() {
      const dashboardUrl = window.location.origin;
      const cmd = `npm install -g openclaw\nopenclaw plugins install @openclaw/esp32-voice\nCHEEKO_PAIR=${this.pairToken} CHEEKO_DASHBOARD_URL=${dashboardUrl} openclaw gateway`;
      navigator.clipboard.writeText(cmd).then(() => {
        this.copied = true;
        setTimeout(() => { this.copied = false; }, 2000);
      });
    },

    testAndSaveManualUrl() {
      if (!this.manualUrl) {
        showDanger('Please enter a WebSocket URL');
        return;
      }
      if (!this.manualUrl.startsWith('ws://') && !this.manualUrl.startsWith('wss://')) {
        showDanger('URL must start with ws:// or wss://');
        return;
      }

      this.testing = true;
      this.testResult = null;

      // Save the URL
      Api.openclaw.setConfig({
        openclaw_url: this.manualUrl
      }, (res) => {
        this.testing = false;
        this.paired = true;
        this.connectedUrl = this.manualUrl;
        showSuccess('OpenClaw configuration saved!');
      }, () => {
        this.testing = false;
        showDanger('Failed to save configuration');
      });
    },

    goToStep3() {
      this.currentStep = 2;
    },

    onOtpInput(index) {
      if (this.otpDigits[index] && index < 5) {
        this.$refs['otp' + (index + 1)][0].focus();
      }
    },

    onOtpBackspace(index, event) {
      if (!this.otpDigits[index] && index > 0) {
        this.$refs['otp' + (index - 1)][0].focus();
      }
    },

    bindDevice() {
      if (this.otpCode.length !== 6) {
        showDanger('Please enter the 6-digit code');
        return;
      }
      if (!this.defaultAgentId) {
        showDanger('No agent found. Please create an agent first from the dashboard.');
        return;
      }

      this.binding = true;
      Api.device.bindDevice(this.defaultAgentId, this.otpCode, (res) => {
        this.binding = false;
        if (res.data && res.data.code === 0) {
          this.boundDevice = res.data.data;
          this.currentStep = 3;
          showSuccess('Device added successfully!');
        } else {
          showDanger((res.data && res.data.msg) || 'Failed to bind device');
        }
      });
    },

    goToDashboard() {
      goToPage('/home');
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.openclaw-setup {
  min-height: 100vh;
  background: linear-gradient(145deg, #fff7f0, #ffb347, #ff9100, #fff7f0);
}

.setup-card {
  max-width: 600px;
  margin: 40px auto;
  background: #fff;
  border-radius: 20px;
  padding: 40px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.step-title {
  font-size: 24px;
  font-weight: 700;
  color: #3d4566;
  margin-bottom: 10px;
}

.step-desc {
  color: #818cae;
  font-size: 14px;
  margin-bottom: 20px;
}

.command-block {
  position: relative;
  background: #1e1e2e;
  border-radius: 10px;
  padding: 20px;
  margin: 20px 0;

  code {
    color: #a6e3a1;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    line-height: 1.8;
    white-space: pre-wrap;
    word-break: break-all;

    div {
      &:last-child {
        color: #89b4fa;
      }
    }
  }

  .copy-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    color: #cdd6f4;

    &:hover {
      color: #fff;
    }
  }
}

.polling-status {
  text-align: center;
  padding: 20px;
  color: #818cae;

  i {
    font-size: 20px;
    margin-right: 8px;
    color: $primary;
  }

  .polling-hint {
    font-size: 12px;
    margin-top: 5px;
    color: #b4b9cc;
  }
}

.manual-entry {
  display: flex;
  align-items: center;
}

.test-result {
  margin-top: 10px;
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

.connected-state {
  text-align: center;
  padding: 20px 0;
}

.connected-icon {
  margin-bottom: 15px;

  i {
    font-size: 64px;
    color: #22c55e;
  }
}

.connected-url {
  color: #818cae;
  font-family: monospace;
  font-size: 14px;
  margin-bottom: 20px;
}

.device-instructions {
  margin: 20px 0;
}

.instruction-step {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 12px 0;
  color: #3d4566;
  font-size: 15px;
}

.step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: $primary;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}

.otp-input-row {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.otp-input {
  width: 50px;

  ::v-deep .el-input__inner {
    text-align: center;
    font-size: 24px;
    font-weight: 700;
    height: 55px;
    border-radius: 10px;
    border: 2px solid #e4e6ef;

    &:focus {
      border-color: $primary;
    }
  }
}

.done-state {
  text-align: center;
  padding: 20px 0;
}

.done-details {
  background: #f8fafc;
  border-radius: 10px;
  padding: 20px;
  margin: 20px 0;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 14px;
  color: #3d4566;
}

.detail-label {
  font-weight: 600;
  min-width: 80px;
  color: #818cae;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;

  &.online {
    background: #22c55e;
    box-shadow: 0 0 4px #22c55e;
  }
}

.skip-link {
  text-align: center;
  margin-top: 15px;
  color: #818cae;
  font-size: 14px;
  cursor: pointer;

  &:hover {
    color: $primary;
  }
}
</style>
