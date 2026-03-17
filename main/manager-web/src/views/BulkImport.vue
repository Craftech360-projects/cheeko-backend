<template>
  <div class="welcome">
    <HeaderBar />

    <div class="operation-bar">
      <h2 class="page-title">RFID Bulk Import</h2>
      <div class="right-operations">
        <el-button type="primary" icon="el-icon-download" @click="handleExport" :loading="exporting">
          Export Current Mappings
        </el-button>
      </div>
    </div>

    <div class="main-wrapper">
      <!-- Step 1: Upload -->
      <div class="upload-section" v-if="step === 'upload'">
        <div class="upload-card">
          <el-upload
            class="xlsx-uploader"
            drag
            action=""
            :auto-upload="false"
            :show-file-list="false"
            :on-change="handleFileSelected"
            accept=".xlsx,.xls"
          >
            <i class="el-icon-upload"></i>
            <div class="el-upload__text">
              Drag xlsx file here or <em>click to select</em>
            </div>
            <div class="el-upload__tip" slot="tip">
              Only .xlsx files with "Content" and "Card Mappings" sheets
            </div>
          </el-upload>

          <div v-if="selectedFile" class="selected-file">
            <i class="el-icon-document"></i>
            <span>{{ selectedFile.name }} ({{ formatSize(selectedFile.size) }})</span>
            <el-button type="text" icon="el-icon-close" @click="clearFile"></el-button>
          </div>

          <div class="upload-actions" v-if="selectedFile">
            <el-button type="primary" @click="handlePreview" :loading="previewing" icon="el-icon-view">
              Preview Import
            </el-button>
          </div>
        </div>
      </div>

      <!-- Step 2: Preview -->
      <div class="preview-section" v-if="step === 'preview' && previewData">
        <!-- Summary Cards -->
        <div class="summary-cards">
          <div class="summary-card">
            <div class="summary-icon packs"><i class="el-icon-notebook-2"></i></div>
            <div class="summary-content">
              <div class="summary-value">{{ previewData.summary.contentPacks.total }}</div>
              <div class="summary-label">Content Packs</div>
              <div class="summary-detail">
                <el-tag size="mini" type="success">{{ previewData.summary.contentPacks.new }} new</el-tag>
                <el-tag size="mini" type="info">{{ previewData.summary.contentPacks.mapped }} mapped</el-tag>
              </div>
            </div>
          </div>
          <div class="summary-card">
            <div class="summary-icon cards"><i class="el-icon-postcard"></i></div>
            <div class="summary-content">
              <div class="summary-value">{{ previewData.summary.cardMappings.total }}</div>
              <div class="summary-label">Card Mappings</div>
              <div class="summary-detail">
                <el-tag size="mini" type="success">{{ previewData.summary.cardMappings.new }} new</el-tag>
                <el-tag size="mini" type="info">{{ previewData.summary.cardMappings.mapped }} mapped</el-tag>
              </div>
            </div>
          </div>
          <div class="summary-card">
            <div class="summary-icon ai"><i class="el-icon-cpu"></i></div>
            <div class="summary-content">
              <div class="summary-value">{{ previewData.summary.cardMappings.aiCards }}</div>
              <div class="summary-label">AI Cards</div>
              <div class="summary-detail">
                <el-tag size="mini" type="success">{{ aiMappings.filter(m => m.status === 'new').length }} new</el-tag>
                <el-tag size="mini" type="info">{{ aiMappings.filter(m => m.status !== 'new').length }} mapped</el-tag>
              </div>
            </div>
          </div>
        </div>

        <!-- Content Packs Table -->
        <h3 class="section-title">Content Packs</h3>
        <el-table :data="previewData.content" border stripe size="small" max-height="300">
          <el-table-column prop="packCode" label="Pack Code" width="180"></el-table-column>
          <el-table-column prop="packName" label="Pack Name" width="200"></el-table-column>
          <el-table-column prop="contentType" label="Type" width="120"></el-table-column>
          <el-table-column prop="language" label="Lang" width="60"></el-table-column>
          <el-table-column prop="itemCount" label="Items" width="70"></el-table-column>
          <el-table-column prop="status" label="Status" width="120">
            <template slot-scope="scope">
              <el-tag :type="scope.row.status === 'new' ? 'success' : 'info'" size="mini">
                {{ scope.row.status === 'new' ? 'New' : 'Already Mapped' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <!-- Content Card Mappings Table -->
        <h3 class="section-title" style="margin-top: 20px;">Content Card Mappings</h3>
        <el-table :data="contentMappings" border stripe size="small" max-height="300">
          <el-table-column prop="rfidUid" label="RFID UID" width="120"></el-table-column>
          <el-table-column prop="mappedTo" label="Mapped To" width="200"></el-table-column>
          <el-table-column prop="packCode" label="Pack Code" width="180"></el-table-column>
          <el-table-column prop="notes" label="Notes" width="200"></el-table-column>
          <el-table-column prop="status" label="Status" width="120">
            <template slot-scope="scope">
              <el-tag :type="scope.row.status === 'new' ? 'success' : 'info'" size="mini">
                {{ scope.row.status === 'new' ? 'New' : 'Already Mapped' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <!-- AI Card Mappings Table -->
        <h3 class="section-title" style="margin-top: 20px;">AI Card Mappings</h3>
        <el-table :data="aiMappings" border stripe size="small" max-height="300">
          <el-table-column prop="rfidUid" label="RFID UID" width="120"></el-table-column>
          <el-table-column prop="agentName" label="Agent" width="200">
            <template slot-scope="scope">
              <el-tag v-if="scope.row.agentName" type="danger" size="mini">{{ scope.row.agentName }}</el-tag>
              <span v-else style="color: #999;">Default (Cheeko)</span>
            </template>
          </el-table-column>
          <el-table-column prop="notes" label="Notes" width="200"></el-table-column>
          <el-table-column prop="status" label="Status" width="120">
            <template slot-scope="scope">
              <el-tag :type="scope.row.status === 'new' ? 'success' : 'info'" size="mini">
                {{ scope.row.status === 'new' ? 'New' : 'Already Mapped' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <!-- Actions -->
        <div class="preview-actions">
          <el-button @click="goBack" icon="el-icon-back">Back</el-button>
          <el-button type="primary" @click="handleExecute" :loading="executing" icon="el-icon-check">
            Confirm &amp; Import
          </el-button>
        </div>
      </div>

      <!-- Step 3: Results -->
      <div class="results-section" v-if="step === 'results' && resultData">
        <div class="result-summary">
          <h3><i class="el-icon-circle-check" style="color: #67C23A;"></i> Import Complete</h3>

          <div class="result-grid">
            <div class="result-block">
              <h4>Content Packs</h4>
              <div class="result-stats">
                <span class="stat created">{{ resultData.summary.packs.created }} created</span>
                <span class="stat skipped">{{ resultData.summary.packs.skipped }} skipped</span>
                <span class="stat failed" v-if="resultData.summary.packs.failed">{{ resultData.summary.packs.failed }} failed</span>
              </div>
            </div>
            <div class="result-block">
              <h4>Card Mappings</h4>
              <div class="result-stats">
                <span class="stat created">{{ resultData.summary.mappings.created }} created</span>
                <span class="stat skipped">{{ resultData.summary.mappings.skipped }} skipped</span>
                <span class="stat failed" v-if="resultData.summary.mappings.failed">{{ resultData.summary.mappings.failed }} failed</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Detailed Results -->
        <el-collapse>
          <el-collapse-item title="Pack Details" name="packs">
            <el-table :data="resultData.results.packs" border stripe size="mini">
              <el-table-column prop="packCode" label="Pack Code"></el-table-column>
              <el-table-column prop="itemCount" label="Items"></el-table-column>
              <el-table-column prop="status" label="Status">
                <template slot-scope="scope">
                  <el-tag :type="statusTagType(scope.row.status)" size="mini">{{ scope.row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="error" label="Error">
                <template slot-scope="scope">
                  <span style="color: #F56C6C;">{{ scope.row.error || '' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
          <el-collapse-item title="Mapping Details" name="mappings">
            <el-table :data="resultData.results.mappings" border stripe size="mini">
              <el-table-column prop="rfidUid" label="RFID UID"></el-table-column>
              <el-table-column prop="cardType" label="Type"></el-table-column>
              <el-table-column prop="status" label="Status">
                <template slot-scope="scope">
                  <el-tag :type="statusTagType(scope.row.status)" size="mini">{{ scope.row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="error" label="Error">
                <template slot-scope="scope">
                  <span style="color: #F56C6C;">{{ scope.row.error || '' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>

        <div class="result-actions">
          <el-button type="primary" @click="resetAll" icon="el-icon-refresh">Import Another File</el-button>
          <el-button @click="handleExport" :loading="exporting" icon="el-icon-download">Export Mappings</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import HeaderBar from '../components/HeaderBar.vue';
import Api from '../apis/api';

export default {
  name: 'BulkImport',
  components: { HeaderBar },
  computed: {
    contentMappings() {
      if (!this.previewData) return [];
      return this.previewData.mappings.filter(m => m.cardType !== 'ai');
    },
    aiMappings() {
      if (!this.previewData) return [];
      return this.previewData.mappings.filter(m => m.cardType === 'ai');
    },
  },
  data() {
    return {
      step: 'upload', // upload → preview → results
      selectedFile: null,
      previewing: false,
      executing: false,
      exporting: false,
      previewData: null,
      resultData: null,
    };
  },
  methods: {
    getToken() {
      const stored = localStorage.getItem('token');
      if (!stored) return null;
      try { return JSON.parse(stored).token; } catch { return stored; }
    },

    formatSize(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    statusTagType(status) {
      if (status === 'created') return 'success';
      if (status === 'skipped') return 'info';
      if (status === 'failed') return 'danger';
      return 'info';
    },

    handleFileSelected(file) {
      this.selectedFile = file.raw;
    },

    clearFile() {
      this.selectedFile = null;
    },

    goBack() {
      this.step = 'upload';
      this.previewData = null;
    },

    resetAll() {
      this.step = 'upload';
      this.selectedFile = null;
      this.previewData = null;
      this.resultData = null;
    },

    async handlePreview() {
      if (!this.selectedFile) return;
      this.previewing = true;
      try {
        const formData = new FormData();
        formData.append('file', this.selectedFile);

        const response = await fetch(`${Api.getServiceUrl()}/admin/rfid/bulk-import/preview`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.getToken()}` },
          body: formData,
        });

        const data = await response.json();
        if (data.code === 0 && data.data) {
          this.previewData = data.data;
          this.step = 'preview';
        } else {
          this.$message.error(data.msg || 'Preview failed');
        }
      } catch (err) {
        this.$message.error('Failed to preview: ' + err.message);
      } finally {
        this.previewing = false;
      }
    },

    async handleExecute() {
      if (!this.selectedFile) return;

      try {
        await this.$confirm(
          `This will import ${this.previewData.summary.contentPacks.total} packs and ${this.previewData.summary.cardMappings.total} card mappings. Continue?`,
          'Confirm Import',
          { type: 'warning' }
        );
      } catch {
        return; // cancelled
      }

      this.executing = true;
      try {
        const formData = new FormData();
        formData.append('file', this.selectedFile);

        const response = await fetch(`${Api.getServiceUrl()}/admin/rfid/bulk-import/execute`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.getToken()}` },
          body: formData,
        });

        const data = await response.json();
        if (data.code === 0 && data.data) {
          this.resultData = data.data;
          this.step = 'results';
          this.$message.success('Import completed successfully!');
        } else {
          this.$message.error(data.msg || 'Import failed');
        }
      } catch (err) {
        this.$message.error('Import failed: ' + err.message);
      } finally {
        this.executing = false;
      }
    },

    async handleExport() {
      this.exporting = true;
      try {
        const response = await fetch(`${Api.getServiceUrl()}/admin/rfid/bulk-import/export`, {
          headers: { 'Authorization': `Bearer ${this.getToken()}` },
        });

        if (!response.ok) throw new Error('Export failed');

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rfid_card_mappings.xlsx';
        a.click();
        URL.revokeObjectURL(url);
        this.$message.success('Export downloaded');
      } catch (err) {
        this.$message.error('Export failed: ' + err.message);
      } finally {
        this.exporting = false;
      }
    },
  },
};
</script>

<style scoped>
.upload-section {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.upload-card {
  text-align: center;
  max-width: 500px;
  width: 100%;
}

.selected-file {
  margin-top: 16px;
  padding: 10px 16px;
  background: #f0f9eb;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.selected-file i {
  color: #67C23A;
  font-size: 18px;
}

.upload-actions {
  margin-top: 20px;
}

.summary-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #ebeef5;
}

.summary-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}

.summary-icon.packs { background: rgba(64, 158, 255, 0.1); color: #409EFF; }
.summary-icon.cards { background: rgba(103, 194, 58, 0.1); color: #67C23A; }
.summary-icon.ai { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }

.summary-value {
  font-size: 24px;
  font-weight: 700;
  color: #303133;
}

.summary-label {
  font-size: 13px;
  color: #909399;
}

.summary-detail {
  margin-top: 4px;
  display: flex;
  gap: 4px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}

.preview-actions, .result-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

.result-summary {
  text-align: center;
  padding: 24px 0;
}

.result-summary h3 {
  font-size: 20px;
  margin-bottom: 20px;
}

.result-grid {
  display: flex;
  justify-content: center;
  gap: 32px;
}

.result-block h4 {
  margin-bottom: 8px;
  color: #606266;
}

.result-stats {
  display: flex;
  gap: 12px;
}

.stat {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}

.stat.created { background: #f0f9eb; color: #67C23A; }
.stat.skipped { background: #f4f4f5; color: #909399; }
.stat.failed { background: #fef0f0; color: #F56C6C; }
</style>
