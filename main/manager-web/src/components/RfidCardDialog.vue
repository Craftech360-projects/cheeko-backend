<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="520px"
    class="rfid-dialog-wrapper"
    :append-to-body="true"
    :close-on-click-modal="false"
    :key="dialogKey"
    custom-class="custom-rfid-dialog"
    :show-close="false"
  >
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 class="dialog-title">{{ title }}</h2>
        <button class="custom-close-btn" @click="cancel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <el-form :model="form" :rules="rules" ref="form" label-width="110px" label-position="left" class="rfid-form">
        <el-form-item label="RFID UID" prop="rfidUid" class="form-item">
          <el-input v-model="form.rfidUid" placeholder="Physical card UID (hex)" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Content Type" class="form-item">
            <div class="type-selector">
                <div class="type-option" :class="{ active: form.actionType === 'qna' }" @click="setActionType('qna')">
                    <i class="el-icon-chat-square"></i>
                    <span>Q&A Pack</span>
                </div>
                <div class="type-option" :class="{ active: form.actionType === 'content' }" @click="setActionType('content')">
                    <i class="el-icon-notebook-2"></i>
                    <span>Content Pack</span>
                </div>
                <div class="type-option" :class="{ active: form.actionType === 'ai' }" @click="setActionType('ai')">
                    <i class="el-icon-cpu"></i>
                    <span>AI Card</span>
                </div>
            </div>
        </el-form-item>

        <!-- Q&A Pack Selector -->
        <el-form-item v-if="form.actionType === 'qna'" label="Q&A Pack" prop="questionPackId" class="form-item">
          <el-select v-model="form.questionPackId" placeholder="Select Q&A pack" class="custom-select" filterable clearable>
            <el-option
              v-for="qp in questionPacks"
              :key="qp.id"
              :label="`${qp.packCode} - ${qp.name}`"
              :value="qp.id"/>
          </el-select>
          <div class="field-hint">Select a pre-defined Q&A pack (managed in Q&A Packs tab).</div>
        </el-form-item>

        <!-- AI Card Session Config -->
        <el-form-item v-if="form.actionType === 'ai'" label="Agent" class="form-item">
          <el-select v-model="form.aiAgentName" placeholder="Select agent" class="custom-select" filterable allow-create :loading="loadingAgentTemplates">
            <el-option v-for="tpl in agentTemplates" :key="tpl.id" :label="tpl.agentName" :value="tpl.agentName" />
          </el-select>
          <div class="field-hint">This becomes <code>actionData.agent_name</code> for the AI card. Listed from AI agent templates; the worker pulls the persona by this exact name.</div>
        </el-form-item>

        <el-form-item v-if="form.actionType === 'ai'" label="Language" class="form-item">
          <el-select v-model="form.aiLanguageCode" placeholder="Select language" class="custom-select" @change="handleLanguageChange">
            <el-option label="English" value="en" />
            <el-option label="Hindi" value="hi" />
            <el-option label="Telugu" value="te" />
            <el-option label="Kannada" value="kn" />
            <el-option label="Tamil" value="ta" />
            <el-option label="Malayalam" value="ml" />
            <el-option label="German" value="de" />
          </el-select>
          <div class="field-hint">The session language will be injected into the Cheeko prompt for this card.</div>
        </el-form-item>

        <el-form-item v-if="form.actionType === 'ai'" label="Voice ID" class="form-item">
          <el-input v-model="form.aiVoiceId" placeholder="Optional voice override" class="custom-input"></el-input>
          <div class="field-hint">Optional. Saved as <code>actionData.voice_id</code>.</div>
        </el-form-item>

        <el-form-item v-if="form.actionType === 'ai'" label="Thumbnail URL" class="form-item">
          <el-input v-model="form.thumbnailUrl" placeholder="Paste image URL or upload" class="custom-input">
            <template slot="append">
              <el-button
                icon="el-icon-upload2"
                :loading="uploadingThumbnail"
                @click="pickThumbnailFile"
              ></el-button>
            </template>
          </el-input>
          <div v-if="form.thumbnailUrl" class="thumbnail-preview">
            <img :src="form.thumbnailUrl" alt="AI card thumbnail" @error="handleThumbnailError" />
          </div>
        </el-form-item>

        <!-- Content Pack Selector -->
        <el-form-item v-if="form.actionType === 'content'" label="Content Pack" prop="contentPackId" class="form-item">
          <el-select v-model="form.contentPackId" placeholder="Select content pack" class="custom-select" filterable clearable>
            <el-option
              v-for="cp in contentPacks"
              :key="cp.id"
              :label="`${cp.packCode} - ${cp.name}`"
              :value="cp.id"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Product SKU" prop="packId" class="form-item">
           <el-select v-model="form.packId" placeholder="Physical Product (Optional)" class="custom-select" filterable clearable>
            <el-option
              v-for="p in packs"
              :key="p.id"
              :label="`${p.packCode} - ${p.name}`"
              :value="p.id"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Notes" prop="notes" class="form-item">
          <el-input type="textarea" v-model="form.notes" placeholder="Internal notes" :rows="2" class="custom-textarea"></el-input>
        </el-form-item>

        <el-form-item label="Active" prop="active" class="form-item">
          <el-switch v-model="form.active"></el-switch>
        </el-form-item>
      </el-form>

      <input
        ref="thumbnailFilePicker"
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,image/*"
        style="display: none"
        @change="handleThumbnailFileSelected"
      />

      <div class="dialog-footer">
        <el-button
          type="primary"
          @click="submit"
          class="save-btn"
          :loading="saving"
          :disabled="saving">
          Save
        </el-button>
        <el-button @click="cancel" class="cancel-btn">
          Cancel
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import Api from "@/apis/api";

export default {
  props: {
    title: {
      type: String,
      default: 'Add Card'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        id: null,
        rfidUid: '',
        questionPackId: null,
        contentPackId: null,
        packId: null, // Product SKU
        actionType: 'content', // 'content' or 'qna'
        aiAgentName: 'Cheeko',
        aiLanguageCode: 'en',
        aiLanguageName: 'English',
        aiVoiceId: '',
        thumbnailUrl: '',
        actionData: {},
        notes: '',
        active: true
      })
    },
    questionPacks: {
      type: Array,
      default: () => []
    },
    packs: {
      type: Array,
      default: () => []
    },
    contentPacks: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      dialogKey: Date.now(),
      saving: false,
      uploadingThumbnail: false,
      agentTemplates: [],
      loadingAgentTemplates: false,
      rules: {
        rfidUid: [
          { required: true, message: "Please enter RFID UID", trigger: "blur" }
        ]
      }
    };
  },
  mounted() {
    this.fetchAgentTemplates();
  },
  methods: {
    fetchAgentTemplates() {
      this.loadingAgentTemplates = true;
      Api.agent.getAgentTemplate((res) => {
        this.loadingAgentTemplates = false;
        if (res.data && res.data.code === 0) {
          this.agentTemplates = res.data.data || [];
        } else {
          this.$message.error('Failed to load agent templates');
        }
      });
    },
    submit() {
      this.$refs.form.validate((valid) => {
        if (valid) {
          this.saving = true;
          this.$emit('submit', {
            form: this.form,
            done: () => {
              this.saving = false;
            }
          });
          setTimeout(() => {
            this.saving = false;
          }, 3000);
        }
      });
    },
    pickThumbnailFile() {
      if (this.$refs.thumbnailFilePicker) {
        this.$refs.thumbnailFilePicker.click();
      }
    },
    async handleThumbnailFileSelected(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      await this.uploadThumbnailToS3(file);
      event.target.value = '';
    },
    getAuthToken() {
      const storedToken = localStorage.getItem('token');
      if (!storedToken) return null;
      try {
        const parsed = JSON.parse(storedToken);
        return parsed.token || storedToken;
      } catch (e) {
        return storedToken;
      }
    },
    async uploadThumbnailToS3(file) {
      const token = this.getAuthToken();
      if (!token) {
        this.$message.error('Authentication token missing. Please login again.');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('contentType', 'rfidcontent');
      formData.append('category', 'images');

      this.uploadingThumbnail = true;
      try {
        const response = await fetch(`${Api.getServiceUrl()}/admin/rfid/content-pack/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: formData
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Upload failed with status ${response.status}`);
        }

        const result = await response.json();
        if (result.code !== 0 || !result.data?.url) {
          throw new Error(result.msg || 'Upload failed');
        }

        this.$set(this.form, 'thumbnailUrl', result.data.url);
        this.$message.success('Thumbnail uploaded successfully.');
      } catch (error) {
        this.$message.error(`Upload failed: ${error.message}`);
      } finally {
        this.uploadingThumbnail = false;
      }
    },
    handleThumbnailError(event) {
      event.target.style.display = 'none';
    },
    setActionType(type) {
      this.form.actionType = type;
      if (type === 'ai') {
        if (!this.form.actionData) {
          this.form.actionData = {};
        }
        if (!this.form.aiAgentName) {
          this.form.aiAgentName = 'Cheeko';
        }
        if (!this.form.aiLanguageCode) {
          this.form.aiLanguageCode = 'en';
          this.form.aiLanguageName = 'English';
        }
        if (this.form.thumbnailUrl === undefined) {
          this.$set(this.form, 'thumbnailUrl', '');
        }
      }
    },
    handleLanguageChange(languageCode) {
      const languageMap = {
        en: 'English',
        hi: 'Hindi',
        te: 'Telugu',
        kn: 'Kannada',
        ta: 'Tamil',
        ml: 'Malayalam',
        de: 'German'
      };
      this.form.aiLanguageName = languageMap[languageCode] || languageCode || '';
    },
    cancel() {
      this.saving = false;
      this.$emit('cancel');
    }
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        this.dialogKey = Date.now();
      }
    },
    'form.actionType'(newVal) {
      if (newVal === 'qna') {
        this.form.contentPackId = null;
        this.form.cardType = null;
      } else if (newVal === 'content') {
        this.form.questionPackId = null;
        this.form.cardType = null;
      } else if (newVal === 'ai') {
        this.form.questionPackId = null;
        this.form.contentPackId = null;
        this.form.cardType = 'ai';
        if (!this.form.actionData) {
          this.form.actionData = {};
        }
        if (!this.form.aiAgentName) {
          this.form.aiAgentName = 'Cheeko';
        }
        if (!this.form.aiLanguageCode) {
          this.form.aiLanguageCode = 'en';
          this.form.aiLanguageName = 'English';
        }
        if (this.form.thumbnailUrl === undefined) {
          this.$set(this.form, 'thumbnailUrl', '');
        }
      }
    }
  }
};
</script>

<style>
.custom-rfid-dialog {
  border-radius: 16px !important;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15) !important;
  border: none !important;
}
.custom-rfid-dialog .el-dialog__header {
  display: none;
}
.custom-rfid-dialog .el-dialog__body {
  padding: 0 !important;
  border-radius: 16px;
}
</style>

<style scoped lang="scss">
.rfid-dialog-wrapper {
  .dialog-container {
    padding: 24px 32px;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  }

  .dialog-header {
    position: relative;
    margin-bottom: 24px;
    text-align: center;
  }

  .dialog-title {
    font-size: 20px;
    color: #1e293b;
    margin: 0;
    padding: 0;
    font-weight: 600;
  }

  .custom-close-btn {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: #f1f5f9;
    color: #64748b;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    outline: none;
    transition: all 0.3s;

    &:hover {
      color: #ffffff;
      background: #ef4444;
      transform: rotate(90deg);
    }
  }

  .rfid-form {
    .form-item {
      margin-bottom: 20px;

      :deep(.el-form-item__label) {
        color: #475569;
        font-weight: 500;
        font-size: 14px;
      }
    .field-hint {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 4px;
    }
    }

    .custom-input {
      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        height: 42px;
        font-size: 14px;
        color: #334155;

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }

    .custom-select {
      width: 100%;

      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        height: 42px;
        font-size: 14px;
        color: #334155;

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }

    .custom-textarea {
      :deep(.el-textarea__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        padding: 12px 14px;
        font-size: 14px;
        color: #334155;

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: center;
    padding: 16px 0 0;
    margin-top: 16px;

    .save-btn {
      width: 120px;
      height: 42px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      background: #3b82f6;
      color: white;
      border: none;

      &:hover {
        background: #2563eb;
      }
    }

    .cancel-btn {
      width: 120px;
      height: 42px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      background: #ffffff;
      color: #64748b;
      border: 1px solid #e2e8f0;
      margin-left: 16px;

      &:hover {
        background: #f8fafc;
      }
    }
  }
}

.type-selector {
  display: flex;
  gap: 12px;
  margin-top: 5px;
}
.type-option {
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 10px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  color: #606266;
  background: #fff;
  flex: 1;
  justify-content: center;
}
.type-option:hover {
  color: #409eff;
  border-color: #c6e2ff;
}
.type-option.active {
  color: #409eff;
  border-color: #409eff;
  background: #ecf5ff;
  font-weight: 500;
}
.type-option i {
  font-size: 16px;
}

.thumbnail-preview {
  margin-top: 10px;
  width: 96px;
  height: 72px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #ffffff;
  overflow: hidden;
}

.thumbnail-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
