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
        <el-form-item label="Start UID" prop="startUid" class="form-item">
          <el-input v-model="form.startUid" placeholder="Start of UID range (hex)" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="End UID" prop="endUid" class="form-item">
          <el-input v-model="form.endUid" placeholder="End of UID range (hex)" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Pack Type" class="form-item">
          <el-radio-group v-model="packType" @change="handlePackTypeChange">
            <el-radio label="qa">Q&A Pack</el-radio>
            <el-radio label="content">Content Pack</el-radio>
            <el-radio label="ai">AI Card</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="packType === 'qa'" label="Q&A Pack" prop="questionPackId" class="form-item">
          <el-select v-model="form.questionPackId" placeholder="Select Q&A Pack" class="custom-select" filterable clearable>
            <el-option
              v-for="qp in questionPacks"
              :key="qp.id"
              :label="`${qp.packCode} - ${qp.name}`"
              :value="qp.id"/>
          </el-select>
        </el-form-item>

        <el-form-item v-if="packType === 'content'" label="Content Pack" prop="contentPackId" class="form-item">
          <el-select v-model="form.contentPackId" placeholder="Select Content Pack (Story/Rhyme)" class="custom-select" filterable clearable>
            <el-option
              v-for="cp in contentPacks"
              :key="cp.id"
              :label="`${cp.packCode} - ${cp.name}`"
              :value="cp.id"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Priority" prop="priority" class="form-item">
          <el-input-number v-model="form.priority" :min="0" :max="100" placeholder="Higher wins on overlap"></el-input-number>
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
      default: 'Add Series'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        id: null,
        startUid: '',
        endUid: '',
        questionPackId: null,
        contentPackId: null,
        priority: 0,
        notes: '',
        active: true
      })
    },
    questionPacks: {
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
      packType: 'content',
      rules: {
        startUid: [
          { required: true, message: "Please enter start UID", trigger: "blur" }
        ],
        endUid: [
          { required: true, message: "Please enter end UID", trigger: "blur" }
        ]
      }
    };
  },
  methods: {
    handlePackTypeChange(type) {
      if (type === 'qa') {
        this.form.contentPackId = null;
      } else if (type === 'content') {
        this.form.questionPackId = null;
      } else if (type === 'ai') {
        this.form.questionPackId = null;
        this.form.contentPackId = null;
      }
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
    cancel() {
      this.saving = false;
      this.$emit('cancel');
    },
    detectPackType() {
      if (this.form.questionPackId) {
        this.packType = 'qa';
      } else if (this.form.contentPackId) {
        this.packType = 'content';
      } else {
        this.packType = 'ai';
      }
    }
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        this.dialogKey = Date.now();
        this.detectPackType();
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
</style>
