<template>
  <el-dialog :visible="visible" @close="handleClose" width="400px" center @open="handleOpen">
    <div
      style="margin: 0 10px 10px;display: flex;align-items: center;gap: 10px;font-weight: 700;font-size: 20px;text-align: left;color: #3d4566;">
      <div
        style="width: 40px;height: 40px;border-radius: 50%;background: var(--primary);display: flex;align-items: center;justify-content: center;">
        <img loading="lazy" src="@/assets/home/equipment.png" alt="" style="width: 18px;height: 15px;" />
      </div>
      Add Agent
    </div>
    <div style="height: 1px;background: #e8f0ff;" />
    <div style="margin: 22px 15px;">
      <div style="font-weight: 400;text-align: left;color: #3d4566;">
        <div style="color: red;display: inline-block;">*</div> Select Template:
      </div>
      <div class="select-container" style="margin-top: 12px;">
        <el-select
          v-model="selectedTemplateId"
          placeholder="Select an agent template"
          style="width: 100%;"
          :loading="loadingTemplates"
          filterable
        >
          <el-option
            v-for="template in templates"
            :key="template.id"
            :label="template.agentName"
            :value="template.id"
          >
            <span style="float: left">{{ template.agentName }}</span>
            <span style="float: right; color: #8492a6; font-size: 12px">{{ template.language || 'English' }}</span>
          </el-option>
        </el-select>
      </div>
      <div v-if="selectedTemplate" class="template-preview">
        <div class="preview-label">Preview:</div>
        <div class="preview-content">
          <div class="preview-item">
            <span class="label">Language:</span>
            <span class="value">{{ selectedTemplate.language || 'English' }}</span>
          </div>
          <div class="preview-item" v-if="selectedTemplate.systemPrompt">
            <span class="label">System Prompt:</span>
            <span class="value truncate">{{ truncateText(selectedTemplate.systemPrompt, 100) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div style="display: flex;margin: 15px 15px;gap: 7px;">
      <div class="dialog-btn" :class="{ disabled: !selectedTemplateId || submitting }" @click="confirm">
        {{ submitting ? 'Creating...' : 'Confirm' }}
      </div>
      <div class="dialog-btn cancel-btn" @click="cancel">
        Cancel
      </div>
    </div>
  </el-dialog>
</template>

<script>
import Api from '@/apis/api';

export default {
  name: 'AddWisdomBodyDialog',
  props: {
    visible: { type: Boolean, required: true }
  },
  data() {
    return {
      templates: [],
      selectedTemplateId: null,
      loadingTemplates: false,
      submitting: false
    }
  },
  computed: {
    selectedTemplate() {
      if (!this.selectedTemplateId) return null;
      return this.templates.find(t => t.id === this.selectedTemplateId);
    }
  },
  methods: {
    handleOpen() {
      this.fetchTemplates();
    },
    fetchTemplates() {
      this.loadingTemplates = true;
      Api.agent.getAgentTemplate((res) => {
        this.loadingTemplates = false;
        if (res.data && res.data.code === 0) {
          this.templates = res.data.data || [];
          // Auto-select first template if only one available
          if (this.templates.length === 1) {
            this.selectedTemplateId = this.templates[0].id;
          }
        } else {
          this.$message.error('Failed to load templates');
        }
      });
    },
    truncateText(text, maxLength) {
      if (!text) return '';
      return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    },
    confirm() {
      if (!this.selectedTemplateId) {
        this.$message.error('Please select a template');
        return;
      }
      if (this.submitting) return;

      const template = this.selectedTemplate;
      if (!template) {
        this.$message.error('Template not found');
        return;
      }

      this.submitting = true;

      // Create agent using template data
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

      Api.agent.createAgent(agentData, (res) => {
        this.submitting = false;
        if (res.data && res.data.code === 0) {
          this.$message.success({
            message: 'Agent created successfully',
            showClose: true
          });
          this.$emit('confirm', res);
          this.$emit('update:visible', false);
          this.selectedTemplateId = null;
        } else {
          this.$message.error(res.data?.msg || 'Failed to create agent');
        }
      });
    },
    cancel() {
      this.$emit('update:visible', false);
      this.selectedTemplateId = null;
    },
    handleClose() {
      this.$emit('update:visible', false);
    }
  }
}
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.select-container {
  ::v-deep .el-select {
    width: 100%;
  }

  ::v-deep .el-input__inner {
    border: 1px solid #e4e6ef;
    background: #f6f8fb;
    border-radius: 15px;
    height: 46px;
  }
}

.template-preview {
  margin-top: 16px;
  padding: 12px;
  background: #f6f8fb;
  border-radius: 10px;
  border: 1px solid #e4e6ef;

  .preview-label {
    font-size: 12px;
    font-weight: 600;
    color: #3d4566;
    margin-bottom: 8px;
  }

  .preview-content {
    .preview-item {
      display: flex;
      margin-bottom: 6px;
      font-size: 12px;

      &:last-child {
        margin-bottom: 0;
      }

      .label {
        color: #909399;
        min-width: 100px;
        flex-shrink: 0;
      }

      .value {
        color: #606266;
        word-break: break-word;

        &.truncate {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      }
    }
  }
}

.dialog-btn {
  cursor: pointer;
  flex: 1;
  border-radius: 23px;
  background: $primary;
  height: 40px;
  font-weight: 500;
  font-size: 12px;
  color: #fff;
  line-height: 40px;
  text-align: center;
  transition: opacity 0.2s;

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.dialog-btn.cancel-btn {
  background: rgba($primary, 0.15);
  border: 1px solid rgba($primary, 0.4);
  color: $primary;
}

::v-deep .el-dialog {
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

::v-deep .el-dialog__headerbtn {
  display: none;
}

::v-deep .el-dialog__body {
  padding: 4px 6px;
}

::v-deep .el-dialog__header {
  padding: 10px;
}
</style>
