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

      <el-table :data="kidProfiles" v-loading="loading" style="width: 100%">
        <el-table-column prop="name" label="Name" min-width="150" />
        <el-table-column prop="nickname" label="Nickname" min-width="120" />
        <el-table-column label="Age" min-width="80">
          <template slot-scope="scope">
            {{ calculateAge(scope.row.birth_date || scope.row.birthDate) }}
          </template>
        </el-table-column>
        <el-table-column prop="gender" label="Gender" min-width="80" />
        <el-table-column label="Interests" min-width="200">
          <template slot-scope="scope">
            <el-tag v-for="interest in (scope.row.interests || [])" :key="interest" size="small" style="margin-right: 5px;">
              {{ interest }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="language" label="Language" min-width="100" />
        <el-table-column label="Assigned" min-width="100">
          <template slot-scope="scope">
            <el-tag :type="isAssigned(scope.row.id) ? 'success' : 'info'" size="small">
              {{ isAssigned(scope.row.id) ? 'Yes' : 'No' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Actions" min-width="200" align="center">
          <template slot-scope="scope">
            <el-button type="text" size="small" @click="handleEdit(scope.row)">
              Edit
            </el-button>
            <el-button type="text" size="small" @click="handleAssign(scope.row)" v-if="deviceId">
              {{ isAssigned(scope.row.id) ? 'Unassign' : 'Assign' }}
            </el-button>
            <el-button type="text" size="small" class="delete-btn" @click="handleDelete(scope.row)">
              Delete
            </el-button>
          </template>
        </el-table-column>
      </el-table>

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

export default {
  name: 'KidProfiles',
  components: { HeaderBar, VersionFooter },
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

    goBack() {
      this.$router.go(-1)
    }
  }
}
</script>

<style scoped lang="scss">
.kid-profiles-container {
  min-height: 100vh;
  background: #f5f7fa;
}

.main-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  margin-bottom: 20px;

  h2 {
    margin: 0 0 5px 0;
    color: #303133;
  }

  .subtitle {
    margin: 0;
    color: #909399;
    font-size: 14px;
  }

  .admin-notice {
    margin-top: 8px;
    color: #409eff;
    font-weight: 500;

    i {
      margin-right: 4px;
    }
  }
}

.toolbar {
  margin-bottom: 20px;
  display: flex;
  gap: 10px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #909399;

  i {
    font-size: 48px;
    margin-bottom: 15px;
  }

  p {
    margin: 0;
  }
}

.delete-btn {
  color: #f56c6c !important;
}
</style>
