<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="560px"
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
        <button class="custom-close-btn" @click="cancel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <el-form :model="form" :rules="rules" ref="form" label-width="110px" label-position="left" class="rfid-form">
        <el-form-item label="Code" prop="code" class="form-item">
          <el-input v-model="form.code" placeholder="e.g., ANIMALS_10" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Title" prop="title" class="form-item">
          <el-input v-model="form.title" placeholder="e.g., Name 10 animals" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Prompt Text" prop="promptText" class="form-item">
          <el-input type="textarea" v-model="form.promptText" placeholder="Text sent to AI when card tapped" :rows="3" class="custom-textarea"></el-input>
        </el-form-item>

        <el-form-item label="Category" prop="category" class="form-item">
          <el-select v-model="form.category" placeholder="Select category" class="custom-select" allow-create filterable>
            <el-option label="Animals" value="animals"/>
            <el-option label="Math" value="math"/>
            <el-option label="Story" value="story"/>
            <el-option label="Colors" value="colors"/>
            <el-option label="Numbers" value="numbers"/>
            <el-option label="Alphabet" value="alphabet"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Language" prop="language" class="form-item">
          <el-select v-model="form.language" placeholder="Select language" class="custom-select">
            <el-option label="English" value="en"/>
            <el-option label="Hindi" value="hi"/>
            <el-option label="Chinese" value="zh"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Difficulty" prop="difficulty" class="form-item">
          <el-select v-model="form.difficulty" placeholder="Select difficulty" class="custom-select">
            <el-option label="1 - Very Easy" :value="1"/>
            <el-option label="2 - Easy" :value="2"/>
            <el-option label="3 - Medium" :value="3"/>
            <el-option label="4 - Hard" :value="4"/>
            <el-option label="5 - Very Hard" :value="5"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Smart Caching" prop="allowCaching" class="form-item">
           <div class="flex-row">
              <el-switch v-model="form.allowCaching"></el-switch>
              <span class="ml-2 text-sm text-gray">Allow saving AI responses for instant playback later</span>
           </div>
        </el-form-item>

        <el-form-item v-if="form.allowCaching" label="Cached Audio" prop="cachedAudioUrl" class="form-item">
           <el-input v-model="form.cachedAudioUrl" placeholder="Optional: Pre-generated audio URL" class="custom-input">
              <template slot="prepend"><i class="el-icon-headset"></i></template>
           </el-input>
        </el-form-item>

        <el-form-item label="System Override" prop="systemPromptOverride" class="form-item">
           <el-input v-model="form.systemPromptOverride" placeholder="Optional: Override system persona" class="custom-input" size="small"></el-input>
        </el-form-item>

        <el-form-item label="Active" prop="active" class="form-item">
          <el-switch v-model="form.active"></el-switch>
        </el-form-item>
      </el-form>

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
import dialogDismiss from '@/mixins/dialogDismiss';
export default {
  mixins: [dialogDismiss],
  props: {
    title: {
      type: String,
      default: 'Add Question'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        id: null,
        code: '',
        title: '',
        promptText: '',
        language: 'en',
        category: '',
        difficulty: 3,
        allowCaching: true,
        cachedAudioUrl: '',
        systemPromptOverride: '',
        active: true
      })
    }
  },
  data() {
    return {
      dialogKey: Date.now(),
      saving: false,
      rules: {
        code: [
          { required: true, message: "Please enter question code", trigger: "blur" }
        ],
        title: [
          { required: true, message: "Please enter question title", trigger: "blur" }
        ]
      }
    };
  },
  methods: {
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
    padding: 24px 32px;
    background: $surface;
  }

  .dialog-header {
    position: relative;
    margin-bottom: 24px;
    text-align: center;
  }

  .dialog-title {
    font-size: 20px;
    color: $text-dark;
    margin: 0;
    padding: 0;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .custom-close-btn {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: $divider-color;
    color: $text-gray;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    outline: none;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: none;

    &:hover {
      color: #ffffff;
      background: $danger;
      transform: rotate(90deg);
      box-shadow: none;
    }
  }

  .rfid-form {
    .form-item {
      margin-bottom: 20px;

      :deep(.el-form-item__label) {
        color: $text-body;
        font-weight: 500;
        padding-right: 12px;
        text-align: right;
        font-size: 14px;
      }
    }

    .custom-input {
      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid $border-color;
        height: 42px;
        padding: 0 14px;
        transition: all 0.3s;
        font-size: 14px;
        color: $text-body;

        &:focus {
          border-color: $text-light;
          box-shadow: none;
        }
      }
    }

    .custom-select {
      width: 100%;

      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid $border-color;
        height: 42px;
        font-size: 14px;
        color: $text-body;

        &:focus {
          border-color: $text-light;
          box-shadow: none;
        }
      }
    }

    .custom-textarea {
      :deep(.el-textarea__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid $border-color;
        padding: 12px 14px;
        font-size: 14px;
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
    padding-top: 18px;
    margin-top: 22px;
    border-top: 1px solid $border-color;
  }

  .flex-row {
      display: flex;
      align-items: center;
  }
  .ml-2 { margin-left: 8px; }
  .text-sm { font-size: 12px; }
  .text-gray { color: $text-light; }
}
</style>
