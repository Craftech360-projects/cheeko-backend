<template>
  <div class="content-library">
    <HeaderBar />

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <div class="page-header">
            <div class="header-left">
              <div class="header-icon">
                <i class="el-icon-folder-opened"></i>
              </div>
              <span class="header-title">Content Library</span>
            </div>
            <div class="header-actions">
              <el-button type="success" size="small" @click="showUploadPackDialog">
                <i class="el-icon-upload2"></i> Upload Pack
              </el-button>
              <el-button type="primary" size="small" @click="showAddDialog">
                <i class="el-icon-plus"></i> Add Content
              </el-button>
              <button class="custom-close-btn" @click="goToHome">x</button>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Stats Cards -->
          <div class="stats-row">
            <div class="stat-card">
              <div class="stat-value">{{ stats.total }}</div>
              <div class="stat-label">Total Content</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ stats.music }}</div>
              <div class="stat-label">Music</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ stats.stories }}</div>
              <div class="stat-label">Stories</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ stats.textbooks }}</div>
              <div class="stat-label">Textbooks</div>
            </div>
          </div>

          <!-- Filters -->
          <div class="filter-row">
            <el-select v-model="filters.type" placeholder="Type" size="small" clearable @change="handleFilterChange">
              <el-option label="All Types" value="" />
              <el-option label="Music" value="music" />
              <el-option label="Story" value="story" />
              <el-option label="Textbook" value="textbook" />
            </el-select>
            <el-select v-model="filters.category" placeholder="Category" size="small" clearable @change="handleFilterChange">
              <el-option label="All Categories" value="" />
              <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
            </el-select>
            <el-input
              v-model="filters.search"
              placeholder="Search content..."
              size="small"
              clearable
              prefix-icon="el-icon-search"
              @input="handleSearchDebounced"
              @clear="handleFilterChange"
              style="width: 240px;"
            />
          </div>

          <!-- Content Table -->
          <el-table
            :data="content"
            v-loading="loading"
            style="width: 100%"
            size="small"
            :row-class-name="tableRowClassName"
          >
            <el-table-column label="Thumbnail" width="70" align="center">
              <template slot-scope="scope">
                <div class="thumbnail-cell">
                  <img
                    v-if="scope.row.thumbnail_url"
                    :src="scope.row.thumbnail_url"
                    :alt="scope.row.title"
                    class="thumbnail-img"
                    @error="handleThumbnailError($event)"
                  />
                  <div v-else class="thumbnail-placeholder">
                    <i :class="scope.row.content_type === 'music' ? 'el-icon-headset' : 'el-icon-reading'"></i>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="Type" width="80" align="center">
              <template slot-scope="scope">
                <el-tag :type="getTypeTagColor(scope.row.content_type)" size="mini">
                  {{ scope.row.content_type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="Title" min-width="180">
              <template slot-scope="scope">
                <div class="title-cell">
                  <span class="main-title">{{ scope.row.title }}</span>
                  <span v-if="scope.row.description" class="romanized">{{ scope.row.description }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="category" label="Category" width="120" />
            <el-table-column label="Filename" width="150" show-overflow-tooltip>
              <template slot-scope="scope">
                {{ scope.row.metadata && scope.row.metadata.filename ? scope.row.metadata.filename : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="Duration" width="100" align="center">
              <template slot-scope="scope">
                {{ formatDuration(scope.row.duration_seconds) }}
              </template>
            </el-table-column>
            <el-table-column label="Status" width="90" align="center">
              <template slot-scope="scope">
                <el-tag :type="scope.row.status === 1 ? 'success' : 'info'" size="mini">
                  {{ scope.row.status === 1 ? 'Active' : 'Inactive' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Actions" width="180" align="center" fixed="right">
              <template slot-scope="scope">
                <el-button
                  type="text"
                  size="mini"
                  :class="currentlyPlaying === scope.row.id ? 'playing-btn' : 'play-btn'"
                  @click="handlePlay(scope.row)"
                  :disabled="!scope.row.url"
                >
                  <i :class="currentlyPlaying === scope.row.id ? 'el-icon-video-pause' : 'el-icon-video-play'"></i>
                </el-button>
                <el-button type="text" size="mini" @click="handleEdit(scope.row)">
                  Edit
                </el-button>
                <el-button type="text" size="mini" class="delete-btn" @click="handleDelete(scope.row)">
                  Delete
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div v-if="content.length === 0 && !loading" class="empty-state">
            <i class="el-icon-folder-opened"></i>
            <p>No content found</p>
          </div>

          <!-- Pagination -->
          <div v-if="content.length > 0" class="pagination-wrapper">
            <el-pagination
              @size-change="handleSizeChange"
              @current-change="handlePageChange"
              :current-page="pagination.page"
              :page-sizes="[10, 20, 50, 100]"
              :page-size="pagination.limit"
              layout="total, sizes, prev, pager, next"
              :total="pagination.total"
              size="small"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Content Dialog -->
    <el-dialog
      :title="dialogMode === 'add' ? 'Add Content' : 'Edit Content'"
      :visible.sync="dialogVisible"
      width="550px"
      :close-on-click-modal="false"
    >
      <el-form :model="contentForm" :rules="formRules" ref="contentForm" label-width="110px" size="small">
        <el-form-item label="Title" prop="title">
          <el-input v-model="contentForm.title" placeholder="Enter title" />
        </el-form-item>
        <el-form-item label="Description">
          <el-input v-model="contentForm.description" placeholder="Description or romanized title" />
        </el-form-item>
        <el-form-item label="Content Type" prop="content_type">
          <el-select v-model="contentForm.content_type" placeholder="Select type" style="width: 100%">
            <el-option label="Music" value="music" />
            <el-option label="Story" value="story" />
            <el-option label="Textbook" value="textbook" />
          </el-select>
        </el-form-item>
        <el-form-item label="Category">
          <el-select v-model="contentForm.category" placeholder="Select or enter category" filterable allow-create style="width: 100%">
            <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="Audio File" v-if="dialogMode === 'add'">
          <el-upload
            class="audio-uploader"
            action=""
            :auto-upload="false"
            :show-file-list="false"
            :on-change="handleFileChange"
            accept="audio/*"
          >
            <el-button size="small" type="primary" :loading="uploading">
              <i class="el-icon-upload2"></i> {{ uploadedFile ? uploadedFile.name : 'Select Audio File' }}
            </el-button>
          </el-upload>
          <div v-if="uploadedFile" class="upload-info">
            <span class="file-name">{{ uploadedFile.name }}</span>
            <span class="file-size">({{ formatFileSize(uploadedFile.size) }})</span>
            <el-button type="text" size="mini" @click="clearUpload" class="clear-btn">
              <i class="el-icon-close"></i>
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="URL" v-else>
          <el-input v-model="contentForm.url" placeholder="https://cdn.example.com/..." />
        </el-form-item>
        <el-form-item label="Thumbnail">
          <el-input v-model="contentForm.thumbnail_url" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="Duration (sec)">
          <el-input-number v-model="contentForm.duration_seconds" :min="0" :max="36000" />
        </el-form-item>
        <el-form-item label="Status">
          <el-switch v-model="contentForm.status" :active-value="1" :inactive-value="0" active-text="Active" inactive-text="Inactive" />
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false" size="small">Cancel</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting" size="small">
          {{ dialogMode === 'add' ? 'Add' : 'Save' }}
        </el-button>
      </span>
    </el-dialog>

    <!-- Upload Content Pack Dialog -->
    <el-dialog
      title="Upload Content Pack"
      :visible.sync="packUploadVisible"
      width="620px"
      :close-on-click-modal="false"
    >
      <el-form :model="packUploadForm" :rules="packUploadRules" ref="packUploadForm" label-width="120px" size="small">
        <el-form-item label="Pack Code" prop="packCode">
          <el-input v-model="packUploadForm.packCode" placeholder="e.g., ANIMAL01" maxlength="32" />
        </el-form-item>
        <el-form-item label="Pack Name" prop="name">
          <el-input v-model="packUploadForm.name" placeholder="Display name" />
        </el-form-item>
        <el-form-item label="Content Type" prop="contentType">
          <el-select v-model="packUploadForm.contentType" style="width: 100%">
            <el-option label="Story Pack" value="story_pack" />
            <el-option label="Rhyme Pack" value="rhyme_pack" />
            <el-option label="Habit Pack" value="habit_pack" />
            <el-option label="RFID Content" value="rfidcontent" />
          </el-select>
        </el-form-item>
        <el-form-item label="Language" prop="language">
          <el-select v-model="packUploadForm.language" style="width: 100%">
            <el-option label="English" value="en" />
            <el-option label="Hindi" value="hi" />
            <el-option label="Telugu" value="te" />
            <el-option label="Kannada" value="kn" />
            <el-option label="Tamil" value="ta" />
            <el-option label="Malayalam" value="ml" />
            <el-option label="German" value="de" />
          </el-select>
        </el-form-item>
        <el-form-item label="Version" prop="version">
          <el-input v-model="packUploadForm.version" placeholder="1" />
        </el-form-item>
        <el-form-item label="Description">
          <el-input type="textarea" v-model="packUploadForm.description" :rows="2" placeholder="Optional description" />
        </el-form-item>
        <el-form-item label="Files" prop="files">
          <el-upload
            ref="packUpload"
            action=""
            multiple
            :auto-upload="false"
            :file-list="packUploadFileList"
            :on-change="handlePackFileChange"
            :on-remove="handlePackFileRemove"
            accept=".zip,audio/*,image/*,.bin"
          >
            <el-button size="small" type="primary">
              <i class="el-icon-folder-add"></i> Select ZIP or Files
            </el-button>
            <div slot="tip" class="el-upload__tip">
              ZIP may include manifest.json. Normal upload pairs audio/image by matching filename.
            </div>
          </el-upload>
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button @click="packUploadVisible = false" size="small">Cancel</el-button>
        <el-button type="success" @click="handlePackUploadSubmit" :loading="packUploading" size="small">
          Upload & Create Pack
        </el-button>
      </span>
    </el-dialog>

    <!-- Hidden Audio Player -->
    <audio
      ref="audioPlayer"
      @ended="handleAudioEnded"
      @error="handleAudioError"
      style="display: none;"
    ></audio>
  </div>
</template>

<script>
import Api from "@/apis/api";
import HeaderBar from "@/components/HeaderBar.vue";
import debounce from 'lodash/debounce';

export default {
  name: "ContentLibrary",
  components: { HeaderBar },
  data() {
    return {
      content: [],
      loading: false,
      stats: {
        total: 0,
        music: 0,
        stories: 0,
        textbooks: 0
      },
      filters: {
        type: "",
        category: "",
        search: ""
      },
      categories: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0
      },
      dialogVisible: false,
      dialogMode: 'add',
      submitting: false,
      uploading: false,
      uploadedFile: null,
      packUploadVisible: false,
      packUploading: false,
      packUploadFileList: [],
      packUploadForm: {
        packCode: '',
        name: '',
        contentType: 'rhyme_pack',
        language: 'en',
        version: '1',
        description: ''
      },
      currentlyPlaying: null,
      contentForm: {
        id: null,
        title: '',
        description: '',
        content_type: '',
        category: '',
        filename: '',
        url: '',
        thumbnail_url: '',
        duration_seconds: null,
        status: 1
      },
      formRules: {
        title: [
          { required: true, message: 'Please enter title', trigger: 'blur' }
        ],
        content_type: [
          { required: true, message: 'Please select content type', trigger: 'change' }
        ]
      },
      packUploadRules: {
        packCode: [
          { required: true, message: 'Please enter pack code', trigger: 'blur' }
        ],
        name: [
          { required: true, message: 'Please enter pack name', trigger: 'blur' }
        ],
        contentType: [
          { required: true, message: 'Please select content type', trigger: 'change' }
        ],
        language: [
          { required: true, message: 'Please select language', trigger: 'change' }
        ],
        files: [
          {
            validator: (_rule, _value, callback) => {
              if (!this.packUploadFileList.length) {
                callback(new Error('Please select a ZIP or media files'));
                return;
              }
              callback();
            },
            trigger: 'change'
          }
        ]
      }
    };
  },
  created() {
    this.handleSearchDebounced = debounce(this.handleSearch, 300);
  },
  methods: {
    goToHome() {
      this.$router.push("/home");
    },
    fetchContent() {
      this.loading = true;

      if (this.filters.search) {
        // Use search API
        Api.content.searchLibrary({
          query: this.filters.search,
          page: this.pagination.page,
          limit: this.pagination.limit,
          contentType: this.filters.type,
          category: this.filters.category
        }, (res) => {
          this.loading = false;
          if (res.data && res.data.code === 0) {
            this.content = res.data.data.list || [];
            this.pagination.total = res.data.data.total || 0;
          } else {
            this.content = [];
            this.pagination.total = 0;
          }
        });
      } else {
        // Use list API
        Api.content.getLibraryList({
          page: this.pagination.page,
          limit: this.pagination.limit,
          contentType: this.filters.type,
          category: this.filters.category
        }, (res) => {
          this.loading = false;
          if (res.data && res.data.code === 0) {
            this.content = res.data.data.list || [];
            this.pagination.total = res.data.data.total || 0;
          } else {
            this.content = [];
            this.pagination.total = 0;
            if (res.data && res.data.msg) {
              this.$message.error(res.data.msg);
            }
          }
        });
      }
    },
    fetchStats() {
      Api.content.getStatistics((res) => {
        if (res.data && res.data.code === 0) {
          const data = res.data.data;
          this.stats = {
            total: data.total || 0,
            music: data.byType?.music || 0,
            stories: data.byType?.story || 0,
            textbooks: data.byType?.textbook || 0
          };
        }
      });
    },
    fetchCategories() {
      Api.content.getLibraryCategories(null, (res) => {
        if (res.data && res.data.code === 0) {
          // Extract unique category names
          const categoryData = res.data.data || [];
          this.categories = [...new Set(categoryData.map(c => c.category))].filter(Boolean);
        }
      });
    },
    handleFilterChange() {
      this.pagination.page = 1;
      this.fetchContent();
    },
    handleSearch() {
      this.pagination.page = 1;
      this.fetchContent();
    },
    tableRowClassName({ rowIndex }) {
      return rowIndex % 2 === 0 ? "even-row" : "odd-row";
    },
    getTypeTagColor(type) {
      const colors = {
        music: "primary",
        story: "success",
        textbook: "warning"
      };
      return colors[type] || "info";
    },
    formatDuration(seconds) {
      if (!seconds) return "-";
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    },
    formatFileSize(bytes) {
      if (!bytes) return '0 B';
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    },
    handleThumbnailError(event) {
      // Hide broken image and show placeholder
      event.target.style.display = 'none';
    },
    handleFileChange(file) {
      if (file && file.raw) {
        this.uploadedFile = file.raw;
        // Auto-fill title from filename if empty
        if (!this.contentForm.title) {
          const nameWithoutExt = file.raw.name.replace(/\.[^/.]+$/, '');
          this.contentForm.title = nameWithoutExt;
        }
      }
    },
    clearUpload() {
      this.uploadedFile = null;
    },
    async uploadFile() {
      if (!this.uploadedFile) return null;

      const formData = new FormData();
      formData.append('file', this.uploadedFile);
      formData.append('contentType', this.contentForm.content_type);
      formData.append('category', this.contentForm.category || 'English');

      const uploadUrl = `${Api.getServiceUrl()}/content/library/upload`;
      const storedToken = localStorage.getItem('token');
      // Token is stored as JSON object like {"token": "actual-value"}
      let token = null;
      try {
        const parsed = JSON.parse(storedToken);
        token = parsed.token;
      } catch (e) {
        token = storedToken; // Fallback if not JSON
      }

      console.log('=== Upload Debug Info ===');
      console.log('Upload URL:', uploadUrl);
      console.log('File:', this.uploadedFile.name, this.uploadedFile.size, 'bytes');
      console.log('Content Type:', this.contentForm.content_type);
      console.log('Category:', this.contentForm.category || 'English');
      console.log('Token present:', !!token);
      console.log('Token preview:', token ? token.substring(0, 20) + '...' : 'none');

      try {
        this.uploading = true;
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        console.log('Response status:', response.status, response.statusText);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Response error:', errorText);
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        console.log('Response data:', result);

        if (result.code === 0) {
          return result.data;
        } else {
          throw new Error(result.msg || 'Upload failed');
        }
      } catch (error) {
        console.error('Upload error:', error);
        this.$message.error(`Upload failed: ${error.message}`);
        return null;
      } finally {
        this.uploading = false;
      }
    },
    handleSizeChange(val) {
      this.pagination.limit = val;
      this.pagination.page = 1;
      this.fetchContent();
    },
    handlePageChange(val) {
      this.pagination.page = val;
      this.fetchContent();
    },
    resetForm() {
      this.contentForm = {
        id: null,
        title: '',
        description: '',
        content_type: '',
        category: '',
        filename: '',
        url: '',
        thumbnail_url: '',
        duration_seconds: null,
        status: 1
      };
      this.uploadedFile = null;
    },
    showAddDialog() {
      this.dialogMode = 'add';
      this.resetForm();
      this.dialogVisible = true;
      this.$nextTick(() => {
        this.$refs.contentForm && this.$refs.contentForm.clearValidate();
      });
    },
    showUploadPackDialog() {
      this.packUploadForm = {
        packCode: '',
        name: '',
        contentType: 'rhyme_pack',
        language: 'en',
        version: '1',
        description: ''
      };
      this.packUploadFileList = [];
      this.packUploadVisible = true;
      this.$nextTick(() => {
        this.$refs.packUpload && this.$refs.packUpload.clearFiles();
        this.$refs.packUploadForm && this.$refs.packUploadForm.clearValidate();
      });
    },
    handlePackFileChange(file, fileList) {
      this.packUploadFileList = fileList;
      if (!this.packUploadForm.name && file && file.name) {
        this.packUploadForm.name = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
      }
      if (!this.packUploadForm.packCode && file && file.name) {
        this.packUploadForm.packCode = file.name
          .replace(/\.[^/.]+$/, '')
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '')
          .slice(0, 16);
      }
      this.$refs.packUploadForm && this.$refs.packUploadForm.validateField('files');
    },
    handlePackFileRemove(_file, fileList) {
      this.packUploadFileList = fileList;
      this.$refs.packUploadForm && this.$refs.packUploadForm.validateField('files');
    },
    handlePackUploadSubmit() {
      this.$refs.packUploadForm.validate((valid) => {
        if (!valid) return;

        const formData = new FormData();
        formData.append('packCode', this.packUploadForm.packCode);
        formData.append('name', this.packUploadForm.name);
        formData.append('contentType', this.packUploadForm.contentType);
        formData.append('language', this.packUploadForm.language);
        formData.append('version', this.packUploadForm.version || '1');
        formData.append('description', this.packUploadForm.description || '');
        formData.append('status', 'published');
        formData.append('active', 'true');

        this.packUploadFileList.forEach((file) => {
          if (file.raw) {
            formData.append('files', file.raw, file.name);
          }
        });

        this.packUploading = true;
        Api.content.uploadContentPack(formData, (res) => {
          this.packUploading = false;
          const data = res.data || {};
          if (data.code === 0) {
            const pack = data.data || {};
            this.$message.success(`Created content pack ${pack.packCode || this.packUploadForm.packCode}`);
            this.packUploadVisible = false;
            this.fetchContent();
            this.fetchStats();
            this.fetchCategories();
          } else {
            this.$message.error(data.msg || 'Failed to upload content pack');
          }
        });
      });
    },
    handleEdit(row) {
      this.dialogMode = 'edit';
      this.contentForm = {
        id: row.id,
        title: row.title || '',
        description: row.description || '',
        content_type: row.content_type || '',
        category: row.category || '',
        filename: row.metadata?.filename || '',
        url: row.url || '',
        thumbnail_url: row.thumbnail_url || '',
        duration_seconds: row.duration_seconds || null,
        status: row.status ?? 1
      };
      this.dialogVisible = true;
    },
    async handleSubmit() {
      this.$refs.contentForm.validate(async (valid) => {
        if (!valid) return;

        this.submitting = true;

        try {
          // If adding new content with a file, upload to S3 first
          if (this.dialogMode === 'add' && this.uploadedFile) {
            const uploadResult = await this.uploadFile();
            if (!uploadResult) {
              this.submitting = false;
              return; // Upload failed, error already shown
            }
            // Set URL and filename from upload result
            this.contentForm.url = uploadResult.url;
            this.contentForm.filename = uploadResult.filename;
          }

          // Transform snake_case to camelCase for API
          const formData = {
            id: this.contentForm.id,
            title: this.contentForm.title,
            description: this.contentForm.description,
            contentType: this.contentForm.content_type,
            category: this.contentForm.category,
            filename: this.contentForm.filename,
            url: this.contentForm.url,
            thumbnailUrl: this.contentForm.thumbnail_url,
            durationSeconds: this.contentForm.duration_seconds,
            status: this.contentForm.status
          };

          if (this.dialogMode === 'add') {
            Api.content.createLibraryItem(formData, (res) => {
              this.submitting = false;
              if (res.data && res.data.code === 0) {
                this.$message.success('Content added successfully');
                this.dialogVisible = false;
                this.fetchContent();
                this.fetchStats();
                this.fetchCategories();
              } else {
                this.$message.error(res.data?.msg || 'Failed to add content');
              }
            });
          } else {
            Api.content.updateLibraryItem(formData.id, formData, (res) => {
              this.submitting = false;
              if (res.data && res.data.code === 0) {
                this.$message.success('Content updated successfully');
                this.dialogVisible = false;
                this.fetchContent();
                this.fetchStats();
                this.fetchCategories();
              } else {
                this.$message.error(res.data?.msg || 'Failed to update content');
              }
            });
          }
        } catch (error) {
          this.submitting = false;
          this.$message.error(`Error: ${error.message}`);
        }
      });
    },
    handleDelete(row) {
      this.$confirm(`Are you sure you want to delete "${row.title}"?`, 'Confirm Delete', {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        Api.content.deleteLibraryItem(row.id, (res) => {
          if (res.data && res.data.code === 0) {
            this.$message.success('Content deleted successfully');
            this.fetchContent();
            this.fetchStats();
          } else {
            this.$message.error(res.data?.msg || 'Failed to delete content');
          }
        });
      }).catch(() => {});
    },
    handlePlay(row) {
      if (!row.url) {
        this.$message.warning('No audio URL available for this content');
        return;
      }

      const audio = this.$refs.audioPlayer;

      // If same content is playing, pause it
      if (this.currentlyPlaying === row.id) {
        audio.pause();
        this.currentlyPlaying = null;
        return;
      }

      // Stop any current playback
      audio.pause();

      // Set new source and play
      audio.src = row.url;
      audio.play()
        .then(() => {
          this.currentlyPlaying = row.id;
          this.$message.success(`Playing: ${row.title}`);
        })
        .catch(err => {
          console.error('Failed to play audio:', err);
          this.$message.error('Failed to play audio');
          this.currentlyPlaying = null;
        });
    },
    handleAudioEnded() {
      this.currentlyPlaying = null;
    },
    handleAudioError() {
      this.$message.error('Audio playback error');
      this.currentlyPlaying = null;
    }
  },
  mounted() {
    this.fetchContent();
    this.fetchStats();
    this.fetchCategories();
  },
  beforeDestroy() {
    // Stop audio when leaving page
    if (this.$refs.audioPlayer) {
      this.$refs.audioPlayer.pause();
      this.$refs.audioPlayer.src = '';
    }
  }
};
</script>

<style scoped lang="scss">
@import "@/styles/theme.scss";

.content-library {
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

  i {
    font-size: 18px;
    color: white;
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

.stats-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.stat-card {
  flex: 1;
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid #f0f0f0;
  text-align: center;
  transition: all 0.3s;

  &:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    border-color: rgba($primary, 0.2);
  }
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: $primary;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 12px;
  color: #666;
}

.filter-row {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
}

.title-cell {
  display: flex;
  flex-direction: column;

  .main-title {
    font-weight: 500;
  }

  .romanized {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
  }
}

.thumbnail-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumbnail-img {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}

.thumbnail-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e7ed 100%);
  display: flex;
  align-items: center;
  justify-content: center;

  i {
    font-size: 18px;
    color: #909399;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: #909399;

  i {
    font-size: 64px;
    margin-bottom: 16px;
    color: #ddd;
  }

  p {
    margin: 0;
    font-size: 14px;
  }
}

.pagination-wrapper {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.delete-btn {
  color: #f56c6c !important;
}

.audio-uploader {
  display: inline-block;
}

.upload-info {
  display: flex;
  align-items: center;
  margin-top: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
  border: 1px solid #e4e7ed;

  .file-name {
    font-size: 13px;
    color: #606266;
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    font-size: 12px;
    color: #909399;
    margin-left: 8px;
  }

  .clear-btn {
    margin-left: auto;
    padding: 0;
    color: #909399 !important;

    &:hover {
      color: #f56c6c !important;
    }
  }
}

.play-btn {
  color: #67c23a !important;
  font-size: 16px !important;
}

.playing-btn {
  color: #409eff !important;
  font-size: 16px !important;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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

::v-deep .el-dialog {
  border-radius: 12px;

  .el-dialog__header {
    border-bottom: 1px solid #f0f0f0;
    padding: 16px 20px;
  }

  .el-dialog__body {
    padding: 20px;
  }

  .el-dialog__footer {
    border-top: 1px solid #f0f0f0;
    padding: 12px 20px;
  }
}
</style>
