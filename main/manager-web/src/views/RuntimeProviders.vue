<template>
  <div class="welcome">

    <div class="page-head">
      <div>
        <h1 class="page-title">Runtime Providers</h1>
        <p class="page-lead">The LLM, STT and TTS vendors the agent falls through, in priority order.</p>
      </div>
      <div class="page-actions">
        <div class="runtime-health">
          <span class="health-dot"></span>
          {{ activeServicesCount }}/{{ providerTypes.length }} active
        </div>
        <el-button size="small" :loading="loading" @click="fetchProviders">Refresh</el-button>
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
                <ListToolbar
                  :count="(providers[type.value] || []).length"
                  count-noun="providers"
                  :total="(providers[type.value] || []).length"
                  :sort-options="sortOptions"
                  :sort-by.sync="sortBy"
                  :sort-dir.sync="sortDir"
                  :selecting.sync="selecting"
                  :selected-count="selectedCount"
                  :all-selected="allSelected"
                  :search.sync="listSearch"
                  search-placeholder="Provider or model"
                  @select-all-matching="selectAllMatching"
                  @clear-selection="clearSelection"
                >
                  <template #bulk>
                    <el-button @click="bulkTest">Test</el-button>
                  </template>
                </ListToolbar>

                <el-table
                  ref="table"
                  :data="visibleProviders(type.value)"
                  class="transparent-table"
                  :row-class-name="providerRowClassName"
                  empty-text="No providers configured"
                  v-loading="loading"
                  @sort-change="onTableSortChange"
                  @selection-change="onSelectionChange"
                  element-loading-text="Loading..."
                  element-loading-spinner="el-icon-loading"
                  element-loading-background="rgba(250, 249, 247, 0.75)"
                  >
                  <el-table-column v-if="selecting" type="selection" width="44" />
                  <el-table-column label="Status" prop="is_active" align="left" width="120" sortable="custom">
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
      :close-on-click-modal="dismissOnBackdrop"
      @open="markPristine"
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
import dialogDismiss from '@/mixins/dialogDismiss';
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';
import Api from "@/apis/api";
import VersionFooter from "@/components/VersionFooter.vue";

export default {
  name: 'RuntimeProviders',
  mixins: [listControls, dialogDismiss],
  components: { ListToolbar, VersionFooter },
  data() {
    return {
      // list controls
      sortBy: 'priority',
      sortDir: 'asc',
      sortOptions: [
        { label: 'Priority', value: 'priority' },
        { label: 'Status', value: 'is_active' },
        { label: 'Provider', value: 'provider_name' },
        { label: 'Updated', value: 'updated_at' }
      ],
      searchFields: ['provider_name', 'model_name', 'model'],
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
        tts: [],
        moderation: [],
        image: []
      },
      providerTypes: [
        { value: "llm", label: "LLM", caption: "Reasoning model", icon: "el-icon-cpu" },
        { value: "stt", label: "STT", caption: "Speech to text", icon: "el-icon-microphone" },
        { value: "tts", label: "TTS", caption: "Voice output", icon: "el-icon-headset" },
        { value: "moderation", label: "Moderation", caption: "Content safety", icon: "el-icon-umbrella" },
        { value: "image", label: "Image", caption: "AI Imagine generation", icon: "el-icon-picture-outline" }
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
        ],
        moderation: [
          { label: "Provider", prop: "provider_name", mono: true },
          { label: "Model", prop: "model", mono: true },
          { label: "API Key", prop: "api_key", secret: true }
        ],
        image: [
          { label: "Provider", prop: "provider_name", mono: true },
          { label: "Model", prop: "model", mono: true },
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
        ],
        moderation: [
          { label: "Provider", prop: "provider_name" },
          { label: "Model", prop: "model" },
          { label: "API Key", prop: "api_key", secret: true },
          { label: "Priority", prop: "priority", type: "number", min: 0 }
        ],
        image: [
          { label: "Provider", prop: "provider_name" },
          { label: "Model", prop: "model" },
          { label: "API Key", prop: "api_key", secret: true },
          { label: "Priority", prop: "priority", type: "number", min: 0 }
        ]
      }
    };
  },
  computed: {
    sourceRows() {
      return this.providers[this.activeType] || [];
    },
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
    dirtyState() {
      return this.editForm;
    },

    // Sort/search the visible type's providers through the shared mixin
    visibleProviders(type) {
      const rows = (this.providers[type] || []).slice();
      const q = (this.listSearch || '').trim().toLowerCase();
      const filtered = !q ? rows : rows.filter(row => this.searchFields.some(field => {
        const value = row[field];
        return value !== null && value !== undefined && String(value).toLowerCase().includes(q);
      }));
      if (this.sortBy) {
        filtered.sort((a, b) => this.compareRows(a, b, this.sortBy, this.sortDir));
      }
      return filtered;
    },
    bulkTest() {
      const rows = this.selectedRows;
      if (!rows.length) return;
      this.$message.info(`Testing ${rows.length} provider${rows.length === 1 ? '' : 's'}…`);
    },
    fetchProviders() {
      this.loading = true;
      Api.runtimeProviders.getProviders(({ data }) => {
        this.loading = false;
        if (data.code === 0) {
          this.providers = {
            llm: (data.data.llm || []).map(this.withUiState),
            stt: (data.data.stt || []).map(this.withUiState),
            tts: (data.data.tts || []).map(this.withUiState),
            moderation: (data.data.moderation || []).map(this.withUiState),
            image: (data.data.image || []).map(this.withUiState)
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
      if (type === "moderation" || type === "image") return provider.model || provider.provider_name || "Configured";
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
@import '@/styles/theme.scss';

// Warm monochrome, one accent, structure from 1px rules. The five provider
// types are distinguished by their name, not by five different hues.
.welcome {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
}

.runtime-health {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $surface;
  font-family: $font-mono;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: $text-gray;
}

.health-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: $success;
}

.main-wrapper {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.content-panel {
  flex: 1;
  display: flex;
  overflow: hidden;
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
}

.content-area {
  flex: 1;
  min-width: 600px;
  overflow-x: auto;
  display: flex;
  flex-direction: column;
}

.providers-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
  overflow: hidden;

  ::v-deep .el-card__body {
    padding: 0;
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
}

// ---------- Summary strip -------------------------------------------------
.summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 1px;
  background: $divider-color;
  border-bottom: 1px solid $border-color;
}

.summary-item {
  min-width: 0;
  padding: 18px 20px;
  background: $surface;
  cursor: pointer;
  transition: background-color 0.18s ease;

  &:hover {
    background: $surface-sunk;
  }

  &:focus {
    outline: none;
    background: $surface-sunk;
  }

  // The selected type is marked by a rule, not by a colour: five tinted
  // cards would put four more hues into a one-accent system.
  &.current {
    background: $row-selected;
    box-shadow: inset 2px 0 0 $primary;
  }

  strong {
    display: block;
    font-size: 14px;
    font-weight: 590;
    letter-spacing: -0.01em;
    color: $text-dark;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.summary-top {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 14px;
}

.summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-top: 1px;
  font-size: 13px;
  color: $text-light;
}

.summary-label {
  display: block;
  font-family: $font-mono;
  font-size: 9.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: $text-light;
}

.summary-caption {
  display: block;
  margin-top: 3px;
  font-size: 11.5px;
  color: $text-light;
}

.summary-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.summary-status {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: $font-mono;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: $text-light;
  white-space: nowrap;

  &.online { color: $success; }
}

.summary-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  font-family: $font-mono;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: $text-light;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.live-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 5px;
  border-radius: 50%;
  background: $text-light;
}

// ---------- Tabs ----------------------------------------------------------
.provider-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;

  ::v-deep .el-tabs__header {
    margin: 0;
    padding: 0 22px;
  }

  ::v-deep .el-tabs__content {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 0 22px 4px;
  }
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.tab-count {
  font-family: $font-mono;
  font-size: 9.5px;
  color: $text-light;
}

.transparent-table {
  width: 100%;

  // The live provider for this type, tinted green because "active" here is a
  // status, not a selection. One row per tab carries it.
  ::v-deep .active-provider-row > td.el-table__cell {
    background: $success-bg;
  }

  ::v-deep .active-provider-row:hover > td.el-table__cell {
    background: darken($success-bg, 3%);
  }
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: $font-mono;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: $text-light;

  &.active { color: $success; }
}

.mono-value,
.secret-value {
  font-family: $font-mono;
  font-size: 11.5px;
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
  color: $text-body;
  background: $surface-sunk;
  border: 1px solid $divider-color;
  border-radius: $radius-sm;
  padding: 3px 7px;
}

.secret-toggle {
  min-width: 40px;
  padding: 0 4px;
  font-size: 11.5px;
  color: $text-light;

  &:hover { color: $text-dark; }
}

.action-button {
  min-height: 28px;
}

.table-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0 14px;
  border-top: 1px solid $divider-color;
  font-family: $font-mono;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: $text-light;
}

.provider-form {
  padding-right: 10px;
}

.full-input {
  width: 100%;
}

@media (max-width: 1180px) {
  .content-area {
    min-width: 0;
  }

  .summary-strip {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .summary-item {
    transition: none;
  }
}
</style>
