<template>
  <div class="kid-profiles-container">
    <header-bar />
    <div class="main-content">
      <div class="page-header">
        <h2>Kid Profiles</h2>
        <p class="subtitle" v-if="macAddress">Device: {{ macAddress }}</p>
        <p class="subtitle admin-notice" v-if="isAdminMode">
          <i class="el-icon-setting"></i> Managing user's kid profiles (Admin mode)
        </p>
      </div>

      <div class="toolbar">
        <el-button type="primary" @click="showAddDialog">
          <i class="el-icon-plus"></i> Add Kid Profile
        </el-button>
        <el-button @click="goBack">
          <i class="el-icon-back"></i> Back
        </el-button>
      </div>

      <!-- Kid Profile Cards -->
      <div class="kid-cards" v-loading="loading">
        <div v-for="kid in kidProfiles" :key="kid.id" class="kid-card"
          :class="{ 'kid-card--expanded': expandedKid === kid.id, 'kid-card--assigned': isAssigned(kid.id) }">

          <!-- Card Header (always visible) -->
          <div class="kid-card-header" @click="toggleExpand(kid.id)">
            <div class="kid-avatar">
              {{ (kid.name || '?')[0].toUpperCase() }}
            </div>
            <div class="kid-info">
              <div class="kid-name">
                {{ kid.name }}
                <span class="kid-nickname" v-if="kid.nickname">({{ kid.nickname }})</span>
              </div>
              <div class="kid-meta">
                <span v-if="calculateAge(kid.birth_date || kid.birthDate) !== '-'">
                  {{ calculateAge(kid.birth_date || kid.birthDate) }} yrs
                </span>
                <span v-if="kid.gender">· {{ kid.gender }}</span>
                <span v-if="kid.language">· {{ kid.language }}</span>
              </div>
              <div class="kid-interests" v-if="kid.interests && kid.interests.length">
                <span v-for="interest in kid.interests.slice(0, 4)" :key="interest" class="interest-chip">
                  {{ interest }}
                </span>
                <span v-if="kid.interests.length > 4" class="interest-chip interest-more">
                  +{{ kid.interests.length - 4 }}
                </span>
              </div>
            </div>
            <div class="kid-actions">
              <el-tag v-if="isAssigned(kid.id)" type="success" size="mini" effect="dark">Assigned</el-tag>
              <el-button size="mini" @click.stop="handleEdit(kid)">Edit</el-button>
              <el-button size="mini" @click.stop="handleAssign(kid)" v-if="deviceId">
                {{ isAssigned(kid.id) ? 'Unassign' : 'Assign' }}
              </el-button>
              <el-button size="mini" type="danger" plain @click.stop="handleDelete(kid)">Delete</el-button>
              <i :class="expandedKid === kid.id ? 'el-icon-arrow-up' : 'el-icon-arrow-down'"
                class="expand-arrow"></i>
            </div>
          </div>

          <!-- Expandable Game Progress (trophy room) -->
          <transition name="slide">
            <div v-if="expandedKid === kid.id" class="kid-card-body">
              <kid-game-progress :kid-id="kid.name" />
            </div>
          </transition>
        </div>
      </div>

      <div v-if="kidProfiles.length === 0 && !loading" class="empty-state">
        <i class="el-icon-user"></i>
        <p>No kid profiles yet. Click "Add Kid Profile" to create one.</p>
      </div>
    </div>

    <!-- Add/Edit Dialog -->
    <el-dialog :title="editMode ? 'Edit Kid Profile' : 'Add Kid Profile'" :visible.sync="dialogVisible" width="500px">
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
import Api from '@/apis/api'
import HeaderBar from '@/components/HeaderBar.vue'
import VersionFooter from '@/components/VersionFooter.vue'
import KidGameProgress from './KidGameProgress.vue'

export default {
  name: 'KidProfiles',
  components: { HeaderBar, VersionFooter, KidGameProgress },
  data() {
    return {
      loading: false,
      submitting: false,
      kidProfiles: [],
      dialogVisible: false,
      editMode: false,
      editingId: null,
      deviceId: null,
      macAddress: '',
      assignedKidId: null,
      expandedKid: null,
      userId: null, // If set, we're viewing another user's profiles (admin mode)
      form: {
        name: '',
        nickname: '',
        birthDate: '',
        gender: '',
        interests: [],
        language: 'en'
      },
      rules: {
        name: [{ required: true, message: 'Please enter name', trigger: 'blur' }]
      }
    }
  },
  computed: {
    isAdminMode() {
      return !!this.userId
    }
  },
  created() {
    this.deviceId = this.$route.query.deviceId
    this.macAddress = this.$route.query.macAddress || ''
    this.assignedKidId = this.$route.query.kidId ? parseInt(this.$route.query.kidId) : null
    this.userId = this.$route.query.userId ? parseInt(this.$route.query.userId) : null
    this.loadKidProfiles()
  },
  methods: {
    loadKidProfiles() {
      this.loading = true

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
        language: 'en'
      }
      this.dialogVisible = true
    },

    handleEdit(row) {
      this.editMode = true
      this.editingId = row.id
      this.form = {
        name: row.name || '',
        nickname: row.nickname || '',
        birthDate: row.birth_date || row.birthDate || '',
        gender: row.gender || '',
        interests: row.interests || [],
        language: row.language || 'en'
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

    handleDelete(row) {
      this.$confirm('Are you sure you want to delete this kid profile?', 'Confirm', {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
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
      }).catch(() => {})
    },

    toggleExpand(kidId) {
      this.expandedKid = this.expandedKid === kidId ? null : kidId
    },

    goBack() {
      this.$router.go(-1)
    }
  }
}
</script>

<style scoped lang="scss">
$bg: #F0EBF5;
$surface: #FFFFFF;
$dark: #1A1624;
$warm: #FF9100;
$gold: #FFD54F;
$text: #2C2538;
$text-muted: #8A7FA8;
$accent-blue: #4AA9FF;
$radius: 16px;

.kid-profiles-container {
  min-height: 100vh;
  background: $bg;
}

.main-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 20px;
}

.page-header {
  margin-bottom: 24px;
  h2 { margin: 0 0 4px; color: $text; font-size: 22px; font-weight: 700; }
  .subtitle { margin: 0; color: $text-muted; font-size: 13px; }
  .admin-notice { margin-top: 6px; color: $accent-blue; font-weight: 600; font-size: 13px; i { margin-right: 4px; } }
}

.toolbar {
  margin-bottom: 20px;
  display: flex;
  gap: 10px;
}

/* ═══ Kid Cards ═══ */
.kid-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kid-card {
  background: $surface;
  border-radius: $radius;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.3s, box-shadow 0.3s;
  &:hover { box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06); }
  &--assigned { border-color: rgba($warm, 0.3); }
  &--expanded { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); }
}

.kid-card-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: rgba(0, 0, 0, 0.015); }
}

.kid-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, $warm, $gold);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.kid-info {
  flex: 1;
  min-width: 0;
}

.kid-name {
  font-size: 16px;
  font-weight: 700;
  color: $text;
  .kid-nickname { font-weight: 400; color: $text-muted; font-size: 13px; }
}

.kid-meta {
  font-size: 12px;
  color: $text-muted;
  margin-top: 2px;
}

.kid-interests {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.interest-chip {
  background: rgba($warm, 0.1);
  color: darken($warm, 10%);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: capitalize;
}

.interest-more {
  background: rgba(0, 0, 0, 0.05);
  color: $text-muted;
}

.kid-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.expand-arrow {
  font-size: 14px;
  color: $text-muted;
  margin-left: 4px;
  transition: transform 0.3s;
}

/* ═══ Expand Animation ═══ */
.kid-card-body {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.slide-enter-active, .slide-leave-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 1200px;
  overflow: hidden;
}
.slide-enter, .slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* ═══ Empty State ═══ */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: $text-muted;
  i { font-size: 48px; margin-bottom: 15px; }
  p { margin: 0; }
}
</style>
