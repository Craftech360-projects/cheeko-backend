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
        <button class="custom-close-btn" @click="cancel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <el-form :model="form" :rules="rules" ref="form" label-width="110px" label-position="left" class="rfid-form">
        <el-form-item label="Pack Code" prop="packCode" class="form-item">
          <el-input v-model="form.packCode" placeholder="e.g., BLINKIT_ANIMALS_PACK_1" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Name" prop="name" class="form-item">
          <el-input v-model="form.name" placeholder="Pack display name" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Description" prop="description" class="form-item">
          <el-input type="textarea" v-model="form.description" placeholder="Pack description" :rows="3" class="custom-textarea"></el-input>
        </el-form-item>

        <el-form-item label="Age Range" class="form-item">
          <div class="age-range">
            <el-input-number v-model="form.ageMin" :min="1" :max="20" placeholder="Min" class="age-input"></el-input-number>
            <span class="age-separator">to</span>
            <el-input-number v-model="form.ageMax" :min="1" :max="20" placeholder="Max" class="age-input"></el-input-number>
          </div>
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
      default: 'Add Pack'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        id: null,
        packCode: '',
        name: '',
        description: '',
        ageMin: 3,
        ageMax: 16,
        active: true
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
          { required: true, message: "Please enter pack name", trigger: "blur" }
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
    transition: all 0.3s;

    &:hover {
      color: #ffffff;
      background: $danger;
      transform: rotate(90deg);
    }
  }

  .rfid-form {
    .form-item {
      margin-bottom: 20px;

      :deep(.el-form-item__label) {
        color: $text-body;
        font-weight: 500;
        font-size: 14px;
      }
    }

    .custom-input {
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

    .age-range {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .age-input {
      width: 120px;
    }

    .age-separator {
      color: $text-gray;
      font-size: 14px;
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
}
</style>
