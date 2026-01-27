<template>
  <div class="welcome">
    <HeaderBar />

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <el-card class="config-card" shadow="never">
            <div class="config-header">
              <div class="header-left">
                <div class="header-icon">
                  <img loading="lazy" src="@/assets/home/setting-user.png" alt="" />
                </div>
                <span class="header-title">{{ form.agentName || 'Role Configuration' }}</span>
              </div>
              <div class="header-actions">
                <el-button type="primary" class="save-btn" @click="saveConfig">
                  <i class="el-icon-check"></i> Save
                </el-button>
                <el-button class="reset-btn" @click="resetConfig">
                  <i class="el-icon-refresh"></i> Reset
                </el-button>
                <button class="custom-close-btn" @click="goToHome">×</button>
              </div>
            </div>

            <div class="divider"></div>

            <el-form ref="form" :model="form" label-position="top" class="config-form">
              <!-- Assistant Name -->
              <el-form-item label="Assistant Name" class="form-item-card">
                <el-input
                  v-model="form.agentName"
                  placeholder="Enter assistant name"
                  maxlength="30"
                  show-word-limit
                  class="form-input"
                />
              </el-form-item>

              <!-- Role Template -->
              <el-form-item label="Apply Template" class="form-item-card">
                <div class="template-container">
                  <div
                    v-for="(template, index) in templates"
                    :key="`template-${index}`"
                    class="template-item"
                    :class="{
                      'template-loading': loadingTemplate,
                      'template-active': selectedTemplate && selectedTemplate.id === template.id
                    }"
                    @click="selectTemplate(template)"
                  >
                    <i class="el-icon-document"></i>
                    {{ template.agentName }}
                  </div>
                  <div v-if="templates.length === 0" class="no-templates">
                    No templates available
                  </div>
                </div>
              </el-form-item>

              <!-- System Prompt / Role Description -->
              <el-form-item label="Role Description" class="form-item-card">
                <el-input
                  type="textarea"
                  :rows="5"
                  resize="vertical"
                  placeholder="Describe the assistant's personality, behavior, and how it should respond..."
                  v-model="form.systemPrompt"
                  maxlength="10000"
                  show-word-limit
                  class="form-textarea"
                />
              </el-form-item>

              <!-- Memory / Summary -->
              <el-form-item label="Memory Notes" class="form-item-card">
                <el-input
                  type="textarea"
                  :rows="3"
                  resize="vertical"
                  placeholder="Add any persistent memory or context the assistant should remember..."
                  v-model="form.summaryMemory"
                  maxlength="2000"
                  show-word-limit
                  class="form-textarea"
                />
              </el-form-item>

              <!-- Info hint -->
              <div class="info-hint">
                <i class="el-icon-info"></i>
                <span>After saving, restart the device for changes to take effect.</span>
              </div>
            </el-form>
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Api from "@/apis/api";
import HeaderBar from "@/components/HeaderBar.vue";

export default {
  name: "RoleConfigPage",
  components: { HeaderBar },
  data() {
    return {
      form: {
        agentCode: "",
        agentName: "",
        ttsVoiceId: "",
        chatHistoryConf: 1,
        systemPrompt: "",
        summaryMemory: "",
        langCode: "",
        language: "",
        sort: "",
        model: {
          ttsModelId: "",
          vadModelId: "",
          asrModelId: "",
          llmModelId: "",
          vllmModelId: "",
          memModelId: "Memory_mem_local_short",
          intentModelId: "",
        },
      },
      templates: [],
      loadingTemplate: false,
      selectedTemplate: null,
    };
  },
  methods: {
    goToHome() {
      this.$router.push("/home");
    },
    saveConfig() {
      if (!this.form.agentName?.trim()) {
        this.$message.warning("Please enter an assistant name");
        return;
      }

      const configData = {
        agentCode: this.form.agentCode,
        agentName: this.form.agentName,
        asrModelId: this.form.model.asrModelId,
        vadModelId: this.form.model.vadModelId,
        llmModelId: this.form.model.llmModelId,
        vllmModelId: this.form.model.vllmModelId,
        ttsModelId: this.form.model.ttsModelId,
        ttsVoiceId: this.form.ttsVoiceId,
        chatHistoryConf: this.form.chatHistoryConf,
        memModelId: this.form.model.memModelId,
        intentModelId: this.form.model.intentModelId,
        systemPrompt: this.form.systemPrompt,
        summaryMemory: this.form.summaryMemory,
        langCode: this.form.langCode,
        language: this.form.language,
        sort: this.form.sort,
      };

      Api.agent.updateAgentConfig(
        this.$route.query.agentId,
        configData,
        ({ data }) => {
          if (data.code === 0) {
            this.$message.success("Configuration saved successfully");
          } else {
            this.$message.error(data.msg || "Failed to save configuration");
          }
        }
      );
    },
    resetConfig() {
      this.$confirm(
        "Are you sure you want to reset? Unsaved changes will be lost.",
        "Reset Configuration",
        {
          confirmButtonText: "Reset",
          cancelButtonText: "Cancel",
          type: "warning",
        }
      )
        .then(() => {
          // Reload from server
          this.fetchAgentConfig(this.$route.query.agentId);
          this.selectedTemplate = null;
          this.$message.success("Configuration reset");
        })
        .catch(() => {});
    },
    fetchTemplates() {
      Api.agent.getAgentTemplate(({ data }) => {
        if (data.code === 0) {
          this.templates = data.data || [];
        }
      });
    },
    selectTemplate(template) {
      if (this.loadingTemplate) return;
      this.loadingTemplate = true;

      try {
        this.selectedTemplate = template;
        // Apply template data but keep the agent name
        this.form.systemPrompt = template.systemPrompt || this.form.systemPrompt;
        this.form.summaryMemory = template.summaryMemory || this.form.summaryMemory;
        this.form.ttsVoiceId = template.ttsVoiceId || this.form.ttsVoiceId;
        this.form.chatHistoryConf = template.chatHistoryConf !== undefined ? template.chatHistoryConf : 1;
        this.form.langCode = template.langCode || this.form.langCode;
        this.form.model = {
          ttsModelId: template.ttsModelId || this.form.model.ttsModelId,
          vadModelId: template.vadModelId || this.form.model.vadModelId,
          asrModelId: template.asrModelId || this.form.model.asrModelId,
          llmModelId: template.llmModelId || this.form.model.llmModelId,
          vllmModelId: template.vllmModelId || this.form.model.vllmModelId,
          memModelId: template.memModelId || this.form.model.memModelId,
          intentModelId: template.intentModelId || this.form.model.intentModelId,
        };

        this.$message.success(`Template "${template.agentName}" applied`);
      } catch (error) {
        this.$message.error("Failed to apply template");
        console.error("Failed to apply template:", error);
      } finally {
        this.loadingTemplate = false;
      }
    },
    fetchAgentConfig(agentId) {
      Api.agent.getDeviceConfig(agentId, ({ data }) => {
        if (data.code === 0) {
          this.form = {
            ...this.form,
            ...data.data,
            model: {
              ttsModelId: data.data.ttsModelId,
              vadModelId: data.data.vadModelId,
              asrModelId: data.data.asrModelId,
              llmModelId: data.data.llmModelId,
              vllmModelId: data.data.vllmModelId,
              memModelId: data.data.memModelId,
              intentModelId: data.data.intentModelId,
            },
          };
        } else {
          this.$message.error(data.msg || "Failed to load configuration");
        }
      });
    },
  },
  mounted() {
    const agentId = this.$route.query.agentId;
    if (agentId) {
      this.fetchAgentConfig(agentId);
    }
    this.fetchTemplates();
  },
};
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.welcome {
  min-width: 600px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #fff5eb 0%, #fff7f0 50%, #ffe8d6 100%);
  overflow: hidden;
}

.main-wrapper {
  flex: 1;
  margin: 12px;
  margin-top: 8px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  overflow: hidden;
}

.content-panel {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.content-area {
  flex: 1;
  overflow: auto;
  padding: 16px;
  max-width: 700px;
  margin: 0 auto;
}

.config-card {
  background: transparent;
  border: none;
  box-shadow: none;
}

::v-deep .config-card .el-card__body {
  padding: 0;
}

.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, $primary, darken($primary, 10%));
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba($primary, 0.3);
}

.header-icon img {
  width: 18px;
  height: 18px;
  filter: brightness(0) invert(1);
}

.header-title {
  font-size: 18px;
  font-weight: 600;
  color: #2c3e50;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.save-btn {
  background: linear-gradient(135deg, $primary, darken($primary, 8%));
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba($primary, 0.3);
  transition: all 0.3s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba($primary, 0.4);
  }
}

.reset-btn {
  background: white;
  color: #666;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.3s;

  &:hover {
    background: #f5f5f5;
    border-color: #ccc;
  }
}

.custom-close-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  background: white;
  font-size: 18px;
  color: #999;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;

  &:hover {
    background: #fff5f5;
    border-color: #ffccc7;
    color: #ff4d4f;
  }
}

.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, #e8e8e8, transparent);
  margin-bottom: 12px;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-item-card {
  background: white;
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid #f0f0f0;
  margin-bottom: 0;
  transition: all 0.3s;

  &:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    border-color: rgba($primary, 0.2);
  }
}

::v-deep .form-item-card .el-form-item__label {
  font-size: 13px;
  font-weight: 600;
  color: #2c3e50;
  padding-bottom: 6px;
}

.form-input {
  ::v-deep .el-input__inner {
    border-radius: 8px;
    border: 1px solid #e8e8e8;
    padding: 8px 12px;
    height: 38px;
    font-size: 14px;
    transition: all 0.3s;

    &:focus {
      border-color: $primary;
      box-shadow: 0 0 0 3px rgba($primary, 0.1);
    }
  }
}

.form-textarea {
  ::v-deep .el-textarea__inner {
    border-radius: 8px;
    border: 1px solid #e8e8e8;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.5;
    transition: all 0.3s;

    &:focus {
      border-color: $primary;
      box-shadow: 0 0 0 3px rgba($primary, 0.1);
    }
  }

  ::v-deep .el-input__count {
    background: transparent;
    font-size: 11px;
    color: #999;
  }
}

.template-container {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.template-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  background: #f8f9fa;
  border: 1px solid #e8e8e8;
  font-size: 13px;
  color: #555;
  cursor: pointer;
  transition: all 0.3s;

  i {
    font-size: 13px;
    color: #999;
  }

  &:hover {
    background: rgba($primary, 0.08);
    border-color: rgba($primary, 0.3);
    color: $primary;

    i {
      color: $primary;
    }
  }

  &.template-active {
    background: rgba($primary, 0.15);
    border-color: $primary;
    color: $primary;

    i {
      color: $primary;
    }
  }

  &.template-loading {
    opacity: 0.6;
    pointer-events: none;
  }
}

.no-templates {
  color: #999;
  font-size: 14px;
  padding: 8px 0;
}

.info-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 8px;
  color: #ad8b00;
  font-size: 12px;

  i {
    font-size: 14px;
    color: #faad14;
  }
}
</style>
