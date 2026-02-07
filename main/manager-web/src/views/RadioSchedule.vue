<template>
  <div class="radio-schedule-page">
    <HeaderBar />
    <div class="page-content">
      <div class="page-header">
        <h2>Radio Schedule</h2>
        <p>Manage the 7-day weekly radio broadcast schedule. Programs with no specific day apply every day.</p>
      </div>

      <!-- Day tabs -->
      <el-tabs v-model="activeDay" type="card" @tab-click="handleTabClick">
        <el-tab-pane
          v-for="day in days"
          :key="day.value"
          :label="day.label"
          :name="String(day.value)"
        >
          <div class="tab-header">
            <span class="tab-title">{{ day.label }} Programs ({{ getDayItems(day.value).length }})</span>
            <el-button type="primary" size="small" icon="el-icon-plus" @click="openAddDialog(day.value)">
              Add Program
            </el-button>
          </div>

          <el-table :data="getDayItems(day.value)" border style="width: 100%" empty-text="No programs scheduled">
            <el-table-column prop="start_time" label="Start Time" width="120">
              <template slot-scope="{ row }">{{ formatTime(row.start_time) }}</template>
            </el-table-column>
            <el-table-column prop="end_time" label="End Time" width="120">
              <template slot-scope="{ row }">{{ formatTime(row.end_time) }}</template>
            </el-table-column>
            <el-table-column prop="program_name" label="Program Name" min-width="180" />
            <el-table-column prop="playlist_id" label="Playlist / Language" width="150" />
            <el-table-column prop="stream_url" label="Stream URL" min-width="200">
              <template slot-scope="{ row }">
                <span v-if="row.stream_url" class="stream-url">{{ row.stream_url }}</span>
                <span v-else class="text-muted">Auto (MusicService)</span>
              </template>
            </el-table-column>
            <el-table-column prop="day_of_week" label="Day" width="100">
              <template slot-scope="{ row }">
                <el-tag v-if="row.day_of_week === null" size="small" type="info">Every Day</el-tag>
                <el-tag v-else size="small">{{ getDayName(row.day_of_week) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="is_active" label="Active" width="80" align="center">
              <template slot-scope="{ row }">
                <el-switch
                  v-model="row.is_active"
                  @change="toggleActive(row)"
                  :active-color="'#f5a623'"
                />
              </template>
            </el-table-column>
            <el-table-column label="Actions" width="150" align="center">
              <template slot-scope="{ row }">
                <el-button size="mini" type="primary" icon="el-icon-edit" @click="openEditDialog(row)" />
                <el-button size="mini" type="danger" icon="el-icon-delete" @click="confirmDelete(row)" />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>

      <!-- Add/Edit Dialog -->
      <el-dialog
        :title="isEditing ? 'Edit Program' : 'Add Program'"
        :visible.sync="dialogVisible"
        width="500px"
        @close="resetForm"
      >
        <el-form :model="form" :rules="formRules" ref="scheduleForm" label-width="120px">
          <el-form-item label="Program Name" prop="program_name">
            <el-input v-model="form.program_name" placeholder="e.g., Morning Singalong" />
          </el-form-item>
          <el-form-item label="Start Time" prop="start_time">
            <el-time-picker
              v-model="form.start_time_obj"
              format="HH:mm"
              value-format="HH:mm:ss"
              placeholder="Start time"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="End Time" prop="end_time">
            <el-time-picker
              v-model="form.end_time_obj"
              format="HH:mm"
              value-format="HH:mm:ss"
              placeholder="End time"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="Day of Week" prop="day_of_week">
            <el-select v-model="form.day_of_week" placeholder="Select day" clearable style="width: 100%">
              <el-option label="Every Day" :value="null" />
              <el-option v-for="day in days" :key="day.value" :label="day.label" :value="day.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="Source Type">
            <el-radio-group v-model="form.source_type" @change="handleSourceTypeChange">
              <el-radio label="playlist">Playlist</el-radio>
              <el-radio label="podcast">Podcast</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.source_type === 'playlist'" label="Playlist ID">
            <el-input v-model="form.playlist_id" placeholder="e.g., English, Hindi" />
          </el-form-item>
          <el-form-item v-if="form.source_type === 'podcast'" label="Podcast">
            <el-select
              v-model="form.selected_podcast_id"
              placeholder="Select a podcast episode"
              filterable
              style="width: 100%"
              @change="handlePodcastSelect"
              :loading="loadingPodcasts"
            >
              <el-option
                v-for="p in podcastList"
                :key="p.id"
                :label="p.title"
                :value="p.id"
              >
                <span>{{ p.title }}</span>
                <span style="float: right; color: #8492a6; font-size: 12px">{{ p.category || '' }}</span>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.source_type === 'playlist'" label="Stream URL">
            <el-input v-model="form.stream_url" placeholder="Optional direct stream URL" />
          </el-form-item>
          <el-form-item label="Active">
            <el-switch v-model="form.is_active" :active-color="'#f5a623'" />
          </el-form-item>
        </el-form>
        <span slot="footer">
          <el-button @click="dialogVisible = false">Cancel</el-button>
          <el-button type="primary" @click="saveItem" :loading="saving">
            {{ isEditing ? 'Update' : 'Create' }}
          </el-button>
        </span>
      </el-dialog>
    </div>
  </div>
</template>

<script>
import HeaderBar from '@/components/HeaderBar.vue';
import radioApi from '@/apis/module/radio';

export default {
  name: 'RadioSchedule',
  components: { HeaderBar },
  data() {
    return {
      activeDay: 'all',
      scheduleItems: [],
      loading: false,
      dialogVisible: false,
      isEditing: false,
      editingId: null,
      saving: false,
      days: [
        { value: 'all', label: 'All Days' },
        { value: null, label: 'Every Day (default)' },
        { value: 0, label: 'Sunday' },
        { value: 1, label: 'Monday' },
        { value: 2, label: 'Tuesday' },
        { value: 3, label: 'Wednesday' },
        { value: 4, label: 'Thursday' },
        { value: 5, label: 'Friday' },
        { value: 6, label: 'Saturday' }
      ],
      podcastList: [],
      loadingPodcasts: false,
      form: {
        program_name: '',
        start_time_obj: null,
        end_time_obj: null,
        playlist_id: '',
        stream_url: '',
        day_of_week: null,
        is_active: true,
        source_type: 'playlist',
        selected_podcast_id: null
      },
      formRules: {
        program_name: [{ required: true, message: 'Program name is required', trigger: 'blur' }],
      }
    };
  },
  mounted() {
    this.fetchSchedule();
  },
  methods: {
    fetchSchedule() {
      this.loading = true;
      radioApi.getScheduleAll(({ data }) => {
        this.loading = false;
        if (data.code === 0) {
          this.scheduleItems = data.data || [];
        } else {
          this.$message.error(data.msg || 'Failed to load schedule');
        }
      });
    },

    getDayItems(dayValue) {
      if (dayValue === 'all') return this.scheduleItems;
      if (dayValue === null) return this.scheduleItems.filter(i => i.day_of_week === null);
      return this.scheduleItems.filter(i => i.day_of_week === dayValue || i.day_of_week === null);
    },

    getDayName(value) {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return value !== null && value !== undefined ? names[value] : 'Every';
    },

    formatTime(timeStr) {
      if (!timeStr) return '';
      // Handle "HH:MM:SS" format - show just HH:MM
      return timeStr.substring(0, 5);
    },

    handleTabClick() {
      // Tab changed - no extra action needed since data is client-side filtered
    },

    openAddDialog(dayValue) {
      this.isEditing = false;
      this.editingId = null;
      this.form = {
        program_name: '',
        start_time_obj: null,
        end_time_obj: null,
        playlist_id: 'English',
        stream_url: '',
        day_of_week: dayValue === 'all' ? null : dayValue,
        is_active: true,
        source_type: 'playlist',
        selected_podcast_id: null
      };
      this.fetchPodcasts();
      this.dialogVisible = true;
    },

    openEditDialog(item) {
      this.isEditing = true;
      this.editingId = item.id;
      // Detect if this item uses a podcast source (has stream_url but no playlist_id)
      const isPodcast = item.stream_url && !item.playlist_id;
      this.form = {
        program_name: item.program_name,
        start_time_obj: item.start_time,
        end_time_obj: item.end_time,
        playlist_id: item.playlist_id || '',
        stream_url: item.stream_url || '',
        day_of_week: item.day_of_week,
        is_active: item.is_active,
        source_type: isPodcast ? 'podcast' : 'playlist',
        selected_podcast_id: null
      };
      this.fetchPodcasts();
      this.dialogVisible = true;
    },

    saveItem() {
      this.$refs.scheduleForm.validate((valid) => {
        if (!valid) return;

        const startTime = this.form.start_time_obj;
        const endTime = this.form.end_time_obj;
        if (!startTime || !endTime) {
          this.$message.warning('Please select start and end times');
          return;
        }

        this.saving = true;
        const payload = {
          program_name: this.form.program_name,
          start_time: startTime,
          end_time: endTime,
          playlist_id: this.form.playlist_id || null,
          stream_url: this.form.stream_url || null,
          day_of_week: this.form.day_of_week,
          is_active: this.form.is_active
        };

        if (this.isEditing) {
          radioApi.updateScheduleItem(this.editingId, payload, ({ data }) => {
            this.saving = false;
            if (data.code === 0) {
              this.$message.success('Program updated');
              this.dialogVisible = false;
              this.fetchSchedule();
            } else {
              this.$message.error(data.msg || 'Failed to update');
            }
          });
        } else {
          radioApi.createScheduleItem(payload, ({ data }) => {
            this.saving = false;
            if (data.code === 0) {
              this.$message.success('Program created');
              this.dialogVisible = false;
              this.fetchSchedule();
            } else {
              this.$message.error(data.msg || 'Failed to create');
            }
          });
        }
      });
    },

    toggleActive(item) {
      radioApi.updateScheduleItem(item.id, { is_active: item.is_active }, ({ data }) => {
        if (data.code === 0) {
          this.$message.success(`Program ${item.is_active ? 'activated' : 'deactivated'}`);
        } else {
          this.$message.error('Failed to update status');
          item.is_active = !item.is_active; // Revert
        }
      });
    },

    confirmDelete(item) {
      this.$confirm(`Delete program "${item.program_name}"?`, 'Confirm', {
        type: 'warning',
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel'
      }).then(() => {
        radioApi.deleteScheduleItem(item.id, ({ data }) => {
          if (data.code === 0) {
            this.$message.success('Program deleted');
            this.fetchSchedule();
          } else {
            this.$message.error(data.msg || 'Failed to delete');
          }
        });
      }).catch(() => {});
    },

    fetchPodcasts() {
      this.loadingPodcasts = true;
      radioApi.getPodcastList(({ data }) => {
        this.loadingPodcasts = false;
        if (data.code === 0) {
          this.podcastList = data.data?.list || data.data || [];
        }
      });
    },

    handlePodcastSelect(podcastId) {
      const podcast = this.podcastList.find(p => p.id === podcastId);
      if (podcast) {
        this.form.stream_url = podcast.url || podcast.aws_s3_url || '';
        if (!this.form.program_name) {
          this.form.program_name = podcast.title;
        }
        this.form.playlist_id = '';
      }
    },

    handleSourceTypeChange(type) {
      if (type === 'playlist') {
        this.form.selected_podcast_id = null;
        this.form.stream_url = '';
        if (!this.form.playlist_id) {
          this.form.playlist_id = 'English';
        }
      } else {
        this.form.playlist_id = '';
        this.form.stream_url = '';
      }
    },

    resetForm() {
      if (this.$refs.scheduleForm) {
        this.$refs.scheduleForm.resetFields();
      }
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.radio-schedule-page {
  min-height: 100vh;
  background: #f5f7fa;
}

.page-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  margin-bottom: 20px;

  h2 {
    margin: 0 0 4px 0;
    color: #303133;
  }

  p {
    margin: 0;
    color: #909399;
    font-size: 14px;
  }
}

.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  .tab-title {
    font-size: 14px;
    font-weight: 500;
    color: #606266;
  }
}

.stream-url {
  font-size: 12px;
  color: #409eff;
  word-break: break-all;
}

.text-muted {
  color: #c0c4cc;
  font-style: italic;
  font-size: 12px;
}

::v-deep .el-tabs__item.is-active {
  color: $primary;
}

::v-deep .el-tabs__item:hover {
  color: $primary;
}
</style>
