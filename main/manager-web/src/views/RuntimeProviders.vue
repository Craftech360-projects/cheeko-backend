<template>
  <div class="welcome">
    <HeaderBar />

    <div class="operation-bar">
      <div>
        <h2 class="page-title">Runtime Providers</h2>
        <div class="page-subtitle">Manage active LLM, STT, and TTS services used by the voice runtime.</div>
      </div>
      <div class="right-operations">
        <el-button class="btn-search" icon="el-icon-refresh" @click="fetchProviders">Refresh</el-button>
      </div>
    </div>

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <el-card class="providers-card" shadow="never">
            <div class="summary-strip">
              <div
                v-for="type in providerTypes"
                :key="`summary-${type.value}`"
                class="summary-item"
                :class="[type.value, { current: activeType === type.value }]"
                @click="activeType = type.value"
              >
                <div class="summary-top">
                  <span class="summary-icon"><i :class="type.icon"></i></span>
                  <span class="summary-label">{{ type.label }}</span>
                </div>
                <strong>{{ providerLabel(type.value, activeProvider(type.value)) }}</strong>
                <small>
                  <span class="live-dot"></span>
                  {{ providerCount(type.value) }} configured
                </small>
              </div>
            </div>

            <el-tabs v-model="activeType" class="provider-tabs">
              <el-tab-pane
                v-for="type in providerTypes"
                :key="type.value"
                :name="type.value"
              >
                <span slot="label" class="tab-label">
                  {{ type.label }}
                  <span class="tab-count">{{ providerCount(type.value) }}</span>
                </span>
                <el-table
                  :data="providers[type.value]"
                  class="transparent-table"
                  :row-class-name="providerRowClassName"
                  v-loading="loading"
                  element-loading-text="Loading..."
                  element-loading-spinner="el-icon-loading"
                  element-loading-background="rgba(255, 255, 255, 0.7)"
                  >
                  <el-table-column label="Status" align="left" width="120">
                    <template slot-scope="scope">
                      <span class="status-pill" :class="{ active: scope.row.is_active }">
                        <i :class="scope.row.is_active ? 'el-icon-success' : 'el-icon-remove-outline'"></i>
                        {{ scope.row.is_active ? 'Active' : 'Inactive' }}
                      </span>
                    </template>
                  </el-table-column>

                  <el-table-column
                    v-for="column in tableColumns[type.value]"
                    :key="column.prop"
                    :label="column.label"
                    :prop="column.prop"
                    align="left"
                    show-overflow-tooltip
                  >
                    <template slot-scope="scope">
                      <template v-if="column.secret">
                        <span class="secret-cell">
                          <span class="secret-value">{{ secretVisibleKey(scope.row) ? scope.row[column.prop] || '' : maskSensitiveValue(scope.row[column.prop]) }}</span>
                          <el-button size="mini" type="text" class="secret-toggle" @click="toggleSecret(scope.row)">
                          {{ secretVisibleKey(scope.row) ? 'Hide' : 'View' }}
                          </el-button>
                        </span>
                      </template>
                      <template v-else>
                        <span :class="{ 'mono-value': column.mono }">{{ formatValue(scope.row[column.prop]) }}</span>
                      </template>
                    </template>
                  </el-table-column>

                  <el-table-column label="Priority" prop="priority" align="center" width="90"></el-table-column>
                  <el-table-column label="Updated" prop="updated_at" align="center" width="170">
                    <template slot-scope="scope">
                      {{ formatDate(scope.row.updated_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="Actions" align="center" width="190">
                    <template slot-scope="scope">
                      <el-button size="mini" class="action-button" icon="el-icon-edit" @click="openEditDialog(type.value, scope.row)">Edit</el-button>
                      <el-button
                        size="mini"
                        class="action-button activate-button"
                        :disabled="scope.row.is_active"
                        icon="el-icon-check"
                        @click="activateProvider(type.value, scope.row)"
                      >
                        Active
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </el-tab-pane>
            </el-tabs>
          </el-card>
        </div>
      </div>
    </div>

    <el-dialog
      :title="dialogTitle"
      :visible.sync="dialogVisible"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form :model="editForm" label-width="150px" label-position="left" class="provider-form">
        <el-form-item
          v-for="field in editFields"
          :key="field.prop"
          :label="field.label"
        >
          <el-input-number
            v-if="field.type === 'number'"
            v-model="editForm[field.prop]"
            :min="field.min"
            :step="field.step || 1"
            class="full-input"
          ></el-input-number>
          <el-input
            v-else-if="field.secret"
            v-model="editForm[field.prop]"
            type="password"
            show-password
            class="full-input"
          ></el-input>
          <el-input
            v-else
            v-model="editForm[field.prop]"
            class="full-input"
          ></el-input>
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false">Cancel</el-button>
        <el-button type="primary" :loading="saving" @click="saveProvider">Save</el-button>
      </span>
    </el-dialog>

    <el-footer>
      <version-footer />
    </el-footer>
  </div>
</template>

<script>
import Api from "@/apis/api";
import HeaderBar from "@/components/HeaderBar.vue";
import VersionFooter from "@/components/VersionFooter.vue";

export default {
  name: "RuntimeProviders",
  components: { HeaderBar, VersionFooter },
  data() {
    return {
      activeType: "llm",
      loading: false,
      saving: false,
      dialogVisible: false,
      editType: "",
      editForm: {},
      visibleSecrets: {},
      providers: {
        llm: [],
        stt: [],
        tts: []
      },
      providerTypes: [
        { value: "llm", label: "LLM", icon: "el-icon-cpu" },
        { value: "stt", label: "STT", icon: "el-icon-microphone" },
        { value: "tts", label: "TTS", icon: "el-icon-headset" }
      ],
      tableColumns: {
        llm: [
          { label: "Model Name", prop: "model_name", mono: true },
          { label: "Model", prop: "model", mono: true },
          { label: "API Base", prop: "api_base" },
          { label: "API Key", prop: "api_key", secret: true }
        ],
        stt: [
          { label: "Provider", prop: "provider_name", mono: true },
          { label: "Model", prop: "model", mono: true },
          { label: "Language", prop: "language" },
          { label: "Sample Rate", prop: "sample_rate" },
          { label: "API Key", prop: "api_key", secret: true }
        ],
        tts: [
          { label: "Provider", prop: "provider_name", mono: true },
          { label: "Voice ID", prop: "voice_id", mono: true },
          { label: "Model ID", prop: "model_id", mono: true },
          { label: "Output", prop: "output_format", mono: true },
          { label: "Sample Rate", prop: "sample_rate_hz" },
          { label: "Temperature", prop: "temperature" },
          { label: "API Key", prop: "api_key", secret: true }
        ]
      },
      formFields: {
        llm: [
          { label: "Model Name", prop: "model_name" },
          { label: "Model", prop: "model" },
          { label: "API Base", prop: "api_base" },
          { label: "API Key", prop: "api_key", secret: true },
          { label: "Priority", prop: "priority", type: "number", min: 0 }
        ],
        stt: [
          { label: "Provider", prop: "provider_name" },
          { label: "Model", prop: "model" },
          { label: "Language", prop: "language" },
          { label: "Sample Rate", prop: "sample_rate", type: "number", min: 0 },
          { label: "API Key", prop: "api_key", secret: true },
          { label: "Priority", prop: "priority", type: "number", min: 0 }
        ],
        tts: [
          { label: "Provider", prop: "provider_name" },
          { label: "Voice ID", prop: "voice_id" },
          { label: "Model ID", prop: "model_id" },
          { label: "Output Format", prop: "output_format" },
          { label: "Sample Rate", prop: "sample_rate_hz", type: "number", min: 0 },
          { label: "Temperature", prop: "temperature", type: "number", min: 0, step: 0.01 },
          { label: "API Key", prop: "api_key", secret: true },
          { label: "Priority", prop: "priority", type: "number", min: 0 }
        ]
      }
    };
  },
  computed: {
    editFields() {
      return this.formFields[this.editType] || [];
    },
    dialogTitle() {
      const type = (this.editType || "").toUpperCase();
      return type ? `Edit ${type} Provider` : "Edit Provider";
    }
  },
  created() {
    this.fetchProviders();
  },
  methods: {
    fetchProviders() {
      this.loading = true;
      Api.runtimeProviders.getProviders(({ data }) => {
        this.loading = false;
        if (data.code === 0) {
          this.providers = {
            llm: (data.data.llm || []).map(this.withUiState),
            stt: (data.data.stt || []).map(this.withUiState),
            tts: (data.data.tts || []).map(this.withUiState)
          };
          return;
        }
        this.$message.error({ message: data.msg || "Failed to load runtime providers", showClose: true });
      });
    },
    withUiState(row) {
      return { ...row };
    },
    secretVisibleKey(row) {
      return Boolean(this.visibleSecrets[row.id]);
    },
    toggleSecret(row) {
      this.$set(this.visibleSecrets, row.id, !this.visibleSecrets[row.id]);
    },
    maskSensitiveValue(value) {
      if (!value) return "";
      const text = String(value);
      if (text.length <= 8) return "********";
      return `${text.slice(0, 3)}${"*".repeat(Math.min(8, text.length - 6))}${text.slice(-3)}`;
    },
    formatValue(value) {
      if (value === null || value === undefined || value === "") return "-";
      return value;
    },
    formatDate(value) {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return date.toLocaleString();
    },
    activeProvider(type) {
      return (this.providers[type] || []).find(item => item.is_active) || null;
    },
    providerCount(type) {
      return (this.providers[type] || []).length;
    },
    providerRowClassName({ row }) {
      return row && row.is_active ? "active-provider-row" : "";
    },
    openEditDialog(type, row) {
      const fields = this.formFields[type] || [];
      const form = { id: row.id };
      fields.forEach((field) => {
        form[field.prop] = row[field.prop] === null || row[field.prop] === undefined ? "" : row[field.prop];
      });
      this.editType = type;
      this.editForm = form;
      this.dialogVisible = true;
    },
    saveProvider() {
      if (!this.editType || !this.editForm.id) return;
      this.saving = true;
      const payload = { ...this.editForm };
      delete payload.id;

      Api.runtimeProviders.updateProvider(this.editType, this.editForm.id, payload, ({ data }) => {
        this.saving = false;
        if (data.code === 0) {
          this.$message.success({ message: "Update successful", showClose: true });
          this.dialogVisible = false;
          this.fetchProviders();
          return;
        }
        this.$message.error({ message: data.msg || "Update failed", showClose: true });
      });
    },
    activateProvider(type, row) {
      this.$confirm(`Set ${this.providerLabel(type, row)} as active?`, "Set Active Provider", {
        confirmButtonText: "Set Active",
        cancelButtonText: "Cancel"
      }).then(() => {
        Api.runtimeProviders.activateProvider(type, row.id, ({ data }) => {
          if (data.code === 0) {
            this.$message.success({ message: "Active provider updated", showClose: true });
            this.fetchProviders();
            return;
          }
          this.$message.error({ message: data.msg || "Operation failed", showClose: true });
        });
      }).catch(() => {});
    },
    providerLabel(type, row) {
      if (!row) return "No active provider";
      if (type === "llm") return row.model_name || row.model || "provider";
      return row.provider_name || "provider";
    }
  }
};
</script>

<style lang="scss" scoped>
.welcome {
  min-width: 900px;
  min-height: 506px;
  height: 100vh;
  display: flex;
  position: relative;
  flex-direction: column;
  background-size: cover;
  background:
    linear-gradient(180deg, #fff7ec 0, #f7fbff 150px, #f6f8fb 100%);
  overflow: hidden;
}

.operation-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 16px;
  border-bottom: 1px solid rgba(255, 138, 0, 0.12);
}

.page-title {
  font-size: 26px;
  margin: 0;
  color: #16213e;
  line-height: 1.2;
}

.page-subtitle {
  margin-top: 5px;
  color: #556070;
  font-size: 13px;
}

.right-operations {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.btn-search {
  background: linear-gradient(135deg, #ff8a00, #7c5cff);
  border: none;
  color: white;
  border-radius: 6px;
  height: 36px;
  padding: 0 16px;
  box-shadow: 0 8px 18px rgba(124, 92, 255, 0.24);
}

.main-wrapper {
  margin: 0 22px 18px;
  border-radius: 8px;
  min-height: calc(100vh - 170px);
  height: auto;
  max-height: calc(100vh - 128px);
  box-shadow: 0 14px 34px rgba(53, 72, 112, 0.12);
  position: relative;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.content-panel {
  flex: 1;
  display: flex;
  overflow: hidden;
  height: 100%;
  border-radius: 8px;
  background: transparent;
  border: 1px solid #e7ebf3;
}

.content-area {
  flex: 1;
  height: 100%;
  min-width: 600px;
  overflow: auto;
  background-color: #fff;
  display: flex;
  flex-direction: column;
}

.providers-card {
  background: white;
  flex: 1;
  display: flex;
  flex-direction: column;
  border: none;
  box-shadow: none;
  overflow: hidden;

  ::v-deep .el-card__body {
    padding: 0;
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid #e7ebf3;
  background: linear-gradient(180deg, #ffffff, #fbfcff);
}

.summary-item {
  min-width: 0;
  padding: 15px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;

  &.llm {
    background: linear-gradient(135deg, #fff3dd, #fffaf1);
    border-color: #ffd69a;
    color: #a35400;
  }

  &.stt {
    background: linear-gradient(135deg, #e9f7ff, #f7fcff);
    border-color: #a9ddff;
    color: #0d6896;
  }

  &.tts {
    background: linear-gradient(135deg, #f3edff, #fff8ff);
    border-color: #d5c2ff;
    color: #6540b8;
  }

  &:hover {
    transform: translateY(-1px);
  }

  &.current {
    box-shadow: 0 10px 22px rgba(47, 65, 104, 0.14);
  }

  strong {
    display: block;
    margin-top: 8px;
    color: #111827;
    font-size: 15px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    color: #556070;
    font-size: 12px;
  }
}

.summary-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8);
}

.summary-label {
  color: currentColor;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.64);
}

.provider-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;

  ::v-deep .el-tabs__header {
    margin: 0;
    padding: 0 16px;
    background: linear-gradient(90deg, #fff8ef, #f7fbff 45%, #fbf7ff);
  }

  ::v-deep .el-tabs__nav-wrap::after {
    height: 1px;
    background: #e7ebf3;
  }

  ::v-deep .el-tabs__item {
    height: 44px;
    line-height: 44px;
    color: #4b5563;
    font-weight: 600;
  }

  ::v-deep .el-tabs__item.is-active {
    color: #ff7a00;
  }

  ::v-deep .el-tabs__active-bar {
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: linear-gradient(90deg, #ff8a00, #7c5cff);
  }

  ::v-deep .el-tabs__content {
    min-height: 0;
    flex: 1;
    overflow: auto;
  }
}

.transparent-table {
  width: 100%;

  ::v-deep th {
    background: #fbfcff;
    color: #5a6575;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0;
  }

  ::v-deep td {
    color: #293447;
    font-size: 13px;
  }

  ::v-deep .el-table__row {
    height: 54px;
  }

  ::v-deep .active-provider-row {
    background: linear-gradient(90deg, #f0fbeb, #fffaf1);
  }

  ::v-deep .active-provider-row:hover > td {
    background: #f2faed !important;
  }
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #fff0db;
  color: #d76200;
  font-size: 12px;
  font-weight: 700;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border-radius: 13px;
  background: #eef2f7;
  color: #697386;
  font-size: 12px;
  font-weight: 600;

  &.active {
    background: linear-gradient(135deg, #dff8ce, #fff3cc);
    color: #2d7b17;
    box-shadow: 0 4px 10px rgba(45, 123, 23, 0.12);
  }
}

.mono-value,
.secret-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.secret-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}

.secret-value {
  display: inline-block;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2937;
  background: #f6f8fc;
  border: 1px solid #e5e9f2;
  border-radius: 5px;
  padding: 3px 7px;
}

.secret-toggle {
  padding: 0;
  font-weight: 700;
  color: #4f63d9;
}

.action-button {
  border-radius: 5px;
  padding: 6px 9px;
  background: #fff;
  border-color: #dbe3ef;
}

.activate-button:not(.is-disabled) {
  color: #2f7d17;
  border-color: #aee190;
  background: linear-gradient(135deg, #f6ffef, #fffaf0);
}

.provider-form {
  padding-right: 10px;
}

.full-input {
  width: 100%;
}
</style>
