<template>
  <div class="textbook-management">
    <HeaderBar />
    
    <div class="content-wrapper">
      <!-- Header Section -->
      <div class="page-header">
        <h1 class="page-title">📚 Textbook RAG Management</h1>
        <div class="header-actions">
          <el-button 
            type="primary" 
            icon="el-icon-upload"
            @click="showUploadDialog = true"
          >
            Upload Textbook
          </el-button>
          <el-button 
            icon="el-icon-refresh"
            @click="refreshTextbooks"
          >
            Refresh
          </el-button>
        </div>
      </div>

      <!-- Statistics Cards -->
      <el-row :gutter="20" class="stats-row">
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon books">📖</div>
              <div class="stat-info">
                <div class="stat-value">{{ stats.totalTextbooks }}</div>
                <div class="stat-label">Total Textbooks</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon processed">✅</div>
              <div class="stat-info">
                <div class="stat-value">{{ stats.processedTextbooks }}</div>
                <div class="stat-label">Processed</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon processing">⚙️</div>
              <div class="stat-info">
                <div class="stat-value">{{ stats.processingTextbooks }}</div>
                <div class="stat-label">Processing</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon storage">💾</div>
              <div class="stat-info">
                <div class="stat-value">{{ formatFileSize(stats.totalFileSize) }}</div>
                <div class="stat-label">Storage Used</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- Filters -->
      <el-card class="filter-card">
        <el-row :gutter="20">
          <el-col :span="6">
            <el-select 
              v-model="filters.grade" 
              placeholder="All Grades"
              clearable
              @change="filterTextbooks"
            >
              <el-option label="All Grades" value="" />
              <el-option v-for="grade in grades" :key="grade" :label="`Grade ${grade}`" :value="grade" />
            </el-select>
          </el-col>
          <el-col :span="6">
            <el-select 
              v-model="filters.subject" 
              placeholder="All Subjects"
              clearable
              @change="filterTextbooks"
            >
              <el-option label="All Subjects" value="" />
              <el-option v-for="subject in subjects" :key="subject" :label="subject" :value="subject" />
            </el-select>
          </el-col>
          <el-col :span="6">
            <el-select 
              v-model="filters.status" 
              placeholder="All Status"
              clearable
              @change="filterTextbooks"
            >
              <el-option label="All Status" value="" />
              <el-option label="Uploaded" value="uploaded" />
              <el-option label="Processing" value="processing" />
              <el-option label="Processed" value="processed" />
              <el-option label="Failed" value="failed" />
            </el-select>
          </el-col>
          <el-col :span="6">
            <el-input 
              v-model="filters.search"
              placeholder="Search textbooks..."
              prefix-icon="el-icon-search"
              clearable
              @input="filterTextbooks"
            />
          </el-col>
        </el-row>
      </el-card>

      <!-- Textbooks Table -->
      <el-card class="table-card">
        <el-table 
          :data="textbooks" 
          v-loading="loading"
          style="width: 100%"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="55" />
          
          <el-table-column prop="id" label="ID" width="80" />
          
          <el-table-column prop="originalFilename" label="Textbook Name" min-width="200">
            <template slot-scope="scope">
              <div class="textbook-name">
                <span class="name">{{ scope.row.originalFilename }}</span>
                <el-tag v-if="scope.row.language" size="mini" type="info">
                  {{ scope.row.language }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          
          <el-table-column prop="grade" label="Grade" width="100">
            <template slot-scope="scope">
              <el-tag v-if="scope.row.grade" size="small">
                Grade {{ scope.row.grade }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          
          <el-table-column prop="subject" label="Subject" width="120">
            <template slot-scope="scope">
              <el-tag v-if="scope.row.subject" type="success" size="small">
                {{ scope.row.subject }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          
          <el-table-column prop="status" label="Status" width="120">
            <template slot-scope="scope">
              <el-tag :type="getStatusType(scope.row.status)">
                {{ scope.row.status }}
              </el-tag>
            </template>
          </el-table-column>
          
          <el-table-column prop="totalPages" label="Pages" width="100">
            <template slot-scope="scope">
              {{ scope.row.totalPages || '-' }}
            </template>
          </el-table-column>
          
          <el-table-column prop="processedChunks" label="Chunks" width="100">
            <template slot-scope="scope">
              {{ scope.row.processedChunks || 0 }}
            </template>
          </el-table-column>
          
          <el-table-column prop="fileSize" label="Size" width="100">
            <template slot-scope="scope">
              {{ formatFileSize(scope.row.fileSize) }}
            </template>
          </el-table-column>
          
          <el-table-column prop="uploadDate" label="Upload Date" width="160">
            <template slot-scope="scope">
              {{ formatDate(scope.row.uploadDate) }}
            </template>
          </el-table-column>
          
          <el-table-column label="Actions" width="200" fixed="right">
            <template slot-scope="scope">
              <el-button-group>
                <el-button 
                  v-if="scope.row.status === 'uploaded'"
                  size="mini" 
                  type="primary"
                  @click="processTextbook(scope.row)"
                >
                  Process
                </el-button>
                <el-button 
                  v-if="scope.row.status === 'processed'"
                  size="mini" 
                  type="success"
                  @click="viewChunks(scope.row)"
                >
                  Chunks
                </el-button>
                <el-button 
                  v-if="scope.row.status === 'processed'"
                  size="mini" 
                  type="info"
                  @click="viewTopics(scope.row)"
                >
                  Topics
                </el-button>
                <el-button 
                  size="mini" 
                  type="danger"
                  @click="deleteTextbook(scope.row)"
                >
                  Delete
                </el-button>
              </el-button-group>
            </template>
          </el-table-column>
        </el-table>
        
        <!-- Pagination -->
        <el-pagination
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
          :current-page="currentPage"
          :page-sizes="[10, 20, 50, 100]"
          :page-size="pageSize"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          class="pagination"
        />
      </el-card>
    </div>

    <!-- Upload Dialog -->
    <TextbookUploadDialog
      :visible.sync="showUploadDialog"
      @uploaded="onTextbookUploaded"
    />
    
    <!-- Chunks Viewer Dialog -->
    <TextbookChunksDialog
      :visible.sync="showChunksDialog"
      :textbook="selectedTextbook"
    />
    
    <!-- Topics Viewer Dialog -->
    <TextbookTopicsDialog
      :visible.sync="showTopicsDialog"
      :textbook="selectedTextbook"
    />
    
    <!-- Processing Status Dialog -->
    <ProcessingStatusDialog
      :visible.sync="showProcessingDialog"
      :textbook="processingTextbook"
    />
  </div>
</template>

<script>
import Api from "@/apis/api";
import HeaderBar from '../components/HeaderBar.vue'
import TextbookUploadDialog from '../components/TextbookUploadDialog.vue'
import TextbookChunksDialog from '../components/TextbookChunksDialog.vue'
import TextbookTopicsDialog from '../components/TextbookTopicsDialog.vue'
import ProcessingStatusDialog from '../components/ProcessingStatusDialog.vue'

export default {
  name: 'TextbookManagement',
  
  components: {
    HeaderBar,
    TextbookUploadDialog,
    TextbookChunksDialog,
    TextbookTopicsDialog,
    ProcessingStatusDialog
  },
  
  data() {
    return {
      loading: false,
      textbooks: [],
      selectedTextbooks: [],
      
      // Pagination
      currentPage: 1,
      pageSize: 20,
      total: 0,
      
      // Filters
      filters: {
        grade: '',
        subject: '',
        status: '',
        search: ''
      },
      
      // Options
      grades: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      subjects: ['Math', 'Science', 'English', 'Hindi', 'History', 'Geography', 'Computer'],
      
      // Statistics
      stats: {
        totalTextbooks: 0,
        processedTextbooks: 0,
        processingTextbooks: 0,
        failedTextbooks: 0,
        totalFileSize: 0
      },
      
      // Dialogs
      showUploadDialog: false,
      showChunksDialog: false,
      showTopicsDialog: false,
      showProcessingDialog: false,
      selectedTextbook: null,
      processingTextbook: null,
      
      // Auto refresh
      refreshTimer: null
    }
  },
  
  mounted() {
    this.loadTextbooks()
    this.loadStatistics()
    
    // Auto refresh every 30 seconds
    this.refreshTimer = setInterval(() => {
      this.loadTextbooks(true)
      this.loadStatistics()
    }, 30000)
  },
  
  beforeDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
    }
  },
  
  methods: {
    loadTextbooks(silent = false) {
      if (!silent) this.loading = true
      
      const params = {
        page: this.currentPage - 1,
        size: this.pageSize,
        ...this.filters
      }
      
      Api.textbook.getTextbooks(params, ({ data }) => {
        this.textbooks = data.content || []
        this.total = data.totalElements || 0
        if (!silent) this.loading = false
      })
    },
    
    loadStatistics() {
      Api.textbook.getTextbookStats(({ data }) => {
        this.stats = data || this.stats
      })
    },
    
    processTextbook(textbook) {
      Api.textbook.processTextbook(textbook.id, ({ data }) => {
        this.$message.success('Processing started')
        this.processingTextbook = textbook
        this.showProcessingDialog = true
        this.loadTextbooks()
      })
    },
    
    async deleteTextbook(textbook) {
      try {
        await this.$confirm(`Delete "${textbook.originalFilename}"?`, 'Confirm', {
          confirmButtonText: 'Delete',
          cancelButtonText: 'Cancel',
          type: 'warning'
        })
        
        Api.textbook.deleteTextbook(textbook.id, ({ data }) => {
          this.$message.success('Textbook deleted')
          this.loadTextbooks()
          this.loadStatistics()
        })
      } catch (error) {
        if (error !== 'cancel') {
          this.$message.error('Failed to delete textbook')
          console.error('Delete textbook error:', error)
        }
      }
    },
    
    viewChunks(textbook) {
      this.selectedTextbook = textbook
      this.showChunksDialog = true
    },
    
    viewTopics(textbook) {
      this.selectedTextbook = textbook
      this.showTopicsDialog = true
    },
    
    onTextbookUploaded() {
      this.loadTextbooks()
      this.loadStatistics()
    },
    
    refreshTextbooks() {
      this.loadTextbooks()
      this.loadStatistics()
    },
    
    filterTextbooks() {
      this.currentPage = 1
      this.loadTextbooks()
    },
    
    handleSelectionChange(selection) {
      this.selectedTextbooks = selection
    },
    
    handleSizeChange(size) {
      this.pageSize = size
      this.loadTextbooks()
    },
    
    handleCurrentChange(page) {
      this.currentPage = page
      this.loadTextbooks()
    },
    
    getStatusType(status) {
      const types = {
        'uploaded': 'warning',
        'processing': 'primary',
        'processed': 'success',
        'failed': 'danger'
      }
      return types[status] || 'info'
    },
    
    formatFileSize(bytes) {
      if (!bytes) return '0 B'
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(1024))
      return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
    },
    
    formatDate(dateString) {
      if (!dateString) return '-'
      const date = new Date(dateString)
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
    }
  }
}
</script>

<style lang="scss" scoped>
.textbook-management {
  min-height: 100vh;
  background-color: #f5f7fa;
  
  .content-wrapper {
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
  }
  
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    
    .page-title {
      font-size: 28px;
      font-weight: 600;
      color: #303133;
      margin: 0;
    }
    
    .header-actions {
      display: flex;
      gap: 10px;
    }
  }
  
  .stats-row {
    margin-bottom: 20px;
    
    .stat-card {
      .stat-content {
        display: flex;
        align-items: center;
        padding: 10px;
        
        .stat-icon {
          font-size: 40px;
          margin-right: 15px;
          
          &.books { color: #409EFF; }
          &.processed { color: #67C23A; }
          &.processing { color: #E6A23C; }
          &.storage { color: #909399; }
        }
        
        .stat-info {
          flex: 1;
          
          .stat-value {
            font-size: 24px;
            font-weight: 600;
            color: #303133;
            line-height: 1.2;
          }
          
          .stat-label {
            font-size: 14px;
            color: #909399;
            margin-top: 4px;
          }
        }
      }
    }
  }
  
  .filter-card {
    margin-bottom: 20px;
    
    .el-select, .el-input {
      width: 100%;
    }
  }
  
  .table-card {
    .textbook-name {
      display: flex;
      align-items: center;
      gap: 8px;
      
      .name {
        font-weight: 500;
        color: #303133;
      }
    }
    
    .pagination {
      margin-top: 20px;
      text-align: right;
    }
  }
}
</style>