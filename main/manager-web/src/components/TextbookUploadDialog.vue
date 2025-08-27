<template>
  <el-dialog
    title="📤 Upload Textbook"
    :visible.sync="dialogVisible"
    width="600px"
    :close-on-click-modal="false"
    @close="resetForm"
  >
    <el-form ref="uploadForm" :model="formData" :rules="rules" label-width="120px">
      <!-- File Upload -->
      <el-form-item label="PDF Files" prop="files">
        <el-upload
          class="upload-area"
          drag
          :action="''"
          :auto-upload="false"
          :on-change="handleFileChange"
          :on-remove="handleFileRemove"
          :before-upload="beforeUpload"
          :file-list="fileList"
          accept=".pdf"
          multiple
        >
          <i class="el-icon-upload"></i>
          <div class="el-upload__text">Drop PDF files here or <em>click to upload</em></div>
          <div class="el-upload__tip" slot="tip">
            Only PDF files, maximum 50MB each. You can upload multiple PDFs at once.
          </div>
        </el-upload>
        
        <!-- Upload Progress -->
        <div v-if="uploadProgress.length > 0" class="upload-progress-section">
          <h4>Upload Progress</h4>
          <div v-for="(progress, index) in uploadProgress" :key="index" class="progress-item">
            <div class="progress-info">
              <span class="filename">{{ progress.filename }}</span>
              <span class="status" :class="progress.status">{{ progress.statusText }}</span>
            </div>
            <el-progress 
              :percentage="progress.percentage" 
              :status="progress.status === 'success' ? 'success' : progress.status === 'error' ? 'exception' : null"
            />
          </div>
        </div>
      </el-form-item>
      
      <!-- Grade Selection -->
      <el-form-item label="Grade" prop="grade">
        <el-select v-model="formData.grade" placeholder="Select grade">
          <el-option 
            v-for="grade in grades" 
            :key="grade" 
            :label="`Grade ${grade}`" 
            :value="grade"
          />
        </el-select>
      </el-form-item>
      
      <!-- Subject Selection -->
      <el-form-item label="Subject" prop="subject">
        <el-select v-model="formData.subject" placeholder="Select subject">
          <el-option 
            v-for="subject in subjects" 
            :key="subject" 
            :label="subject" 
            :value="subject.toLowerCase()"
          />
        </el-select>
      </el-form-item>
      
      <!-- Language Selection -->
      <el-form-item label="Language" prop="language">
        <el-select v-model="formData.language" placeholder="Select language">
          <el-option label="English" value="en" />
          <el-option label="Hindi" value="hi" />
          <el-option label="Telugu" value="te" />
          <el-option label="Tamil" value="ta" />
          <el-option label="Bengali" value="bn" />
          <el-option label="Marathi" value="mr" />
          <el-option label="Gujarati" value="gu" />
          <el-option label="Kannada" value="kn" />
          <el-option label="Malayalam" value="ml" />
          <el-option label="Punjabi" value="pa" />
        </el-select>
      </el-form-item>
      
      <!-- Auto Process -->
      <el-form-item label="Auto Process">
        <el-switch v-model="formData.autoProcess" />
        <span class="switch-label">
          Automatically process after upload
        </span>
      </el-form-item>
    </el-form>
    
    <!-- Dialog Footer -->
    <span slot="footer" class="dialog-footer">
      <el-button @click="dialogVisible = false">Cancel</el-button>
      <el-button 
        type="primary" 
        @click="uploadTextbook"
        :loading="uploading"
      >
        {{ uploading ? 'Uploading...' : `Upload ${formData.files.length > 1 ? formData.files.length + ' Files' : 'File'}` }}
      </el-button>
    </span>
  </el-dialog>
</template>

<script>
import Api from "@/apis/api";

export default {
  name: 'TextbookUploadDialog',
  
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  
  data() {
    return {
      dialogVisible: false,
      uploading: false,
      fileList: [],
      
      formData: {
        files: [],
        grade: '',
        subject: '',
        language: 'en',
        autoProcess: true
      },
      
      uploadProgress: [],
      
      rules: {
        files: [
          { required: true, message: 'Please select at least one PDF file', trigger: 'change' }
        ],
        grade: [
          { required: true, message: 'Please select grade', trigger: 'change' }
        ],
        subject: [
          { required: true, message: 'Please select subject', trigger: 'change' }
        ],
        language: [
          { required: true, message: 'Please select language', trigger: 'change' }
        ]
      },
      
      grades: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      subjects: ['Math', 'Science', 'English', 'Hindi', 'History', 'Geography', 
                 'Physics', 'Chemistry', 'Biology', 'Computer', 'Economics', 'Sanskrit']
    }
  },
  
  watch: {
    visible(newVal) {
      this.dialogVisible = newVal
    },
    dialogVisible(newVal) {
      this.$emit('update:visible', newVal)
    }
  },
  
  methods: {
    handleFileChange(file, fileList) {
      this.fileList = fileList
      this.formData.files = fileList.map(f => f.raw).filter(Boolean)
    },
    
    handleFileRemove(file, fileList) {
      this.fileList = fileList
      this.formData.files = fileList.map(f => f.raw).filter(Boolean)
    },
    
    beforeUpload(file) {
      const isPDF = file.type === 'application/pdf'
      const isLt50M = file.size / 1024 / 1024 < 50
      
      if (!isPDF) {
        this.$message.error('Only PDF files are allowed!')
        return false
      }
      
      if (!isLt50M) {
        this.$message.error('File size cannot exceed 50MB!')
        return false
      }
      
      return true
    },
    
    async uploadTextbook() {
      try {
        await this.$refs.uploadForm.validate()
        
        if (!this.formData.files || this.formData.files.length === 0) {
          this.$message.error('Please select at least one PDF file')
          return
        }
        
        this.uploading = true
        this.uploadProgress = []
        
        // Initialize progress tracking
        this.formData.files.forEach((file, index) => {
          this.uploadProgress.push({
            filename: file.name,
            percentage: 0,
            status: 'uploading',
            statusText: 'Uploading...'
          })
        })
        
        // Get username from localStorage
        const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}')
        const createdBy = userInfo.username || 'admin'
        
        let successCount = 0
        let failedFiles = []
        
        // Upload files one by one using the API pattern
        for (let index = 0; index < this.formData.files.length; index++) {
          const file = this.formData.files[index]
          
          try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('grade', this.formData.grade)
            formData.append('subject', this.formData.subject)
            formData.append('language', this.formData.language)
            formData.append('createdBy', createdBy)
            
            // Update progress to show uploading
            this.uploadProgress[index].percentage = 50
            this.uploadProgress[index].statusText = 'Uploading...'
            
            // Use API pattern for upload
            await new Promise((resolve, reject) => {
              Api.textbook.uploadTextbook(formData, ({ data }) => {
                // Update progress
                this.uploadProgress[index].percentage = 100
                this.uploadProgress[index].status = 'success'
                this.uploadProgress[index].statusText = 'Upload completed'
                
                successCount++
                
                // Auto process if enabled
                if (this.formData.autoProcess && data && data.id) {
                  this.uploadProgress[index].statusText = 'Processing...'
                  Api.textbook.processTextbook(data.id, () => {
                    this.uploadProgress[index].statusText = 'Processing started'
                  })
                }
                
                resolve(data)
              })
            })
            
          } catch (error) {
            console.error(`Upload error for ${file.name}:`, error)
            this.uploadProgress[index].status = 'error'
            this.uploadProgress[index].statusText = 'Upload failed'
            this.uploadProgress[index].percentage = 0
            failedFiles.push(file.name)
          }
        }
        
        // Show summary message
        if (successCount === this.formData.files.length) {
          this.$message.success(`All ${successCount} textbooks uploaded successfully!`)
          setTimeout(() => {
            this.dialogVisible = false
          }, 2000) // Auto close after 2 seconds
        } else if (successCount > 0) {
          this.$message({
            message: `${successCount} textbooks uploaded successfully, ${failedFiles.length} failed.`,
            type: 'warning',
            duration: 5000
          })
        } else {
          this.$message.error('All uploads failed. Please try again.')
        }
        
        // Emit uploaded event if any successful uploads
        if (successCount > 0) {
          this.$emit('uploaded', successCount)
        }
        
      } catch (error) {
        console.error('Batch upload error:', error)
        this.$message.error('Upload process failed')
      } finally {
        this.uploading = false
      }
    },
    
    resetForm() {
      this.$refs.uploadForm.resetFields()
      this.fileList = []
      this.formData.files = []
      this.formData.autoProcess = true
      this.uploadProgress = []
    }
  }
}
</script>

<style lang="scss" scoped>
.upload-area {
  width: 100%;
  
  ::v-deep .el-upload-dragger {
    width: 100%;
    height: 140px;
    
    .el-icon-upload {
      font-size: 48px;
      color: #C0C4CC;
      margin: 20px 0 16px;
    }
  }
}

.switch-label {
  margin-left: 10px;
  color: #606266;
  font-size: 14px;
}

.upload-progress-section {
  margin-top: 20px;
  padding: 15px;
  background: #f5f7fa;
  border-radius: 6px;
  
  h4 {
    margin: 0 0 15px;
    color: #303133;
    font-size: 14px;
    font-weight: 500;
  }
  
  .progress-item {
    margin-bottom: 15px;
    
    &:last-child {
      margin-bottom: 0;
    }
    
    .progress-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
      
      .filename {
        font-size: 13px;
        color: #303133;
        font-weight: 500;
        flex: 1;
        margin-right: 10px;
        word-break: break-all;
      }
      
      .status {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 12px;
        
        &.uploading {
          background: #e6f7ff;
          color: #1890ff;
        }
        
        &.success {
          background: #f6ffed;
          color: #52c41a;
        }
        
        &.error {
          background: #fff2f0;
          color: #ff4d4f;
        }
      }
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>