<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="600px"
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

      <el-form :model="form" :rules="rules" ref="form" label-width="130px" label-position="left" class="rfid-form">
        <el-form-item label="Pack Code" prop="packCode" class="form-item">
          <el-input v-model="form.packCode" placeholder="e.g., BASIC_RHYMES_EN" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Name" prop="name" class="form-item">
          <el-input v-model="form.name" placeholder="Display name" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Description" prop="description" class="form-item">
          <el-input type="textarea" v-model="form.description" placeholder="Content pack description" :rows="2" class="custom-textarea"></el-input>
        </el-form-item>

        <el-form-item label="Content Type" prop="contentType" class="form-item">
          <el-select v-model="form.contentType" placeholder="Select type" class="custom-select">
            <el-option label="Prompt (AI-generated)" value="prompt"/>
            <el-option label="Read Only (TTS)" value="read_only"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Language" prop="language" class="form-item">
          <el-select v-model="form.language" placeholder="Select language" class="custom-select">
            <el-option label="English" value="en"/>
            <el-option label="Hindi" value="hi"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Status" prop="status" class="form-item">
          <el-radio-group v-model="form.status" size="small">
            <el-radio-button label="draft">Draft</el-radio-button>
            <el-radio-button label="published">Published</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="Version" prop="version" class="form-item">
           <el-input-number v-model="form.version" :min="1" size="small"></el-input-number>
        </el-form-item>

        <!-- Dynamic Items Table -->
        <div class="items-section">
           <div class="items-header">
              <span class="items-title">Pack Items (Max 10)</span>
              <el-button size="mini" type="primary" icon="el-icon-plus" @click="addItem" :disabled="form.items.length >= 10">Add Item</el-button>
           </div>
           
           <div class="items-list">
              <div v-for="(item, index) in form.items" :key="index" class="item-row">
                  <div class="item-col seq-col">
                     <span class="seq-badge">{{ index + 1 }}</span>
                  </div>
                  <div class="item-col main-col">
                      <el-input v-model="item.title" placeholder="Title" size="small" class="mb-1"></el-input>
                      <el-input v-model="item.audioUrl" placeholder="Audio URL (https://...)" size="small" class="mb-1">
                          <template slot="prepend"><i class="el-icon-headset"></i></template>
                      </el-input>
                      <el-input v-model="item.imageUrl" placeholder="Image URL (Thumbnail)" size="small">
                           <template slot="prepend"><i class="el-icon-picture"></i></template>
                      </el-input>
                  </div>
                  <div class="item-col action-col">
                      <el-button type="text" icon="el-icon-delete" class="text-danger" @click="removeItem(index)"></el-button>
                  </div>
              </div>
              <div v-if="form.items.length === 0" class="empty-items">
                  No items added. Click "Add Item" to start.
              </div>
           </div>
        </div>
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
      default: 'Add Content Pack'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        packCode: '',
        name: '',
        description: '',
        contentType: 'story_pack', // Default to story pack
        language: 'en',
        status: 'draft',
        version: 1,
        active: true,
        items: [] // Structured Items
      })
    }
  },
  data() {
    return {
      dialogKey: Date.now(),
      saving: false,
      rules: {
        packCode: [
          { required: true, message: "Please enter pack code", trigger: "blur" }
        ],
        name: [
          { required: true, message: "Please enter name", trigger: "blur" }
        ]
      }
    };
  },
  methods: {
    addItem() {
        if (this.form.items.length < 10) {
            this.form.items.push({
                sequence: this.form.items.length + 1,
                title: '',
                audioUrl: '',
                imageUrl: ''
            });
        }
    },
    removeItem(index) {
        this.form.items.splice(index, 1);
        // Re-sequence
        this.form.items.forEach((item, idx) => {
            item.sequence = idx + 1;
        });
    },
    submit() {
      this.$refs.form.validate((valid) => {
        if (valid) {
          // Validate Items
          if (this.form.items.length === 0) {
              this.$message.warning("Please add at least one item to the pack.");
              return;
          }

          this.saving = true;
          this.$emit('submit', {
            form: this.form,
            done: () => {
              this.saving = false;
            }
          });
          setTimeout(() => {
             if (this.saving) this.saving = false;
          }, 5000);
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
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }

    .total-items-input {
      width: 160px;
    }

    .items-section {
        margin-top: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        background: #fff;
    }

    .items-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }
    
    .items-title {
        font-weight: 600;
        color: #475569;
        font-size: 14px;
    }

    .item-row {
        display: flex;
        gap: 12px;
        padding: 12px;
        border-bottom: 1px solid #f1f5f9;
        align-items: flex-start;
        
        &:last-child {
            border-bottom: none;
        }
    }

    .seq-col {
        width: 30px;
        padding-top: 8px;
    }
    
    .seq-badge {
        background: #e2e8f0;
        color: #64748b;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
    }

    .main-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .action-col {
        width: 30px;
        padding-top: 8px;
    }

    .mb-1 {
        margin-bottom: 4px;
    }

    .empty-items {
        text-align: center;
        padding: 20px;
        color: #94a3b8;
        font-size: 13px;
        font-style: italic;
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
