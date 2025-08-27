<template>
  <el-dialog
    title="⚙️ Processing Status"
    :visible.sync="dialogVisible"
    width="600px"
    :close-on-click-modal="false"
  >
    <div v-if="textbook" class="processing-status">
      <!-- Textbook Info -->
      <el-card class="textbook-info">
        <h3>{{ textbook.originalFilename }}</h3>
        <p class="meta-info">
          <span>Grade: {{ textbook.grade || 'N/A' }}</span>
          <span>Subject: {{ textbook.subject || 'N/A' }}</span>
          <span>Pages: {{ textbook.totalPages || 'N/A' }}</span>
        </p>
      </el-card>
      
      <!-- Processing Steps -->
      <el-card class="steps-card">
        <el-steps :active="currentStep" finish-status="success" process-status="process">
          <el-step 
            title="File Upload" 
            description="PDF uploaded successfully"
            icon="el-icon-upload"
          />
          <el-step 
            title="Text Extraction" 
            :description="extractionDescription"
            icon="el-icon-document"
          />
          <el-step 
            title="Chunking" 
            :description="chunkingDescription"
            icon="el-icon-menu"
          />
          <el-step 
            title="Embedding Generation" 
            :description="embeddingDescription"
            icon="el-icon-cpu"
          />
          <el-step 
            title="Vector Storage" 
            :description="storageDescription"
            icon="el-icon-folder-checked"
          />
        </el-steps>
      </el-card>
      
      <!-- Progress Details -->
      <el-card class="progress-card" v-if="processingDetails">
        <el-row :gutter="20">
          <el-col :span="12">
            <div class="progress-item">
              <div class="progress-label">Overall Progress</div>
              <el-progress 
                :percentage="overallProgress" 
                :status="progressStatus"
                :stroke-width="8"
              />
            </div>
          </el-col>
          <el-col :span="12">
            <div class="progress-item">
              <div class="progress-label">Chunks Processed</div>
              <el-progress 
                :percentage="chunksProgress" 
                :status="chunksProgressStatus"
                :stroke-width="8"
              />
              <div class="progress-text">
                {{ processedChunks }} / {{ totalChunks }} chunks
              </div>
            </div>
          </el-col>
        </el-row>
        
        <!-- Processing Logs -->
        <div class="logs-section" v-if="logs.length">
          <h4>Processing Logs</h4>
          <div class="logs-container">
            <div 
              v-for="(log, index) in logs" 
              :key="index"
              :class="['log-entry', log.level]"
            >
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </div>
      </el-card>
      
      <!-- Error Details -->
      <el-card v-if="errorDetails" class="error-card">
        <el-alert 
          title="Processing Error"
          :description="errorDetails"
          type="error"
          show-icon
          :closable="false"
        />
        <div class="error-actions">
          <el-button type="primary" @click="retryProcessing">
            Retry Processing
          </el-button>
        </div>
      </el-card>
    </div>
    
    <!-- Dialog Footer -->
    <span slot="footer" class="dialog-footer">
      <el-button v-if="isProcessing" @click="stopProcessing" type="warning">
        Stop Processing
      </el-button>
      <el-button @click="dialogVisible = false">Close</el-button>
    </span>
  </el-dialog>
</template>

<script>
export default {
  name: 'ProcessingStatusDialog',
  
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
      statusTimer: null,
      processingDetails: null,
      logs: [],
      errorDetails: null
    }
  },
  
  computed: {
    currentStep() {
      if (!this.textbook) return 0
      
      const statusSteps = {
        'uploaded': 1,
        'extracting': 2,
        'chunking': 3,
        'embedding': 4,
        'processed': 5,
        'failed': this.getFailedStep()
      }
      
      return statusSteps[this.textbook.status] || 1
    },
    
    extractionDescription() {
      return this.currentStep >= 2 ? 'Text extracted from PDF' : 'Waiting...'
    },
    
    chunkingDescription() {
      return this.currentStep >= 3 ? `${this.totalChunks} chunks created` : 'Waiting...'
    },
    
    embeddingDescription() {
      return this.currentStep >= 4 ? 'Embeddings generated' : 'Waiting...'
    },
    
    storageDescription() {
      return this.currentStep >= 5 ? 'Stored in vector database' : 'Waiting...'
    },
    
    isProcessing() {
      return ['processing', 'extracting', 'chunking', 'embedding'].includes(this.textbook?.status)
    },
    
    overallProgress() {
      const steps = 5
      return Math.round((this.currentStep / steps) * 100)
    },
    
    progressStatus() {
      if (this.textbook?.status === 'failed') return 'exception'
      if (this.textbook?.status === 'processed') return 'success'
      return null
    },
    
    totalChunks() {
      return this.processingDetails?.totalChunks || this.textbook?.processedChunks || 0
    },
    
    processedChunks() {
      return this.processingDetails?.processedChunks || this.textbook?.processedChunks || 0
    },
    
    chunksProgress() {
      if (!this.totalChunks) return 0
      return Math.round((this.processedChunks / this.totalChunks) * 100)
    },
    
    chunksProgressStatus() {
      if (this.chunksProgress === 100) return 'success'
      return null
    }
  },
  
  watch: {
    visible(newVal) {
      this.dialogVisible = newVal
      if (newVal && this.textbook) {
        this.startStatusPolling()
      } else {
        this.stopStatusPolling()
      }
    },
    dialogVisible(newVal) {
      this.$emit('update:visible', newVal)
    }
  },
  
  methods: {
    startStatusPolling() {
      this.loadProcessingStatus()
      this.statusTimer = setInterval(() => {
        this.loadProcessingStatus()
      }, 2000) // Poll every 2 seconds
    },
    
    stopStatusPolling() {
      if (this.statusTimer) {
        clearInterval(this.statusTimer)
        this.statusTimer = null
      }
    },
    
    async loadProcessingStatus() {
      if (!this.textbook) return
      
      try {
        // Get updated textbook info
        const textbookResponse = await this.$http.get(`/api/textbooks/${this.textbook.id}`)
        const updatedTextbook = textbookResponse.data
        
        // Update parent component
        Object.assign(this.textbook, updatedTextbook)
        
        // Load processing details if available
        try {
          const statusResponse = await this.$http.get(`/api/textbooks/${this.textbook.id}/processing-status`)
          this.processingDetails = statusResponse.data
        } catch (error) {
          // Processing status endpoint might not exist, ignore error
        }
        
        // Stop polling if processing is complete
        if (['processed', 'failed'].includes(this.textbook.status)) {
          this.stopStatusPolling()
          
          if (this.textbook.status === 'failed') {
            this.errorDetails = 'Processing failed. Please check the file and try again.'
          }
        }
        
      } catch (error) {
        console.error('Load processing status error:', error)
      }
    },
    
    getFailedStep() {
      // Determine which step failed based on current progress
      if (this.textbook?.processedChunks > 0) return 4 // Failed during embedding
      if (this.textbook?.totalPages > 0) return 3 // Failed during chunking
      return 2 // Failed during extraction
    },
    
    async retryProcessing() {
      try {
        await this.$http.post(`/api/textbooks/${this.textbook.id}/process`)
        this.$message.success('Processing restarted')
        this.errorDetails = null
        this.startStatusPolling()
      } catch (error) {
        this.$message.error('Failed to retry processing')
      }
    },
    
    async stopProcessing() {
      try {
        await this.$confirm('Are you sure you want to stop processing?', 'Confirm', {
          type: 'warning'
        })
        
        // API to stop processing (if available)
        // await this.$http.post(`/api/textbooks/${this.textbook.id}/stop-processing`)
        
        this.$message.info('Processing stop requested')
        this.stopStatusPolling()
        
      } catch (error) {
        if (error !== 'cancel') {
          this.$message.error('Failed to stop processing')
        }
      }
    },
    
    formatTime(timestamp) {
      if (!timestamp) return ''
      const date = new Date(timestamp)
      return date.toLocaleTimeString()
    }
  },
  
  beforeDestroy() {
    this.stopStatusPolling()
  }
}
</script>

<style lang="scss" scoped>
.processing-status {
  .textbook-info {
    margin-bottom: 20px;
    
    h3 {
      margin: 0 0 10px;
      color: #303133;
      font-size: 18px;
    }
    
    .meta-info {
      margin: 0;
      color: #909399;
      font-size: 14px;
      
      span {
        margin-right: 15px;
      }
    }
  }
  
  .steps-card {
    margin-bottom: 20px;
    
    ::v-deep .el-steps {
      .el-step__title {
        font-size: 14px;
      }
      
      .el-step__description {
        font-size: 12px;
      }
    }
  }
  
  .progress-card {
    .progress-item {
      margin-bottom: 20px;
      
      .progress-label {
        font-weight: 500;
        color: #303133;
        margin-bottom: 8px;
      }
      
      .progress-text {
        font-size: 12px;
        color: #909399;
        text-align: center;
        margin-top: 5px;
      }
    }
    
    .logs-section {
      margin-top: 25px;
      
      h4 {
        margin: 0 0 10px;
        color: #303133;
        font-size: 14px;
      }
      
      .logs-container {
        max-height: 200px;
        overflow-y: auto;
        background: #f5f7fa;
        border-radius: 4px;
        padding: 10px;
        
        .log-entry {
          display: flex;
          margin-bottom: 5px;
          font-size: 12px;
          
          &:last-child {
            margin-bottom: 0;
          }
          
          .log-time {
            color: #909399;
            margin-right: 10px;
            min-width: 80px;
          }
          
          .log-message {
            flex: 1;
          }
          
          &.info .log-message {
            color: #303133;
          }
          
          &.success .log-message {
            color: #67C23A;
          }
          
          &.warning .log-message {
            color: #E6A23C;
          }
          
          &.error .log-message {
            color: #F56C6C;
          }
        }
      }
    }
  }
  
  .error-card {
    .error-actions {
      margin-top: 15px;
      text-align: center;
    }
  }
}
</style>