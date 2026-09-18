<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="520px"
    class="rfid-dialog-wrapper"
    :append-to-body="true"
    :close-on-click-modal="dismissOnBackdrop"
    @open="markPristine"
    @close="cancel"
    :key="dialogKey"
    custom-class="custom-rfid-dialog"
    :show-close="false"
  >
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 class="dialog-title">{{ title }}</h2>
        <button class="custom-close-btn" aria-label="Close" @click="cancel">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <el-form :model="form" :rules="rules" ref="form" label-position="top" class="rfid-form">
        <el-form-item label="RFID UID" prop="rfidUid" class="form-item">
          <el-input v-model="form.rfidUid" placeholder="Physical card UID (hex)" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Content Type" class="form-item">
            <div class="type-selector" role="radiogroup">
                <button type="button" v-for="opt in typeOptions" :key="opt.value"
                    class="type-option" :class="{ active: form.actionType === opt.value }"
                    role="radio" :aria-checked="form.actionType === opt.value"
                    @click="setActionType(opt.value)">
                    <i :class="opt.icon"></i>
                    <span>{{ opt.label }}</span>
                </button>
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

        <div v-if="form.actionType === 'ai'" class="form-row">
          <el-form-item label="Language" class="form-item">
            <el-select v-model="form.aiLanguageCode" placeholder="Select language" class="custom-select" @change="handleLanguageChange">
              <el-option label="English" value="en" />
              <el-option label="Hindi" value="hi" />
              <el-option label="Telugu" value="te" />
              <el-option label="Kannada" value="kn" />
              <el-option label="Tamil" value="ta" />
              <el-option label="Malayalam" value="ml" />
              <el-option label="German" value="de" />
            </el-select>
          </el-form-item>

          <el-form-item label="Voice ID" class="form-item">
            <el-input v-model="form.aiVoiceId" placeholder="Optional override" class="custom-input"></el-input>
          </el-form-item>
        </div>

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

        <!-- Content Pack / Game Pack Selector -->
        <el-form-item v-if="form.actionType === 'content' || form.actionType === 'game'" :label="form.actionType === 'game' ? 'Game Pack' : 'Content Pack'" prop="contentPackId" class="form-item">
          <el-select v-model="form.contentPackId" :placeholder="form.actionType === 'game' ? 'Select sound-quiz pack' : 'Select content pack'" class="custom-select" filterable clearable>
            <el-option
              v-for="cp in packOptions"
              :key="cp.id"
              :label="`${cp.packCode} - ${cp.name}`"
              :value="cp.id"/>
          </el-select>
          <div v-if="form.actionType === 'game'" class="field-hint">Only packs of type Sound Quiz (Game) are listed. The card downloads the pack onto the toy and launches it.</div>
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
        <el-button size="small" @click="cancel">Cancel</el-button>
        <el-button
          size="small"
          type="primary"
          :loading="saving"
          :disabled="saving"
          @click="submit">
          Save
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import Api from "@/apis/api";
import dialogDismiss from '@/mixins/dialogDismiss';

export default {
  mixins: [dialogDismiss],
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
  computed: {
    // Game cards list only sound-quiz packs; content cards list everything else.
    packOptions() {
      const isGame = this.form.actionType === 'game';
      return (this.contentPacks || []).filter(cp => (cp.contentType === 'sound_quiz') === isGame);
    },
    typeOptions() {
      return [
        { value: 'qna', label: 'Q&A Pack', icon: 'el-icon-chat-square' },
        { value: 'content', label: 'Content Pack', icon: 'el-icon-notebook-2' },
        { value: 'ai', label: 'AI Card', icon: 'el-icon-cpu' },
        { value: 'game', label: 'Game Card', icon: 'el-icon-trophy' }
      ];
    }
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
      } else if (newVal === 'game') {
        this.form.questionPackId = null;
        this.form.cardType = 'game';
      }
    }
  }
};
</script>

<style>

/* Dialog chrome. Not scoped: el-dialog mounts on body. Shared verbatim by
   every RFID dialog so the overlay reads the same wherever it opens. */
.custom-rfid-dialog {
  border-radius: 10px !important;
  overflow: hidden;
  border: 1px solid var(--border-color) !important;
  box-shadow: var(--shadow-overlay) !important;
}
.custom-rfid-dialog .el-dialog__header {
  display: none;
}
.custom-rfid-dialog .el-dialog__body {
  padding: 0 !important;
}
</style>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.rfid-dialog-wrapper {
  .dialog-container {
    background: $surface;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid $border-color;
  }

  .dialog-title {
    font-family: $font-display;
    font-size: 16px;
    font-weight: 600;
    color: $text-dark;
    margin: 0;
  }

  .custom-close-btn {
    width: 28px;
    height: 28px;
    border-radius: $radius-sm;
    border: none;
    background: transparent;
    color: $text-light;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.15s, color 0.15s;

    &:hover {
      background: $surface-sunk;
      color: $text-dark;
    }
  }

  .rfid-form {
    padding: 20px 24px 4px;
    max-height: 64vh;
    overflow-y: auto;

    .form-item {
      margin-bottom: 16px;

      :deep(.el-form-item__label) {
        float: none;
        display: block;
        text-align: left;
        padding: 0 0 6px;
        line-height: 1.4;
      }

      :deep(.el-form-item__content) {
        line-height: 1.4;
      }
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .field-hint {
      font-size: 11.5px;
      color: $text-light;
      margin-top: 6px;
      line-height: 1.5;
    }

    .custom-select {
      width: 100%;
    }

    .custom-input,
    .custom-select {
      :deep(.el-input__inner) {
        height: 36px;
        line-height: 36px;
        border-radius: 6px;
        border: 1px solid $border-color;
        font-size: 13px;
        color: $text-body;

        &:focus {
          border-color: $text-light;
          box-shadow: none;
        }
      }
    }

    .custom-textarea {
      :deep(.el-textarea__inner) {
        border-radius: 6px;
        border: 1px solid $border-color;
        font-size: 13px;
        color: $text-body;

        &:focus {
          border-color: $text-light;
          box-shadow: none;
        }
      }
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 24px;
    border-top: 1px solid $border-color;
  }
}

/* One outlined control split into equal segments; fits three or four types. */
.type-selector {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  border: 1px solid $border-color;
  border-radius: 6px;
  overflow: hidden;
  background: $surface;
}
.type-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 56px;
  padding: 0 6px;
  border: none;
  border-left: 1px solid $border-color;
  background: transparent;
  color: $text-gray;
  font-family: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:first-child {
    border-left: none;
  }
  &:hover {
    color: $text-dark;
    background: $surface-sunk;
  }
  &.active {
    color: $text-dark;
    background: $row-selected;
    font-weight: 600;
    box-shadow: inset 0 -2px 0 $text-dark;
  }
  i {
    font-size: 16px;
  }
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
}
.thumbnail-preview {
  margin-top: 8px;
  width: 96px;
  height: 72px;
  border: 1px solid $border-color;
  border-radius: 6px;
  background: $surface;
  overflow: hidden;
}

.thumbnail-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
