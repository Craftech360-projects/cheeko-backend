<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="560px"
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
export default {
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
    background: #f1f5f9;
    color: #64748b;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    outline: none;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

    &:hover {
      color: #ffffff;
      background: #ef4444;
      transform: rotate(90deg);
      box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);
    }
  }

  .rfid-form {
    .form-item {
      margin-bottom: 20px;

      :deep(.el-form-item__label) {
        color: #475569;
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
        border: 1px solid #e2e8f0;
        height: 42px;
        padding: 0 14px;
        transition: all 0.3s;
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
        transform: translateY(-1px);
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
        color: #475569;
      }
    }
  }

  .flex-row {
      display: flex;
      align-items: center;
  }
  .ml-2 { margin-left: 8px; }
  .text-sm { font-size: 12px; }
  .text-gray { color: #94a3b8; }
}
</style>
