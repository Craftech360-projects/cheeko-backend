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
                <div class="type-option" :class="{ active: form.actionType === 'interactive' }" @click="setActionType('interactive')">
                    <i class="el-icon-magic-stick"></i>
                    <span>Interactive</span>
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

        <!-- Interactive Template Selector -->
        <el-form-item v-if="form.actionType === 'interactive'" label="Template" class="form-item">
          <el-select v-model="form.interactiveTemplateId" placeholder="Select interactive template" class="custom-select" filterable clearable>
            <el-option
              v-for="t in interactiveTemplates"
              :key="t.id"
              :label="t.displayName"
              :value="t.id">
              <span>{{ t.displayName }}</span>
              <span style="float: right; color: #909399; font-size: 12px;">{{ t.templateCode }}</span>
            </el-option>
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
        interactiveTemplateId: null,
        packId: null, // Product SKU
        actionType: 'content', // 'content', 'qna', 'ai', or 'interactive'
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
    },
    interactiveTemplates: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      dialogKey: Date.now(),
      saving: false,
      rules: {
        rfidUid: [
          { required: true, message: "Please enter RFID UID", trigger: "blur" }
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
    setActionType(type) {
      this.form.actionType = type;
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
        this.form.interactiveTemplateId = null;
        this.form.cardType = null;
      } else if (newVal === 'content') {
        this.form.questionPackId = null;
        this.form.interactiveTemplateId = null;
        this.form.cardType = null;
      } else if (newVal === 'ai') {
        this.form.questionPackId = null;
        this.form.contentPackId = null;
        this.form.interactiveTemplateId = null;
        this.form.cardType = 'ai';
      } else if (newVal === 'interactive') {
        this.form.questionPackId = null;
        this.form.contentPackId = null;
        this.form.cardType = null;
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
</style>
