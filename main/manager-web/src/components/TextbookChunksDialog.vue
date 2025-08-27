<template>
  <el-dialog
    :title="`📖 Textbook Chunks - ${textbook ? textbook.originalFilename : ''}`"
    :visible.sync="dialogVisible"
    width="90%"
    :close-on-click-modal="false"
  >
    <div v-if="textbook" class="chunks-viewer">
      <!-- Textbook Info -->
      <el-card class="info-card">
        <el-row :gutter="20">
          <el-col :span="6">
            <div class="info-item">
              <span class="info-label">Grade:</span>
              <span class="info-value">{{ textbook.grade || '-' }}</span>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="info-item">
              <span class="info-label">Subject:</span>
              <span class="info-value">{{ textbook.subject || '-' }}</span>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="info-item">
              <span class="info-label">Total Pages:</span>
              <span class="info-value">{{ textbook.totalPages || '-' }}</span>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="info-item">
              <span class="info-label">Total Chunks:</span>
              <span class="info-value">{{ chunks.length }}</span>
            </div>
          </el-col>
        </el-row>
      </el-card>
      
      <!-- Search Bar -->
      <el-card class="search-card">
        <el-input
          v-model="searchQuery"
          placeholder="Search in chunks..."
          prefix-icon="el-icon-search"
          clearable
        />
      </el-card>
      
      <!-- Chunks Table -->
      <el-table 
        :data="filteredChunks" 
        v-loading="loading"
        max-height="500"
        style="width: 100%"
      >
        <el-table-column type="expand">
          <template slot-scope="props">
            <div class="chunk-content">
              <pre>{{ props.row.content }}</pre>
            </div>
          </template>
        </el-table-column>
        
        <el-table-column prop="chunkIndex" label="Index" width="80" />
        
        <el-table-column prop="pageNumber" label="Page" width="80">
          <template slot-scope="scope">
            {{ scope.row.pageNumber || '-' }}
          </template>
        </el-table-column>
        
        <el-table-column prop="chapterTitle" label="Chapter" width="200">
          <template slot-scope="scope">
            {{ scope.row.chapterTitle || '-' }}
          </template>
        </el-table-column>
        
        <el-table-column prop="content" label="Content Preview">
          <template slot-scope="scope">
            <div class="content-preview">
              {{ getContentPreview(scope.row.content) }}
            </div>
          </template>
        </el-table-column>
        
        <el-table-column prop="embeddingStatus" label="Embedding" width="120">
          <template slot-scope="scope">
            <el-tag :type="getEmbeddingStatusType(scope.row.embeddingStatus)">
              {{ scope.row.embeddingStatus }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
      
      <!-- Statistics -->
      <el-card class="stats-card">
        <el-row :gutter="20">
          <el-col :span="8">
            <el-statistic title="Embedded Chunks" :value="embeddedCount" />
          </el-col>
          <el-col :span="8">
            <el-statistic title="Pending Chunks" :value="pendingCount" />
          </el-col>
          <el-col :span="8">
            <el-statistic title="Failed Chunks" :value="failedCount" />
          </el-col>
        </el-row>
      </el-card>
    </div>
    
    <!-- Dialog Footer -->
    <span slot="footer" class="dialog-footer">
      <el-button @click="exportChunks" type="primary" icon="el-icon-download">
        Export Chunks
      </el-button>
      <el-button @click="dialogVisible = false">Close</el-button>
    </span>
  </el-dialog>
</template>

<script>
export default {
  name: 'TextbookChunksDialog',
  
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    textbook: {
      type: Object,
      default: null
    }
  },
  
  data() {
    return {
      dialogVisible: false,
      loading: false,
      chunks: [],
      searchQuery: ''
    }
  },
  
  computed: {
    filteredChunks() {
      if (!this.searchQuery) return this.chunks
      
      const query = this.searchQuery.toLowerCase()
      return this.chunks.filter(chunk => 
        chunk.content?.toLowerCase().includes(query) ||
        chunk.chapterTitle?.toLowerCase().includes(query)
      )
    },
    
    embeddedCount() {
      return this.chunks.filter(c => c.embeddingStatus === 'uploaded').length
    },
    
    pendingCount() {
      return this.chunks.filter(c => c.embeddingStatus === 'pending').length
    },
    
    failedCount() {
      return this.chunks.filter(c => c.embeddingStatus === 'failed').length
    }
  },
  
  watch: {
    visible(newVal) {
      this.dialogVisible = newVal
      if (newVal && this.textbook) {
        this.loadChunks()
      }
    },
    dialogVisible(newVal) {
      this.$emit('update:visible', newVal)
    },
    textbook(newVal) {
      if (newVal && this.dialogVisible) {
        this.loadChunks()
      }
    }
  },
  
  methods: {
    async loadChunks() {
      if (!this.textbook) return
      
      this.loading = true
      try {
        const response = await this.$http.get(`/api/textbooks/${this.textbook.id}/chunks`)
        this.chunks = response.data || []
      } catch (error) {
        console.error('Load chunks error:', error)
        this.$message.error('Failed to load chunks')
      } finally {
        this.loading = false
      }
    },
    
    getContentPreview(content) {
      if (!content) return ''
      return content.length > 150 ? content.substring(0, 150) + '...' : content
    },
    
    getEmbeddingStatusType(status) {
      const types = {
        'pending': 'warning',
        'generated': 'primary',
        'uploaded': 'success',
        'failed': 'danger'
      }
      return types[status] || 'info'
    },
    
    exportChunks() {
      if (!this.chunks.length) {
        this.$message.warning('No chunks to export')
        return
      }
      
      const data = this.chunks.map(chunk => ({
        index: chunk.chunkIndex,
        page: chunk.pageNumber,
        chapter: chunk.chapterTitle,
        content: chunk.content,
        status: chunk.embeddingStatus
      }))
      
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${this.textbook.filename}_chunks.json`
      link.click()
      URL.revokeObjectURL(url)
      
      this.$message.success('Chunks exported successfully')
    }
  }
}
</script>

<style lang="scss" scoped>
.chunks-viewer {
  .info-card {
    margin-bottom: 15px;
    
    .info-item {
      display: flex;
      align-items: center;
      
      .info-label {
        font-weight: 500;
        color: #606266;
        margin-right: 8px;
      }
      
      .info-value {
        color: #303133;
      }
    }
  }
  
  .search-card {
    margin-bottom: 15px;
  }
  
  .chunk-content {
    padding: 15px;
    background: #f5f7fa;
    border-radius: 4px;
    
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
    }
  }
  
  .content-preview {
    font-size: 13px;
    line-height: 1.4;
    color: #606266;
  }
  
  .stats-card {
    margin-top: 15px;
  }
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
}
</style>