<template>
  <div class="welcome">
    <HeaderBar />

    <div class="operation-bar">
      <div class="title-block">
        <span class="eyebrow">Voice Runtime Control</span>
        <h2 class="page-title">Runtime Providers</h2>
        <div class="page-subtitle">Manage active LLM, STT, and TTS services used by the voice runtime.</div>
      </div>
      <div class="right-operations">
        <div class="runtime-health">
          <span class="health-dot"></span>
          {{ activeServicesCount }}/3 services active
        </div>
        <el-button class="btn-search" icon="el-icon-refresh" :loading="loading" @click="fetchProviders">Refresh</el-button>
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
                role="button"
                tabindex="0"
                @click="activeType = type.value"
                @keyup.enter="activeType = type.value"
                @keydown.space.prevent="activeType = type.value"
              >
                <div class="summary-top">
                  <span class="summary-icon"><i :class="type.icon"></i></span>
                  <span>
                    <span class="summary-label">{{ type.label }}</span>
                    <span class="summary-caption">{{ type.caption }}</span>
                  </span>
                </div>
                <div class="summary-main">
                  <strong>{{ providerLabel(type.value, activeProvider(type.value)) }}</strong>
                  <span class="summary-status" :class="{ online: activeProvider(type.value) }">
                    <i :class="activeProvider(type.value) ? 'el-icon-success' : 'el-icon-warning-outline'"></i>
                    {{ activeProvider(type.value) ? 'Live' : 'Not set' }}
                  </span>
                </div>
                <div class="summary-meta">
                  <span>
                    <span class="live-dot"></span>
                    {{ providerCount(type.value) }} configured
                  </span>
                  <span>{{ activeProviderMeta(type.value) }}</span>
                </div>
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
                  empty-text="No providers configured"
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

                <div class="table-footer">
                  <span>{{ providerCount(type.value) }} {{ type.label }} provider{{ providerCount(type.value) === 1 ? '' : 's' }}</span>
                  <span>Active: {{ providerLabel(type.value, activeProvider(type.value)) }}</span>
                </div>
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
        { value: "llm", label: "LLM", caption: "Reasoning model", icon: "el-icon-cpu" },
        { value: "stt", label: "STT", caption: "Speech to text", icon: "el-icon-microphone" },
        { value: "tts", label: "TTS", caption: "Voice output", icon: "el-icon-headset" }
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
    activeServicesCount() {
      return this.providerTypes.filter(type => this.activeProvider(type.value)).length;
    },
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
    activeProviderMeta(type) {
      const provider = this.activeProvider(type);
      if (!provider) return "Needs activation";
      if (type === "llm") return provider.model || "Model configured";
      if (type === "stt") return provider.model || provider.language || "STT configured";
      return provider.model_id || provider.voice_id || "Voice configured";
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
  min-height: 100vh;
  display: flex;
  position: relative;
  flex-direction: column;
  background-size: cover;
  background:
    radial-gradient(circle at 12% 0%, rgba(217, 119, 6, 0.13), transparent 30%),
    radial-gradient(circle at 88% 10%, rgba(59, 130, 246, 0.16), transparent 32%),
    linear-gradient(180deg, #fffaf2 0, #f8fbff 190px, #f3f6fb 100%);
  overflow-x: hidden;
}

.operation-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 18px 24px 16px;
  border-bottom: 1px solid rgba(30, 64, 175, 0.08);
}

.title-block {
  min-width: 0;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: #dbeafe;
  color: #1e40af;
  font-size: 11px;
  font-weight: 800;
}

.page-title {
  display: block;
  font-size: 28px;
  margin: 6px 0 0;
  color: #0f172a;
  line-height: 1.2;
  background: linear-gradient(90deg, #0f172a, #1e40af 55%, #d97706);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.page-subtitle {
  margin-top: 6px;
  color: #475569;
  font-size: 13px;
}

.right-operations {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.runtime-health {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  color: #1e3a8a;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 22px rgba(30, 64, 175, 0.08);
}

.health-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.15);
}

.btn-search {
  min-width: 104px;
  background: linear-gradient(135deg, #1e40af, #3b82f6 55%, #d97706);
  border: none;
  color: white;
  border-radius: 8px;
  height: 36px;
  padding: 0 16px;
  box-shadow: 0 10px 22px rgba(30, 64, 175, 0.24);

  &:focus {
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.28), 0 10px 22px rgba(30, 64, 175, 0.24);
  }
}

.main-wrapper {
  margin: 0 22px 18px;
  border-radius: 10px;
  min-height: 0;
  height: auto;
  max-height: none;
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
  height: auto;
  border-radius: 10px;
  background: transparent;
  border: 1px solid #dbeafe;
}

.content-area {
  flex: 1;
  height: auto;
  min-width: 600px;
  overflow-x: auto;
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
  gap: 14px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid #dbeafe;
  background:
    linear-gradient(90deg, rgba(30, 64, 175, 0.04), rgba(217, 119, 6, 0.04)),
    #ffffff;
}

.summary-item {
  min-width: 0;
  padding: 16px;
  border: 1px solid;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;

  &::after {
    content: "";
    position: absolute;
    right: -28px;
    top: -36px;
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.08;
  }

  &.llm {
    background: linear-gradient(135deg, #fff7ed, #ffffff);
    border-color: #fed7aa;
    color: #c2410c;
  }

  &.stt {
    background: linear-gradient(135deg, #eff6ff, #ffffff);
    border-color: #bfdbfe;
    color: #1d4ed8;
  }

  &.tts {
    background: linear-gradient(135deg, #f5f3ff, #ffffff);
    border-color: #ddd6fe;
    color: #6d28d9;
  }

  &:hover {
    transform: translateY(-1px);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.28);
  }

  &.current {
    box-shadow: 0 14px 28px rgba(30, 64, 175, 0.14);
    border-color: currentColor;
  }

  &.current:focus {
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.28), 0 14px 28px rgba(30, 64, 175, 0.14);
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
}

.summary-main {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.summary-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;

  &.online {
    background: rgba(34, 197, 94, 0.15);
    color: #15803d;
  }
}

.summary-meta {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  color: #475569;
  font-size: 12px;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8), 0 6px 14px rgba(15, 23, 42, 0.08);
}

.summary-label {
  display: block;
  color: currentColor;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
}

.summary-caption {
  display: block;
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
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
    background: #f8fafc;
  }

  ::v-deep .el-tabs__nav-wrap::after {
    height: 1px;
    background: #e7ebf3;
  }

  ::v-deep .el-tabs__item {
    height: 46px;
    line-height: 46px;
    color: #4b5563;
    font-weight: 800;
  }

  ::v-deep .el-tabs__item.is-active {
    color: #1e40af;
  }

  ::v-deep .el-tabs__active-bar {
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: linear-gradient(90deg, #1e40af, #3b82f6, #d97706);
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
    background: #f8fafc;
    color: #475569;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
  }

  ::v-deep td {
    color: #0f172a;
    font-size: 13px;
    border-bottom-color: #e2e8f0;
  }

  ::v-deep .el-table__row {
    height: 56px;
    transition: background-color 0.18s ease;
  }

  ::v-deep .el-table__row:hover > td {
    background: #eff6ff !important;
  }

  ::v-deep .active-provider-row {
    background: linear-gradient(90deg, #ecfdf5, #fffbeb);
  }

  ::v-deep .active-provider-row:hover > td {
    background: #ecfdf5 !important;
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
  background: #dbeafe;
  color: #1e40af;
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
  background: #f1f5f9;
  color: #475569;
  font-size: 12px;
  font-weight: 600;

  &.active {
    background: linear-gradient(135deg, #dcfce7, #fef3c7);
    color: #166534;
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
  background: #f8fafc;
  border: 1px solid #dbeafe;
  border-radius: 7px;
  padding: 5px 8px;
}

.secret-toggle {
  min-width: 44px;
  padding: 0 6px;
  font-weight: 700;
  color: #1d4ed8;
}

.action-button {
  border-radius: 5px;
  min-height: 32px;
  padding: 7px 10px;
  background: #fff;
  border-color: #cbd5e1;

  &:hover,
  &:focus {
    color: #1e40af;
    border-color: #93c5fd;
    background: #eff6ff;
  }

  &:active {
    transform: translateY(1px);
  }

  &.is-disabled {
    opacity: 0.52;
    cursor: not-allowed;
  }
}

.activate-button:not(.is-disabled) {
  color: #166534;
  border-color: #86efac;
  background: linear-gradient(135deg, #f0fdf4, #fffbeb);
}

.table-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.provider-form {
  padding-right: 10px;
}

.full-input {
  width: 100%;
}

@media (max-width: 1180px) {
  .operation-bar {
    align-items: flex-start;
    flex-direction: column;
  }

  .right-operations {
    width: 100%;
    justify-content: space-between;
  }

  .summary-strip {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .summary-item,
  .transparent-table ::v-deep .el-table__row,
  .action-button {
    transition: none;
  }

  .summary-item:hover,
  .action-button:active {
    transform: none;
  }
}
</style>
