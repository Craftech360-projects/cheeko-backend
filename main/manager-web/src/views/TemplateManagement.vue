<template>
  <div class="template-management">

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <div class="page-head">
            <div>
              <h1 class="page-title">Templates</h1>
              <p class="page-lead">Reusable prompt and memory presets an operator can apply to any agent.</p>
            </div>
            <div class="page-actions">
              <el-button size="small" @click="goToHome">Back to agents</el-button>
              <el-button type="primary" size="small" @click="showAddDialog">New template</el-button>
            </div>
          </div>

          <ListToolbar
            :count="visibleRows.length"
            count-noun="templates"
            :total="visibleRows.length"
            :sort-options="sortOptions"
            :sort-by.sync="sortBy"
            :sort-dir.sync="sortDir"
            :selecting.sync="selecting"
            :selected-count="selectedCount"
            :all-selected="allSelected"
            :search.sync="listSearch"
            search-placeholder="Enter template name"
            @select-all-matching="selectAllMatching"
            @clear-selection="clearSelection"
          >
            <template #bulk>
              <el-button @click="bulkExport">Export</el-button>
            </template>
          </ListToolbar>

          <el-table
            ref="table"
            :data="visibleRows"
            v-loading="loading"
            style="width: 100%"
            size="small"
            :row-class-name="templateRowClass"
            @sort-change="onTableSortChange"
            @selection-change="onSelectionChange"
          >
            <el-table-column v-if="selecting" type="selection" width="44" />
            <el-table-column prop="agentName" label="Name" min-width="150" sortable="custom">
              <template slot-scope="scope"><span class="cell-key">{{ scope.row.agentName }}</span></template>
            </el-table-column>
            <el-table-column prop="language" label="Language" width="120" sortable="custom" />
            <el-table-column label="System Prompt" min-width="220">
              <template slot-scope="scope">
                <span class="truncate-text">{{ truncateText(scope.row.systemPrompt, 80) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="sort" label="Sort" width="80" align="right" sortable="custom" />
            <el-table-column label="Visible" width="70" align="center">
              <template slot-scope="scope">
                <el-tag :type="scope.row.isVisible ? 'success' : 'info'" size="mini">
                  {{ scope.row.isVisible ? 'Yes' : 'No' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Artwork" width="110" align="center">
              <template slot-scope="scope">
                <el-tag v-if="artState(scope.row).complete" type="success" size="mini">
                  v{{ scope.row.artVersion || 1 }}
                </el-tag>
                <el-tag v-else-if="artState(scope.row).partial" type="danger" size="mini">
                  {{ artState(scope.row).present }}/4
                </el-tag>
                <span v-else class="muted-cell">None</span>
              </template>
            </el-table-column>
            <el-table-column label="Actions" width="200" align="center" fixed="right">
              <template slot-scope="scope">
                <el-button type="text" size="mini" @click="handleEdit(scope.row)">
                  Edit
                </el-button>
                <el-button type="text" size="mini" @click="handleArtwork(scope.row)">
                  Artwork
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
      :close-on-click-modal="dismissOnBackdrop"
      @open="markPristine"
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

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="SD Folder" prop="sdFolder">
              <el-input
                v-model="form.sdFolder"
                placeholder="e.g. cheeko — leave blank if this character has no artwork"
                maxlength="8"
                show-word-limit
              />
              <div class="art-hint">
                Where the toy stores this character's four conversation pictures.
                1&ndash;8 lowercase letters or digits. Upload the pictures themselves
                from <strong>Artwork</strong> in the list.
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Agent Code" prop="agentCode">
              <el-input v-model="form.agentCode" placeholder="Optional, no numbers" maxlength="100" />
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

    <!-- Character artwork -->
    <el-dialog
      :title="`Artwork — ${artForm.agentName}`"
      :visible.sync="artDialogVisible"
      width="760px"
      :close-on-click-modal="dismissOnBackdrop"
    >
      <p class="art-lead">
        The four pictures the toy shows while it is connecting, listening, thinking and
        talking. They are drawn over the conversation background, so upload
        <strong>PNGs with a transparent background</strong> — anything opaque arrives on
        the panel as a rectangle. Each is fitted to the 296&times;240 screen with the
        aspect ratio kept.
      </p>

      <el-form label-position="top" size="small">
        <el-form-item>
          <template #label>
            SD folder
            <span class="art-hint">
              the directory the toy stores these in, and the folder they are served from
            </span>
          </template>
          <el-input
            v-model="artForm.sdFolder"
            placeholder="e.g. cheeko"
            maxlength="8"
            show-word-limit
            style="max-width: 260px"
          />
          <div class="art-error" v-if="sdFolderError">{{ sdFolderError }}</div>
          <div class="art-hint" v-else>
            1&ndash;8 lowercase letters or digits. The toy's SD card cannot store a longer
            name and fails silently if given one, so it is refused here instead.
          </div>
        </el-form-item>
      </el-form>

      <div class="art-grid">
        <div v-for="state in artStates" :key="state" class="art-slot">
          <div class="art-slot-head">
            <span class="art-state">{{ state }}</span>
            <el-tag v-if="artForm.staged[state]" type="warning" size="mini">new</el-tag>
          </div>
          <div class="art-preview" :class="{ 'is-empty': !artPreview[state] }">
            <img v-if="artPreview[state]" :src="artPreview[state]" :alt="state" />
            <span v-else-if="artLoading[state]">Loading…</span>
            <span v-else>No picture</span>
          </div>
          <el-button size="mini" @click="pickArtFile(state)">
            {{ artForm.staged[state] ? 'Replace' : 'Choose PNG' }}
          </el-button>
        </div>
      </div>

      <!-- One hidden input reused by all four slots; artPickTarget says which. -->
      <input
        ref="artFileInput"
        type="file"
        accept="image/png"
        style="display: none"
        @change="onArtFileChosen"
      />

      <div slot="footer" class="dialog-footer">
        <div class="footer-left art-version">
          <span v-if="artForm.artVersion">
            Currently v{{ artForm.artVersion }} &middot; saving publishes v{{ artForm.artVersion + 1 }}
          </span>
          <span v-else>Not published yet</span>
        </div>
        <div class="footer-right">
          <el-button size="small" @click="artDialogVisible = false">Cancel</el-button>
          <el-button
            type="primary"
            size="small"
            :loading="artSubmitting"
            :disabled="!artDirty"
            @click="saveArtwork"
          >
            Save
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import dialogDismiss from '@/mixins/dialogDismiss';
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';
import Api from "@/apis/api";
import { loadLvglBinAsDataUrl } from '@/utils/lvglBin';

// The conversation states, in the order the toy moves through them.
const ART_STATES = ['connect', 'listen', 'think', 'talk'];
const SD_FOLDER_PATTERN = /^[a-z0-9]{1,8}$/;

export default {
  mixins: [listControls, dialogDismiss],
  components: { ListToolbar },
  name: 'TemplateManagement',
  data() {
    return {
      // list controls
      sortBy: 'sort',
      sortDir: 'asc',
      sortOptions: [
        { label: 'Sort order', value: 'sort' },
        { label: 'Name', value: 'agentName' },
        { label: 'Language', value: 'language' }
      ],
      searchFields: ['agentName', 'systemPrompt', 'language'],
      templates: [],
      loading: false,
      dialogVisible: false,
      editMode: false,
      editingId: null,
      submitting: false,
      applyToAgents: false,
      form: this.getEmptyForm(),
      // Character artwork
      artStates: ART_STATES,
      artDialogVisible: false,
      artSubmitting: false,
      artPickTarget: null,
      artForm: this.getEmptyArtForm(),
      artPreview: {},   // state -> data/object URL currently shown
      artLoading: {},   // state -> a stored .bin is still being fetched and decoded
      artObjectUrls: [], // object URLs to revoke when the dialog closes
      rules: {
        agentName: [
          { required: true, message: "Please enter template name", trigger: "blur" }
        ],
        language: [
          { required: true, message: "Please select language", trigger: "change" }
        ],
        langCode: [
          { required: true, message: "Please select language code", trigger: "change" }
        ],
        // Same rule the API enforces on create (validation.js agentTemplate).
        agentCode: [
          { pattern: /^[^0-9]*$/, message: 'Agent code must not contain numbers', trigger: 'blur' }
        ],
        // Optional, but wrong is not allowed: the toy's SD card cannot store a
        // longer or upper-case name and fails silently when given one, so it is
        // caught here rather than by the database.
        sdFolder: [
          { pattern: SD_FOLDER_PATTERN, message: 'Only lowercase letters and digits, 1-8 characters', trigger: 'blur' }
        ]
      }
    };
  },
  computed: {
    sourceRows() {
      return this.templates;
    },
    sdFolderError() {
      const folder = (this.artForm.sdFolder || '').trim();
      if (!folder) return '';
      return SD_FOLDER_PATTERN.test(folder)
        ? ''
        : 'Only lowercase letters and digits, 1-8 characters.';
    },
    artDirty() {
      if (this.sdFolderError) return false;
      if (ART_STATES.some(state => this.artForm.staged[state])) return true;
      return (this.artForm.sdFolder || '') !== (this.artForm.originalSdFolder || '');
    }
  },
  watch: {
    // Revoking on close rather than on every change: a slot can be re-picked
    // several times before saving, and each pick makes a URL.
    artDialogVisible(open) {
      if (!open) this.releaseArtObjectUrls();
    }
  },
  beforeDestroy() {
    this.releaseArtObjectUrls();
  },
  methods: {
    templateRowClass({ row }) {
      return this.isSelected(row) ? 'selected-row' : '';
    },
    bulkExport() {
      const rows = this.selectedRows;
      if (!rows.length) {
        this.$message.warning('Nothing to export.');
        return;
      }
      const cols = ['agentName', 'language', 'sort', 'systemPrompt'];
      const escape = value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
      const csv = [cols.join(',')]
        .concat(rows.map(row => cols.map(col => escape(row[col])).join(',')))
        .join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'templates.csv';
      link.click();
      URL.revokeObjectURL(url);
    },
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
        visible: true,
        sdFolder: ""
      };
    },
    getEmptyArtForm() {
      return {
        id: null,
        agentName: '',
        sdFolder: '',
        originalSdFolder: '',
        artVersion: 0,
        urls: {},
        staged: { connect: null, listen: null, think: null, talk: null }
      };
    },

    /** How much of a row's artwork exists — drives the list column. */
    artState(row) {
      const present = ART_STATES.filter(state => row[this.artUrlKey(state)]).length;
      return { present, complete: present === 4, partial: present > 0 && present < 4 };
    },
    artUrlKey(state) {
      return `art${state.charAt(0).toUpperCase()}${state.slice(1)}Url`;
    },

    handleArtwork(row) {
      this.releaseArtObjectUrls();
      this.artForm = {
        ...this.getEmptyArtForm(),
        id: row.id,
        agentName: row.agentName || '',
        sdFolder: row.sdFolder || '',
        originalSdFolder: row.sdFolder || '',
        artVersion: row.artVersion || 0,
        urls: ART_STATES.reduce((acc, state) => {
          acc[state] = row[this.artUrlKey(state)] || null;
          return acc;
        }, {})
      };
      this.artPreview = {};
      this.artLoading = {};
      this.artDialogVisible = true;

      // Stored sprites are LVGL binaries, not web images — each has to be
      // fetched and decoded to a canvas before it can go in an <img>.
      ART_STATES.forEach((state) => {
        const url = this.artForm.urls[state];
        if (!url) return;
        this.$set(this.artLoading, state, true);
        loadLvglBinAsDataUrl(url).then((dataUrl) => {
          this.$set(this.artLoading, state, false);
          if (dataUrl) this.$set(this.artPreview, state, dataUrl);
        });
      });
    },

    pickArtFile(state) {
      this.artPickTarget = state;
      // Clearing first so re-picking the same file still fires `change`.
      this.$refs.artFileInput.value = '';
      this.$refs.artFileInput.click();
    },

    onArtFileChosen(event) {
      const file = event.target.files && event.target.files[0];
      const state = this.artPickTarget;
      if (!file || !state) return;

      if (file.type !== 'image/png') {
        this.$message.error('Character sprites must be PNG — transparency is required.');
        return;
      }

      this.$set(this.artForm.staged, state, file);
      const objectUrl = URL.createObjectURL(file);
      this.artObjectUrls.push(objectUrl);
      this.$set(this.artPreview, state, objectUrl);
      this.$set(this.artLoading, state, false);
    },

    releaseArtObjectUrls() {
      this.artObjectUrls.forEach(url => URL.revokeObjectURL(url));
      this.artObjectUrls = [];
    },

    /**
     * Save the folder name, then the pictures.
     *
     * Order matters and is not interchangeable: the folder is the path the
     * sprites are stored under, so uploading first would either fail or write
     * to the old prefix. The upload is skipped entirely when only the folder
     * changed, which is what lets an operator name a character before they have
     * any artwork for it.
     */
    saveArtwork() {
      if (this.sdFolderError) return;
      this.artSubmitting = true;

      const staged = ART_STATES.filter(state => this.artForm.staged[state]);
      const folderChanged =
        (this.artForm.sdFolder || '') !== (this.artForm.originalSdFolder || '');

      const uploadStaged = () => {
        if (!staged.length) {
          this.artSubmitting = false;
          this.artDialogVisible = false;
          this.fetchTemplates();
          this.$message.success('SD folder saved');
          return;
        }

        const body = new FormData();
        staged.forEach(state => body.append(state, this.artForm.staged[state]));

        Api.agent.uploadTemplateArt(this.artForm.id, body, ({ data: res }) => {
          this.artSubmitting = false;
          if (res.code === 0) {
            this.artDialogVisible = false;
            this.fetchTemplates();
            this.$message.success(
              `Artwork published as v${res.data?.artVersion} — devices will download it on the next tap`
            );
          } else {
            // The all-four-or-nothing refusal lands here, and its message names
            // the states still missing. Keep the dialog open so the operator can
            // add them without re-picking what they already chose.
            this.$message.error(res.msg || 'Failed to upload artwork');
          }
        }, () => {
          this.artSubmitting = false;
          this.$message.error('Artwork upload failed — nothing was changed.');
        });
      };

      if (!folderChanged) {
        uploadStaged();
        return;
      }

      Api.agent.updateAgentTemplate(
        this.artForm.id,
        { sdFolder: this.artForm.sdFolder || '' },
        ({ data: res }) => {
          if (res.code !== 0) {
            this.artSubmitting = false;
            this.$message.error(res.msg || 'Failed to save the SD folder');
            return;
          }
          this.artForm.originalSdFolder = this.artForm.sdFolder;
          uploadStaged();
        }
      );
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
        visible: row.isVisible === 1 || row.isVisible === true,
        sdFolder: row.sdFolder || ""
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
  height: auto;
  display: flex;
  flex-direction: column;
  background: $surface;
  overflow: hidden;
}

.main-wrapper {
  flex: 1;
  margin: 12px;
  margin-top: 8px;
  border-radius: 16px;
  box-shadow: none;
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
  background: $surface;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: none;

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
  background: $surface;
  margin-bottom: 12px;
}

.truncate-text {
  color: #666;
  font-size: 12px;
}

.delete-btn {
  color: $danger !important;
}

.muted-cell {
  color: $text-light;
  font-size: 12px;
}

/* ── Character artwork dialog ── */

.art-lead {
  margin: 0 0 16px;
  color: $text-body;
  font-size: 13px;
  line-height: 1.5;
}

.art-hint {
  display: block;
  margin-top: 4px;
  color: $text-light;
  font-size: 12px;
  font-weight: normal;
  line-height: 1.4;
}

.art-error {
  margin-top: 4px;
  color: $danger;
  font-size: 12px;
}

.art-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.art-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.art-slot-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.art-state {
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
  color: $text-dark;
}

/* Checkerboard, so a transparent sprite reads as transparent rather than as a
   picture that happens to be on a white card. */
.art-preview {
  width: 100%;
  aspect-ratio: 296 / 240;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid $border-color;
  border-radius: 8px;
  overflow: hidden;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #e8e8e8 25%, transparent 25%, transparent 75%, #e8e8e8 75%),
    linear-gradient(45deg, #e8e8e8 25%, transparent 25%, transparent 75%, #e8e8e8 75%);
  background-size: 12px 12px;
  background-position: 0 0, 6px 6px;

  img {
    max-width: 100%;
    max-height: 100%;
    display: block;
  }

  &.is-empty {
    color: $text-light;
    font-size: 12px;
  }
}

.art-version {
  color: $text-light;
  font-size: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: $text-light;

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
    color: $text-body;
  }
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .footer-left {
    font-size: 12px;
    color: $text-body;
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
    background: $surface-sunk !important;
    color: $text-body;
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
