<template>
  <div class="template-management">
    <HeaderBar />

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <div class="page-header">
            <div class="header-left">
              <div class="header-icon">
                <img loading="lazy" src="@/assets/home/setting-user.png" alt="" />
              </div>
              <span class="header-title">Agent Templates</span>
            </div>
            <div class="header-actions">
              <el-button type="primary" size="small" @click="showAddDialog">
                <i class="el-icon-plus"></i> Add Template
              </el-button>
              <button class="custom-close-btn" @click="goToHome">×</button>
            </div>
          </div>

          <div class="divider"></div>

          <el-table
            :data="templates"
            v-loading="loading"
            style="width: 100%"
            size="small"
            :row-class-name="tableRowClassName"
          >
            <el-table-column prop="agentName" label="Name" min-width="120" />
            <el-table-column prop="language" label="Language" width="100" />
            <el-table-column label="System Prompt" min-width="200">
              <template slot-scope="scope">
                <span class="truncate-text">{{ truncateText(scope.row.systemPrompt, 80) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="sort" label="Sort" width="60" align="center" />
            <el-table-column label="Visible" width="70" align="center">
              <template slot-scope="scope">
                <el-tag :type="scope.row.isVisible ? 'success' : 'info'" size="mini">
                  {{ scope.row.isVisible ? 'Yes' : 'No' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Actions" width="140" align="center" fixed="right">
              <template slot-scope="scope">
                <el-button type="text" size="mini" @click="handleEdit(scope.row)">
                  Edit
                </el-button>
                <el-button type="text" size="mini" class="delete-btn" @click="handleDelete(scope.row)">
                  Delete
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div v-if="templates.length === 0 && !loading" class="empty-state">
            <i class="el-icon-document"></i>
            <p>No templates yet. Click "Add Template" to create one.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Dialog -->
    <el-dialog
      :title="editMode ? 'Edit Template' : 'Add Template'"
      :visible.sync="dialogVisible"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="templateForm"
        :model="form"
        :rules="rules"
        label-position="top"
        size="small"
        class="template-form"
      >
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="Template Name" prop="agentName">
              <el-input v-model="form.agentName" placeholder="Enter template name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Language" prop="language">
              <el-select v-model="form.language" placeholder="Select language" style="width: 100%">
                <el-option label="English" value="English" />
                <el-option label="Hindi" value="Hindi" />
                <el-option label="Chinese" value="Chinese" />
                <el-option label="Spanish" value="Spanish" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="Language Code" prop="langCode">
              <el-select v-model="form.langCode" placeholder="Select code" style="width: 100%">
                <el-option label="en (English)" value="en" />
                <el-option label="hi (Hindi)" value="hi" />
                <el-option label="zh (Chinese)" value="zh" />
                <el-option label="es (Spanish)" value="es" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="Sort Order">
              <el-input-number v-model="form.sort" :min="0" :max="999" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="Visible">
              <el-switch v-model="form.visible" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="System Prompt" prop="systemPrompt">
          <el-input
            type="textarea"
            v-model="form.systemPrompt"
            :rows="4"
            placeholder="Enter the system prompt for this template..."
            maxlength="10000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="Memory Notes">
          <el-input
            type="textarea"
            v-model="form.summaryMemory"
            :rows="2"
            placeholder="Default memory/context for agents using this template..."
            maxlength="2000"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <div slot="footer" class="dialog-footer">
        <div class="footer-left" v-if="editMode">
          <el-checkbox v-model="applyToAgents">
            Apply changes to all agents using this template
          </el-checkbox>
        </div>
        <div class="footer-right">
          <el-button size="small" @click="dialogVisible = false">Cancel</el-button>
          <el-button type="primary" size="small" :loading="submitting" @click="handleSubmit">
            {{ editMode ? 'Update' : 'Create' }}
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import Api from "@/apis/api";
import HeaderBar from "@/components/HeaderBar.vue";

export default {
  name: "TemplateManagement",
  components: { HeaderBar },
  data() {
    return {
      templates: [],
      loading: false,
      dialogVisible: false,
      editMode: false,
      editingId: null,
      submitting: false,
      applyToAgents: false,
      form: this.getEmptyForm(),
      rules: {
        agentName: [
          { required: true, message: "Please enter template name", trigger: "blur" }
        ],
        language: [
          { required: true, message: "Please select language", trigger: "change" }
        ],
        langCode: [
          { required: true, message: "Please select language code", trigger: "change" }
        ]
      }
    };
  },
  methods: {
    getEmptyForm() {
      return {
        agentName: "",
        agentCode: "",
        language: "English",
        langCode: "en",
        systemPrompt: "",
        summaryMemory: "",
        chatHistoryConf: 1,
        sort: 0,
        visible: true
      };
    },
    goToHome() {
      this.$router.push("/home");
    },
    fetchTemplates() {
      this.loading = true;
      // Pass true to include hidden templates for admin management
      Api.agent.getAgentTemplate(({ data }) => {
        this.loading = false;
        if (data.code === 0) {
          this.templates = data.data || [];
        } else {
          this.$message.error(data.msg || "Failed to load templates");
        }
      }, true);
    },
    truncateText(text, maxLength) {
      if (!text) return "-";
      return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
    },
    tableRowClassName({ rowIndex }) {
      return rowIndex % 2 === 0 ? "even-row" : "odd-row";
    },
    showAddDialog() {
      this.editMode = false;
      this.editingId = null;
      this.form = this.getEmptyForm();
      this.dialogVisible = true;
      this.$nextTick(() => {
        this.$refs.templateForm?.clearValidate();
      });
    },
    handleEdit(row) {
      this.editMode = true;
      this.editingId = row.id;
      this.applyToAgents = false;
      this.form = {
        agentName: row.agentName || "",
        agentCode: row.agentCode || "",
        language: row.language || "English",
        langCode: row.langCode || "en",
        systemPrompt: row.systemPrompt || "",
        summaryMemory: row.summaryMemory || "",
        chatHistoryConf: row.chatHistoryConf ?? 1,
        sort: row.sort ?? 0,
        visible: row.isVisible === 1 || row.isVisible === true
      };
      this.dialogVisible = true;
    },
    handleSubmit() {
      this.$refs.templateForm.validate((valid) => {
        if (!valid) return;

        this.submitting = true;
        const data = {
          ...this.form,
          isVisible: this.form.visible ? 1 : 0
        };
        delete data.visible;

        if (this.editMode) {
          Api.agent.updateAgentTemplate(this.editingId, data, ({ data: res }) => {
            if (res.code === 0) {
              // If checkbox is checked, also apply to all agents
              if (this.applyToAgents) {
                Api.agent.applyTemplateToAgents(this.editingId, ({ data: applyRes }) => {
                  this.submitting = false;
                  this.dialogVisible = false;
                  this.fetchTemplates();
                  if (applyRes.code === 0) {
                    const count = applyRes.data?.updatedCount || 0;
                    this.$message.success(`Template updated and applied to ${count} agent(s)`);
                  } else {
                    this.$message.warning("Template updated but failed to apply to agents");
                  }
                });
              } else {
                this.submitting = false;
                this.$message.success("Template updated successfully");
                this.dialogVisible = false;
                this.fetchTemplates();
              }
            } else {
              this.submitting = false;
              this.$message.error(res.msg || "Failed to update template");
            }
          });
        } else {
          Api.agent.createAgentTemplate(data, ({ data: res }) => {
            this.submitting = false;
            if (res.code === 0) {
              this.$message.success("Template created successfully");
              this.dialogVisible = false;
              this.fetchTemplates();
            } else {
              this.$message.error(res.msg || "Failed to create template");
            }
          });
        }
      });
    },
    handleDelete(row) {
      this.$confirm(
        `Are you sure you want to delete template "${row.agentName}"?`,
        "Delete Template",
        {
          confirmButtonText: "Delete",
          cancelButtonText: "Cancel",
          type: "warning"
        }
      )
        .then(() => {
          Api.agent.deleteAgentTemplate(row.id, ({ data: res }) => {
            if (res.code === 0) {
              this.$message.success("Template deleted");
              this.fetchTemplates();
            } else {
              this.$message.error(res.msg || "Failed to delete template");
            }
          });
        })
        .catch(() => {});
    }
  },
  mounted() {
    this.fetchTemplates();
  }
};
</script>

<style scoped lang="scss">
@import "@/styles/theme.scss";

.template-management {
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
}

.page-header {
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

  img {
    width: 18px;
    height: 18px;
    filter: brightness(0) invert(1);
  }
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

.truncate-text {
  color: #666;
  font-size: 12px;
}

.delete-btn {
  color: #f56c6c !important;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #909399;

  i {
    font-size: 48px;
    margin-bottom: 16px;
  }

  p {
    margin: 0;
  }
}

.template-form {
  .el-form-item {
    margin-bottom: 12px;
  }

  ::v-deep .el-form-item__label {
    padding-bottom: 4px;
    font-size: 13px;
    color: #606266;
  }
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .footer-left {
    font-size: 12px;
    color: #606266;
  }

  .footer-right {
    display: flex;
    gap: 8px;
  }
}

::v-deep .el-table {
  font-size: 13px;

  .even-row {
    background: #fafafa;
  }

  .odd-row {
    background: #fff;
  }

  th {
    background: #f5f7fa !important;
    color: #606266;
    font-weight: 600;
  }
}

::v-deep .el-dialog__body {
  padding: 16px 20px;
}

::v-deep .el-dialog__header {
  padding: 16px 20px 10px;
  border-bottom: 1px solid #eee;
}

::v-deep .el-dialog__footer {
  padding: 10px 20px 16px;
  border-top: 1px solid #eee;
}
</style>
