<template>
  <div class="kid-profiles-container">
    <div class="main-content">
      <div class="page-head">
        <div>
          <h1 class="page-title">Kid Profiles</h1>
          <p class="page-lead">
            Age, language and interests — the fields the agent uses to personalise every session.
            <span v-if="globalMode">Open a child to see their toys.</span>
            <span v-if="macAddress" class="mono">· {{ macAddress }}</span>
            <span v-if="isAdminMode" class="chip accent">Admin mode</span>
          </p>
        </div>
        <div class="page-actions">
          <el-button v-if="!globalMode" size="small" @click="goBack">Back</el-button>
          <!-- Creating a child needs a parent to attach it to, which the
               system-wide roster does not have. -->
          <el-button v-if="userId" size="small" type="primary" @click="showAddDialog">Add child</el-button>
        </div>
      </div>

      <ListToolbar
        :count="visibleRows.length"
        count-noun="children"
        :total="globalMode ? total : kidProfiles.length"
        :sort-options="sortOptions"
        :sort-by.sync="sortBy"
        :sort-dir.sync="sortDir"
        :group-options="groupOptions"
        :group-by.sync="groupBy"
        :views="views"
        :view.sync="view"
        :selecting.sync="selecting"
        :selected-count="selectedCount"
        :all-selected="allSelected"
        :search.sync="listSearch"
        search-placeholder="Enter name or nickname"
        @select-all-matching="selectAllMatching"
        @clear-selection="clearSelection"
      >
        <template #filters>
          <el-select v-model="filterLanguage" size="mini" placeholder="Language" clearable class="lb-filter">
            <el-option v-for="lang in languageOptions" :key="lang.value" :label="lang.label" :value="lang.value" />
          </el-select>
        </template>
        <template #bulk>
          <el-button v-if="deviceId" @click="bulkAssign">Assign toy</el-button>
          <el-button @click="bulkExport">Export</el-button>
          <el-button type="danger" @click="bulkDelete">Delete</el-button>
        </template>
      </ListToolbar>

      <div v-if="view === 'cards'" class="kid-cards">
        <div
          v-for="row in visibleRows"
          :key="row.id"
          class="mini-card"
          :class="{ on: isSelected(row), tappable: globalMode }"
          @click="openKid(row)"
        >
          <div class="mini-top">
            <div>
              <el-checkbox v-if="selecting" :value="isSelected(row)" @change="toggleRow(row)" />
              <span class="mini-name">{{ row.name }}</span>
              <div class="mini-sub">{{ row.nickname || 'No nickname' }} · {{ row.language || '—' }}</div>
            </div>
            <span v-if="globalMode" class="chip" :class="deviceLabel(row) === 'No toy' ? '' : 'ok'">{{ deviceLabel(row) }}</span>
          <span v-else class="chip" :class="isAssigned(row.id) ? 'ok' : ''">{{ isAssigned(row.id) ? 'Assigned' : 'Unassigned' }}</span>
          </div>
          <div class="mini-interests">
            <span v-for="interest in (row.interests || [])" :key="interest" class="chip">{{ interest }}</span>
            <span v-if="!(row.interests || []).length" class="muted">No interests recorded</span>
          </div>
          <div class="mini-stats">
            <div>Age<b>{{ calculateAge(row.birth_date || row.birthDate) }}</b></div>
            <div>Gender<b>{{ row.gender || '—' }}</b></div>
            <div v-if="globalMode">Parent<b>{{ row.parent_name || '—' }}</b></div>
          </div>
        </div>
        <div v-if="!visibleRows.length && !loading" class="card ds-empty">
          <b>No kid profiles yet.</b>Add one to personalise this toy.
        </div>
      </div>

      <div v-else class="card pad0">
        <el-table
          ref="table"
          :data="visibleRows"
          v-loading="loading"
          :row-class-name="kidRowClass"
          style="width: 100%"
          @sort-change="onTableSortChange"
          @selection-change="onSelectionChange"
          @row-click="openKid"
        >
          <el-table-column v-if="selecting" type="selection" width="44" />
          <el-table-column prop="name" label="Name" min-width="170" sortable="custom">
            <template slot-scope="scope">
              <div class="rowid">
                <span class="rowid-mark accent">{{ initials(scope.row.name) }}</span>
                <span class="cell-key">{{ scope.row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="nickname" label="Nickname" min-width="120">
            <template slot-scope="scope">{{ scope.row.nickname || '—' }}</template>
          </el-table-column>
          <el-table-column label="Birth date" min-width="120" prop="birth_date" sortable="custom">
            <template slot-scope="scope">
              <span class="mono">{{ birthDateValue(scope.row) || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Age" width="80" align="right" prop="_age" sortable="custom">
            <template slot-scope="scope">{{ calculateAge(scope.row.birth_date || scope.row.birthDate) }}</template>
          </el-table-column>
          <el-table-column prop="gender" label="Gender" width="100" sortable="custom">
            <template slot-scope="scope">{{ scope.row.gender || '—' }}</template>
          </el-table-column>
          <el-table-column prop="language" label="Language" width="110" sortable="custom">
            <template slot-scope="scope">{{ scope.row.language || '—' }}</template>
          </el-table-column>
          <el-table-column label="Interests" min-width="220">
            <template slot-scope="scope">
              <span v-for="interest in (scope.row.interests || [])" :key="interest" class="chip interest-chip">{{ interest }}</span>
              <span v-if="!(scope.row.interests || []).length" class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column v-if="globalMode" label="Parent" prop="parent_name" min-width="150" sortable="custom">
            <template slot-scope="scope">{{ scope.row.parent_name || '—' }}</template>
          </el-table-column>
          <el-table-column v-if="globalMode" label="Toys" min-width="150">
            <template slot-scope="scope">
              <span class="chip" :class="deviceLabel(scope.row) === 'No toy' ? '' : 'ok'">{{ deviceLabel(scope.row) }}</span>
            </template>
          </el-table-column>
          <el-table-column v-else label="Assigned" width="110">
            <template slot-scope="scope">
              <span class="chip" :class="isAssigned(scope.row.id) ? 'ok' : ''">
                {{ isAssigned(scope.row.id) ? 'Yes' : 'No' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="Actions" width="190" align="right">
            <template slot-scope="scope">
              <div class="row-actions">
                <el-button type="text" @click="handleEdit(scope.row)">Edit</el-button>
                <el-button v-if="deviceId" type="text" @click="handleAssign(scope.row)">
                  {{ isAssigned(scope.row.id) ? 'Unassign' : 'Assign' }}
                </el-button>
                <el-button type="text" class="delete-btn" @click="handleDelete(scope.row)">Delete</el-button>
              </div>
            </template>
          </el-table-column>
          <template slot="empty">
            <div class="ds-empty"><b>No kid profiles yet.</b>Add one to personalise this toy.</div>
          </template>
        </el-table>
      </div>

      <!-- Shared by both views, so paging survives the card layout -->
      <div class="card pad0 list-footer-card">
        <div class="list-footer">
          <span>{{ footerLabel }}</span>
          <el-pagination
            v-if="globalMode"
            layout="prev, pager, next"
            :total="total"
            :page-size="limit"
            :current-page.sync="page"
            @current-change="onPageChange"
          />
        </div>
      </div>
    </div>

    <!-- Add/Edit Dialog -->
    <el-dialog
      :close-on-click-modal="dismissOnBackdrop"
      @open="markPristine" :title="editMode ? 'Edit Kid Profile' : 'Add Kid Profile'" :visible.sync="dialogVisible" width="500px">
      <el-form :model="form" :rules="rules" ref="kidForm" label-width="100px">
        <el-form-item label="Name" prop="name">
          <el-input v-model="form.name" placeholder="Enter name" />
        </el-form-item>
        <el-form-item label="Nickname">
          <el-input v-model="form.nickname" placeholder="Enter nickname (optional)" />
        </el-form-item>
        <el-form-item label="Birth Date" prop="birthDate">
          <el-date-picker v-model="form.birthDate" type="date" placeholder="Select date" format="yyyy-MM-dd" value-format="yyyy-MM-dd" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="Gender">
          <el-select v-model="form.gender" placeholder="Select gender" style="width: 100%;">
            <el-option label="Male" value="male" />
            <el-option label="Female" value="female" />
            <el-option label="Other" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="Interests">
          <el-select v-model="form.interests" multiple placeholder="Select interests" style="width: 100%;">
            <el-option label="Science" value="science" />
            <el-option label="Math" value="math" />
            <el-option label="Art" value="art" />
            <el-option label="Music" value="music" />
            <el-option label="Sports" value="sports" />
            <el-option label="Reading" value="reading" />
            <el-option label="Animals" value="animals" />
            <el-option label="Space" value="space" />
            <el-option label="Robots" value="robots" />
            <el-option label="Nature" value="nature" />
          </el-select>
        </el-form-item>
        <el-form-item label="Language">
          <el-select v-model="form.language" placeholder="Select language" style="width: 100%;">
            <el-option label="English" value="en" />
            <el-option label="Hindi" value="hi" />
            <el-option label="Spanish" value="es" />
            <el-option label="French" value="fr" />
            <el-option label="German" value="de" />
            <el-option label="Chinese" value="zh" />
          </el-select>
        </el-form-item>
        <el-form-item label="Parent Rules">
          <el-input
            v-model="form.parent_rule"
            type="textarea"
            :rows="3"
            :maxlength="500"
            show-word-limit
            placeholder="Optional custom instructions for this child, e.g. 'Bedtime is 8pm. Encourage reading.' Cheeko's safety rules always take priority over these."
          />
          <div style="font-size: 12px; color: #A8A199; line-height: 1.4; margin-top: 4px;">
            These guide your child's character but can never override Cheeko's built-in safety rules.
          </div>
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false">Cancel</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          {{ editMode ? 'Update' : 'Create' }}
        </el-button>
      </span>
    </el-dialog>

    <version-footer />
  </div>
</template>

<script>
import dialogDismiss from '@/mixins/dialogDismiss';
import Api from '@/apis/api'
import VersionFooter from '@/components/VersionFooter.vue'
import ListToolbar from '@/components/ListToolbar.vue'
import listControls from '@/mixins/listControls'

export default {
  name: 'KidProfiles',
  components: { VersionFooter, ListToolbar },
  mixins: [listControls, dialogDismiss],
  data() {
    return {
      loading: false,
      // list controls
      sortBy: 'name',
      sortDir: 'asc',
      sortOptions: [
        { label: 'Name', value: 'name' },
        { label: 'Age', value: '_age' },
        { label: 'Birth date', value: 'birth_date' },
        { label: 'Language', value: 'language' },
        { label: 'Gender', value: 'gender' }
      ],
      groupOptions: [
        { label: 'None', value: '' },
        { label: 'Language', value: 'language' },
        { label: 'Gender', value: 'gender' }
      ],
      views: [
        { label: 'Table', value: 'table' },
        { label: 'Cards', value: 'cards' }
      ],
      view: 'cards',
      searchFields: ['name', 'nickname'],
      filterLanguage: '',
      languageOptions: [
        { label: 'English', value: 'en' },
        { label: 'Hindi', value: 'hi' },
        // Present in live data; without an option here the filter silently
        // hides every Kannada-speaking child.
        { label: 'Kannada', value: 'kn' },
        { label: 'Spanish', value: 'es' },
        { label: 'French', value: 'fr' },
        { label: 'German', value: 'de' },
        { label: 'Chinese', value: 'zh' }
      ],
      // Opened with no family/device context: the page becomes a roster of
      // every child in the system, paged server-side like Family 360.
      globalMode: false,
      page: 1,
      limit: 50,
      total: 0,
      submitting: false,
      kidProfiles: [],
      dialogVisible: false,
      editMode: false,
      editingId: null,
      deviceId: null,
      macAddress: '',
      assignedKidId: null,
      userId: null, // If set, we're viewing another user's profiles (admin mode)
      form: {
        name: '',
        nickname: '',
        birthDate: '',
        gender: '',
        interests: [],
        language: 'en',
        parent_rule: ''
      },
      rules: {
        name: [{ required: true, message: 'Please enter name', trigger: 'blur' }]
      }
    }
  },
  computed: {
    isAdminMode() {
      return !!this.userId || this.globalMode
    },
    footerLabel() {
      const shown = this.visibleRows.length
      if (!this.globalMode) return `Showing ${shown} of ${this.kidProfiles.length} children`
      return `Showing ${shown} of ${this.total} child${this.total === 1 ? '' : 'ren'}`
    },
    // The mixin sorts and searches whatever this returns. `_age` is derived so
    // the Age column can sort numerically rather than on the raw date string.
    sourceRows() {
      const rows = this.kidProfiles.map(row => ({
        ...row,
        _age: this.ageValue(row.birth_date || row.birthDate)
      }));
      if (!this.filterLanguage) return rows;
      return rows.filter(row => row.language === this.filterLanguage);
    }
  },
  created() {
    this.deviceId = this.$route.query.deviceId
    this.macAddress = this.$route.query.macAddress || ''
    this.assignedKidId = this.$route.query.kidId ? parseInt(this.$route.query.kidId) : null
    this.userId = this.$route.query.userId ? parseInt(this.$route.query.userId) : null
    this.globalMode = !this.userId && !this.deviceId && !this.macAddress
    this.loadKidProfiles()
  },
  methods: {
    loadKidProfiles() {
      this.loading = true

      // No family or device context (e.g. straight from the sidebar menu):
      // show every child in the system, one page at a time.
      if (this.globalMode) {
        Api.admin.listAllKids(this.page, this.limit, ({ data }) => {
          this.loading = false
          if (data.code === 0 && data.data) {
            this.kidProfiles = data.data.items || []
            this.total = data.data.total || 0
          } else {
            this.$message.error(data.msg || 'Failed to load kid profiles')
          }
        })
        return
      }

      // If userId is provided (admin mode), use admin API to get that user's kid profiles
      if (this.userId) {
        Api.admin.getUserKidProfiles(this.userId, ({ data }) => {
          this.loading = false
          if (data.code === 0) {
            this.kidProfiles = data.data || []
          } else {
            this.$message.error(data.msg || 'Failed to load kid profiles')
          }
        })
      } else {
        // Regular user - get their own kid profiles
        Api.profile.getKidProfiles((res) => {
          this.loading = false
          if (res.code === 0) {
            this.kidProfiles = res.data || []
          } else {
            this.$message.error(res.msg || 'Failed to load kid profiles')
          }
        })
      }
    },

    /**
     * What the roster shows in the Toys column. `device_count` is the toys
     * actually paired to this child; `devices` falls back to the household's
     * toys so a registered child whose toy was never paired still reads as
     * having one rather than looking abandoned.
     */
    deviceLabel(row) {
      const devices = row.devices || []
      if (!devices.length) return 'No toy'
      const name = devices[0].alias || devices[0].mac_address
      const label = devices.length > 1 ? `${name} +${devices.length - 1}` : name
      return row.device_count ? label : `${label} (household)`
    },

    /** Adds the tap affordance on top of the mixin's selection class. */
    kidRowClass(context) {
      const base = this.rowClass(context)
      return this.globalMode ? `${base} tappable-row`.trim() : base
    },

    /**
     * `birth_date` is a Postgres date column, so it arrives as an ISO timestamp
     * ("2018-06-15T00:00:00.000Z"). The column printed that verbatim and the
     * edit dialog fed it to a date-picker declared value-format="yyyy-MM-dd".
     * Slicing beats `new Date(...)` here: the value is already UTC midnight, and
     * re-parsing it would shift the day for anyone west of UTC.
     */
    birthDateValue(row) {
      const raw = row.birth_date || row.birthDate
      return raw ? String(raw).slice(0, 10) : ''
    },

    initials(name) {
      const value = (name || '').trim()
      if (!value) return '—'
      const parts = value.split(/\s+/).filter(Boolean)
      return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase()
    },

    /** Numeric age for sorting; `calculateAge` stays the display formatter. */
    ageValue(birthDate) {
      const age = this.calculateAge(birthDate)
      return typeof age === 'number' ? age : -1
    },

    bulkAssign() {
      const rows = this.selectedRows
      if (!rows.length) return
      this.handleAssign(rows[0])
    },

    bulkExport() {
      const rows = this.selectedRows
      if (!rows.length) {
        this.$message.warning('Nothing to export.')
        return
      }
      const cols = ['name', 'nickname', 'birth_date', 'gender', 'language']
      const escape = value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`
      const csv = [cols.join(',')]
        .concat(rows.map(row => cols.map(col => escape(row[col])).join(',')))
        .join('\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'kid-profiles.csv'
      link.click()
      URL.revokeObjectURL(url)
    },

    bulkDelete() {
      const rows = this.selectedRows
      if (!rows.length) return
      this.$confirm(`Delete ${rows.length} kid profile${rows.length === 1 ? '' : 's'}? This cannot be undone.`, 'Delete profiles', {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        rows.forEach(row => this.handleDelete(row, true))
        this.clearSelection()
      }).catch(() => {})
    },

    calculateAge(birthDate) {
      if (!birthDate) return '-'
      const birth = new Date(birthDate)
      const now = new Date()
      let age = now.getFullYear() - birth.getFullYear()
      const monthDiff = now.getMonth() - birth.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
        age--
      }
      return age > 0 ? age : '-'
    },

    isAssigned(kidId) {
      return this.assignedKidId === kidId
    },

    showAddDialog() {
      this.editMode = false
      this.editingId = null
      this.form = {
        name: '',
        nickname: '',
        birthDate: '',
        gender: '',
        interests: [],
        language: 'en',
        parent_rule: ''
      }
      this.dialogVisible = true
    },

    handleEdit(row) {
      this.editMode = true
      this.editingId = row.id
      this.form = {
        name: row.name || '',
        nickname: row.nickname || '',
        birthDate: this.birthDateValue(row),
        gender: row.gender || '',
        interests: row.interests || [],
        language: row.language || 'en',
        parent_rule: row.parent_rule || ''
      }
      this.dialogVisible = true
    },

    handleSubmit() {
      this.$refs.kidForm.validate((valid) => {
        if (!valid) return

        this.submitting = true
        const data = { ...this.form }

        if (this.editMode) {
          // Use admin API if in admin mode
          if (this.isAdminMode) {
            Api.admin.updateKidProfile(this.editingId, data, ({ data: res }) => {
              this.submitting = false
              if (res.code === 0) {
                this.$message.success('Kid profile updated successfully')
                this.dialogVisible = false
                this.loadKidProfiles()
              } else {
                this.$message.error(res.msg || 'Failed to update kid profile')
              }
            })
          } else {
            Api.profile.updateKid(this.editingId, data, (res) => {
              this.submitting = false
              if (res.code === 0) {
                this.$message.success('Kid profile updated successfully')
                this.dialogVisible = false
                this.loadKidProfiles()
              } else {
                this.$message.error(res.msg || 'Failed to update kid profile')
              }
            })
          }
        } else {
          // Use admin API if in admin mode
          if (this.isAdminMode) {
            Api.admin.createKidProfileForUser(this.userId, data, ({ data: res }) => {
              this.submitting = false
              if (res.code === 0) {
                this.$message.success('Kid profile created successfully')
                this.dialogVisible = false
                this.loadKidProfiles()
              } else {
                this.$message.error(res.msg || 'Failed to create kid profile')
              }
            })
          } else {
            Api.profile.createKid(data, (res) => {
              this.submitting = false
              if (res.code === 0) {
                this.$message.success('Kid profile created successfully')
                this.dialogVisible = false
                this.loadKidProfiles()
              } else {
                this.$message.error(res.msg || 'Failed to create kid profile')
              }
            })
          }
        }
      })
    },

    handleAssign(row) {
      if (!this.deviceId) {
        this.$message.warning('No device selected')
        return
      }

      const kidId = this.isAssigned(row.id) ? null : row.id

      // Use admin API if in admin mode
      if (this.isAdminMode) {
        Api.admin.assignKidToDeviceAdmin(this.deviceId, kidId, ({ data: res }) => {
          if (res.code === 0) {
            this.assignedKidId = kidId
            this.$message.success(kidId ? 'Kid assigned to device' : 'Kid unassigned from device')
          } else {
            this.$message.error(res.msg || 'Failed to assign kid to device')
          }
        })
      } else {
        Api.profile.assignKidToDevice(this.deviceId, kidId, (res) => {
          if (res.code === 0) {
            this.assignedKidId = kidId
            this.$message.success(kidId ? 'Kid assigned to device' : 'Kid unassigned from device')
          } else {
            this.$message.error(res.msg || 'Failed to assign kid to device')
          }
        })
      }
    },

    // `skipConfirm` is set by the bulk path, which has already confirmed once
    // for the whole selection.
    handleDelete(row, skipConfirm) {
      const run = () => {
        // Use admin API if in admin mode
        if (this.isAdminMode) {
          Api.admin.deleteKidProfile(row.id, ({ data: res }) => {
            if (res.code === 0) {
              this.$message.success('Kid profile deleted')
              this.loadKidProfiles()
            } else {
              this.$message.error(res.msg || 'Failed to delete kid profile')
            }
          })
        } else {
          Api.profile.deleteKid(row.id, (res) => {
            if (res.code === 0) {
              this.$message.success('Kid profile deleted')
              this.loadKidProfiles()
            } else {
              this.$message.error(res.msg || 'Failed to delete kid profile')
            }
          })
        }
      }

      if (skipConfirm) {
        run()
        return
      }

      this.$confirm('Are you sure you want to delete this kid profile?', 'Confirm', {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(run).catch(() => {})
    },

    /**
     * Roster rows drill into Family 360, which is where a child's toys, their
     * runtime state and usage already live. The Actions column is excluded so
     * Edit/Delete do not navigate out from under the click.
     */
    openKid(row, column) {
      if (!this.globalMode) return
      // Select mode and drill-down are different intents: a click meant for a
      // checkbox must not navigate away mid-selection.
      if (this.selecting) return
      if (column && column.label === 'Actions') return
      this.$router.push(`/families/${encodeURIComponent(row.id)}`)
    },

    onPageChange() {
      this.clearSelection()
      this.loadKidProfiles()
    },

    goBack() {
      this.$router.go(-1)
    }
  }
}
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.kid-profiles-container { min-height: 0; background: transparent; }

.main-content {
  max-width: 1400px;
  margin: 0;
  padding: 0;
}

.page-lead .chip { margin-left: 8px; }

.interest-chip { margin-right: 4px; }

.list-footer-card {
  margin-top: 14px;

  .list-footer { border-top: none; }
}

::v-deep .tappable-row { cursor: pointer; }

.row-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;

  ::v-deep .el-button + .el-button { margin-left: 0; }
}

.delete-btn { color: $danger !important; }

// ---------- Card view ----------
.kid-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (max-width: 1100px) { .kid-cards { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 700px) { .kid-cards { grid-template-columns: 1fr; } }

.mini-card {
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 18px;

  &.on { background: $row-selected; }
  &.tappable { cursor: pointer; }
}

.mini-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.mini-name {
  font-size: 13px;
  font-weight: 560;
  color: $text-dark;
}

.mini-sub {
  font-size: 11.5px;
  color: $text-light;
  margin-top: 4px;
}

.mini-interests {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 14px;
  min-height: 20px;
}

.mini-stats {
  display: flex;
  gap: 18px;
  padding-top: 14px;
  border-top: 1px solid $divider-color;

  div {
    font-family: $font-mono;
    font-size: 10px;
    color: $text-light;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  b {
    display: block;
    font-family: $font-display;
    font-size: 20px;
    font-weight: 400;
    color: $text-dark;
    letter-spacing: -0.02em;
    margin-top: 3px;
  }
}
</style>
