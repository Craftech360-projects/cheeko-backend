<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="600px"
    class="rfid-dialog-wrapper"
    :append-to-body="true"
    :close-on-click-modal="false"
    :key="dialogKey"
    custom-class="custom-rfid-dialog"
    :show-close="false"
  >
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 class="dialog-title">{{ title }}</h2>
        <button class="custom-close-btn" @click="cancel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <el-form :model="form" :rules="rules" ref="form" label-width="130px" label-position="left" class="rfid-form">
        <el-form-item label="Pack Code" prop="packCode" class="form-item">
          <el-input v-model="form.packCode" placeholder="e.g., AB123456" maxlength="8" show-word-limit class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Name" prop="name" class="form-item">
          <el-input v-model="form.name" placeholder="Display name" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Description" prop="description" class="form-item">
          <el-input type="textarea" v-model="form.description" placeholder="Content pack description" :rows="2" class="custom-textarea"></el-input>
        </el-form-item>

        <el-form-item label="Content Type" prop="contentType" class="form-item">
          <el-select v-model="form.contentType" placeholder="Select type" class="custom-select">
            <el-option label="Story Pack" value="story_pack"/>
            <el-option label="Rhyme Pack" value="rhyme_pack"/>
            <el-option label="Habit Pack" value="habit_pack"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Language" prop="language" class="form-item">
          <el-select v-model="form.language" placeholder="Select language" class="custom-select">
            <el-option label="English" value="en"/>
            <el-option label="Hindi" value="hi"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Status" prop="status" class="form-item">
          <el-radio-group v-model="form.status" size="small">
            <el-radio-button label="draft">Draft</el-radio-button>
            <el-radio-button label="published">Published</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="Version" prop="version" class="form-item">
           <el-input-number v-model="form.version" :min="1" size="small"></el-input-number>
        </el-form-item>

        <!-- Dynamic Items Table -->
        <div class="items-section">
           <div class="items-header">
              <span class="items-title">Pack Items (Max 10)</span>
              <el-button size="mini" type="primary" icon="el-icon-plus" @click="addItem" :disabled="form.items.length >= 10">Add Item</el-button>
           </div>
           
           <div class="items-list">
              <div v-for="(item, index) in form.items" :key="index" class="item-row">
                  <div class="item-col seq-col">
                     <span class="seq-badge">{{ index + 1 }}</span>
                  </div>
                  <div class="item-col main-col">
                      <div class="inputs-wrapper" style="flex: 1; min-width: 0;">
                          <el-input v-model="item.title" placeholder="Title" size="small" class="mb-1"></el-input>
                          <el-input v-model="item.audioUrl" placeholder="Audio URL (https://...)" size="small" class="mb-1">
                              <template slot="prepend"><i class="el-icon-headset"></i></template>
                              <el-button slot="append" :icon="playingUrl === item.audioUrl ? 'el-icon-video-pause' : 'el-icon-video-play'" @click="toggleAudio(item.audioUrl)" v-if="item.audioUrl"></el-button>
                          </el-input>
                          <el-input v-model="item.imageUrl" placeholder="Image URL (Thumbnail)" size="small" class="mb-1">
                               <template slot="prepend"><i class="el-icon-picture"></i></template>
                          </el-input>
                          <el-input type="textarea" v-model="item.text" placeholder="Voice script / Text content" size="small" :rows="2" class="text-input">
                          </el-input>
                      </div>
                      <div v-if="item.imageUrl" class="img-preview-box">
                           <!-- Canvas for .bin files (LVGL RGB565 format) -->
                           <canvas v-if="isBinFile(item.imageUrl)"
                                   :ref="'canvas-' + index"
                                   class="bin-preview-canvas"
                                   @load="loadBinPreview(item.imageUrl, index)">
                           </canvas>
                           <!-- Regular image for png/jpg -->
                           <img v-else :src="item.imageUrl" alt="Preview" @error="handleImageError($event)"/>
                           <!-- Loading indicator for .bin -->
                           <div v-if="isBinFile(item.imageUrl) && binLoading[index]" class="bin-loading">
                             <i class="el-icon-loading"></i>
                           </div>
                           <!-- Error state for .bin -->
                           <div v-if="isBinFile(item.imageUrl) && binError[index]" class="bin-error">
                             <i class="el-icon-picture-outline"></i>
                             <span>.bin</span>
                           </div>
                      </div>
                  </div>
                  <div class="item-col action-col">
                      <el-button type="text" icon="el-icon-delete" class="text-danger" @click="removeItem(index)"></el-button>
                  </div>
              </div>
              <div v-if="form.items.length === 0" class="empty-items">
                  No items added. Click "Add Item" to start.
              </div>
           </div>
        </div>
      </el-form>

      <div class="dialog-footer">
        <el-button
          type="primary"
          @click="submit"
          class="save-btn"
          :loading="saving"
          :disabled="saving">
          Save
        </el-button>
        <el-button @click="cancel" class="cancel-btn">
          Cancel
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script>
export default {
  props: {
    title: {
      type: String,
      default: 'Add Content Pack'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        packCode: '',
        name: '',
        description: '',
        contentType: 'story_pack', // Default to story pack
        language: 'en',
        status: 'draft',
        version: 1,
        active: true,
        items: [] // Structured Items
      })
    }
  },
  data() {
    return {
      dialogKey: Date.now(),
      saving: false,
      currentAudio: null,
      playingUrl: null,
      binLoading: {},  // Track loading state per item index
      binError: {},    // Track error state per item index
      binCache: {},    // Cache decoded .bin previews
      rules: {
        packCode: [
          { required: true, message: "Please enter pack code", trigger: "blur" },
          { max: 8, message: "Pack code must be 8 characters or less", trigger: "blur" }
        ],
        name: [
          { required: true, message: "Please enter name", trigger: "blur" }
        ]
      }
    };
  },
  methods: {
    addItem() {
        if (this.form.items.length < 10) {
            this.form.items.push({
                sequence: this.form.items.length + 1,
                title: '',
                audioUrl: '',
                imageUrl: '',
                text: ''  // Voice script / lyrics text
            });
        }
    },
    removeItem(index) {
        this.form.items.splice(index, 1);
        // Re-sequence
        this.form.items.forEach((item, idx) => {
            item.sequence = idx + 1;
        });
    },
    toggleAudio(url) {
      if (!url) return;
      
      if (this.playingUrl === url) {
        // Pause current
        if (this.currentAudio) {
            this.currentAudio.pause();
        }
        this.playingUrl = null;
      } else {
        // Stop previous
        this.stopAudio();
        
        // Play new
        this.currentAudio = new Audio(url);
        this.currentAudio.onended = () => {
          this.playingUrl = null;
        };
        this.currentAudio.play().catch(err => {
          console.error('Audio playback failed', err);
          this.$message.error('Could not play audio');
          this.playingUrl = null;
        });
        this.playingUrl = url;
      }
    },
    stopAudio() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        this.playingUrl = null;
    },
    // .bin file handling methods
    isBinFile(url) {
      return url && url.toLowerCase().endsWith('.bin');
    },
    handleImageError(event) {
      // Hide broken image
      event.target.style.display = 'none';
    },
    async loadBinPreview(url, index) {
      if (!url || !this.isBinFile(url)) return;

      // Check cache first
      if (this.binCache[url]) {
        this.renderCachedBin(url, index);
        return;
      }

      this.$set(this.binLoading, index, true);
      this.$set(this.binError, index, false);

      try {
        // Fetch the .bin file via proxy to avoid CORS issues
        const proxyUrl = `/toy/content/proxy?url=${encodeURIComponent(url)}`;

        // Get auth token from localStorage
        const storedToken = localStorage.getItem('token');
        const headers = {};
        if (storedToken) {
          try {
            const tokenData = JSON.parse(storedToken);
            headers['Authorization'] = `Bearer ${tokenData.token}`;
          } catch (e) {
            console.warn('Could not parse auth token');
          }
        }

        const response = await fetch(proxyUrl, { headers });
        if (!response.ok) throw new Error('Failed to fetch .bin file');

        const arrayBuffer = await response.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        // Parse LVGL v9 header (12 bytes)
        const magic = dataView.getUint8(0);
        const colorFormat = dataView.getUint8(1);
        const width = dataView.getUint16(4, true);  // Little endian
        const height = dataView.getUint16(6, true);
        const stride = dataView.getUint16(8, true);

        // Validate header
        if (magic !== 0x19) {
          console.warn('Invalid LVGL magic number:', magic);
          throw new Error('Invalid LVGL format');
        }

        // Only support RGB565 (0x12) for now
        if (colorFormat !== 0x12) {
          console.warn('Unsupported color format:', colorFormat);
          throw new Error('Unsupported color format');
        }

        // Create ImageData
        const imageData = new ImageData(width, height);
        const pixels = imageData.data;

        // Skip 12-byte header, read pixel data
        const pixelOffset = 12;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const srcIdx = pixelOffset + (y * stride) + (x * 2);
            const dstIdx = (y * width + x) * 4;

            // Read RGB565 (little endian)
            const rgb565 = dataView.getUint16(srcIdx, true);

            // Convert RGB565 to RGBA8888
            const r = ((rgb565 >> 11) & 0x1F) << 3;
            const g = ((rgb565 >> 5) & 0x3F) << 2;
            const b = (rgb565 & 0x1F) << 3;

            pixels[dstIdx] = r | (r >> 5);     // R
            pixels[dstIdx + 1] = g | (g >> 6); // G
            pixels[dstIdx + 2] = b | (b >> 5); // B
            pixels[dstIdx + 3] = 255;          // A
          }
        }

        // Cache the decoded image data
        this.binCache[url] = { imageData, width, height };

        // Render to canvas
        this.renderCachedBin(url, index);

      } catch (error) {
        console.error('Error loading .bin preview:', error);
        this.$set(this.binError, index, true);
      } finally {
        this.$set(this.binLoading, index, false);
      }
    },
    renderCachedBin(url, index) {
      const cached = this.binCache[url];
      if (!cached) return;

      this.$nextTick(() => {
        const canvasRef = this.$refs['canvas-' + index];
        const canvas = Array.isArray(canvasRef) ? canvasRef[0] : canvasRef;

        if (canvas) {
          canvas.width = cached.width;
          canvas.height = cached.height;
          const ctx = canvas.getContext('2d');
          ctx.putImageData(cached.imageData, 0, 0);
        }
      });
    },
    submit() {
      this.$refs.form.validate((valid) => {
        if (valid) {
          // Validate Items
          if (this.form.items.length === 0) {
              this.$message.warning("Please add at least one item to the pack.");
              return;
          }

          this.saving = true;
          this.$emit('submit', {
            form: this.form,
            done: () => {
              this.saving = false;
            }
          });
          setTimeout(() => {
             if (this.saving) this.saving = false;
          }, 5000);
        }
      });
    },
    cancel() {
      this.stopAudio();
      this.saving = false;
      this.$emit('cancel');
    }
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        this.dialogKey = Date.now();
        // Load bin previews for existing items
        this.$nextTick(() => {
          this.form.items.forEach((item, index) => {
            if (this.isBinFile(item.imageUrl)) {
              this.loadBinPreview(item.imageUrl, index);
            }
          });
        });
      } else {
        this.stopAudio();
        // Clear bin states
        this.binLoading = {};
        this.binError = {};
      }
    },
    'form.items': {
      handler(items) {
        // Watch for imageUrl changes to load bin previews
        items.forEach((item, index) => {
          if (this.isBinFile(item.imageUrl) && !this.binLoading[index] && !this.binCache[item.imageUrl]) {
            this.loadBinPreview(item.imageUrl, index);
          }
        });
      },
      deep: true
    }
  }
};
</script>

<style>
.custom-rfid-dialog {
  border-radius: 16px !important;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15) !important;
  border: none !important;
}
.custom-rfid-dialog .el-dialog__header {
  display: none;
}
.custom-rfid-dialog .el-dialog__body {
  padding: 0 !important;
  border-radius: 16px;
}
</style>

<style scoped lang="scss">
.rfid-dialog-wrapper {
  .dialog-container {
    padding: 24px 32px;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  }

  .dialog-header {
    position: relative;
    margin-bottom: 24px;
    text-align: center;
  }

  .dialog-title {
    font-size: 20px;
    color: #1e293b;
    margin: 0;
    padding: 0;
    font-weight: 600;
  }

  .custom-close-btn {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: #f1f5f9;
    color: #64748b;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    outline: none;
    transition: all 0.3s;

    &:hover {
      color: #ffffff;
      background: #ef4444;
      transform: rotate(90deg);
    }
  }

  .rfid-form {
    .form-item {
      margin-bottom: 20px;

      :deep(.el-form-item__label) {
        color: #475569;
        font-weight: 500;
        font-size: 14px;
      }
    }

    .custom-input {
      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        height: 42px;
        font-size: 14px;
        color: #334155;

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }

    .custom-select {
      width: 100%;

      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        height: 42px;
        font-size: 14px;
        color: #334155;

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }

    .custom-textarea {
      :deep(.el-textarea__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        padding: 12px 14px;
        font-size: 14px;
        color: #334155;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }

    .total-items-input {
      width: 160px;
    }

    .items-section {
        margin-top: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        background: #fff;
    }

    .items-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }
    
    .items-title {
        font-weight: 600;
        color: #475569;
        font-size: 14px;
    }

    .item-row {
        display: flex;
        gap: 12px;
        padding: 12px;
        border-bottom: 1px solid #f1f5f9;
        align-items: flex-start;
        
        &:last-child {
            border-bottom: none;
        }
    }

    .seq-col {
        width: 30px;
        padding-top: 8px;
    }
    
    .seq-badge {
        background: #e2e8f0;
        color: #64748b;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
    }

    .main-col {
        flex: 1;
        display: flex;
        flex-direction: row; /* Changed from column to row for side-by-side */
        gap: 12px;
    }

    .img-preview-box {
        width: 100px;
        height: 100px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        flex-shrink: 0;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;

        img {
            max-width: 100%;
            max-height: 100%;
            object-fit: cover;
        }

        .bin-preview-canvas {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            image-rendering: pixelated; /* Keep pixel art crisp */
        }

        .bin-loading {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(248, 250, 252, 0.9);
            color: #3b82f6;
            font-size: 20px;
        }

        .bin-error {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: #fef2f2;
            color: #ef4444;

            i {
                font-size: 24px;
                margin-bottom: 4px;
            }

            span {
                font-size: 10px;
                font-weight: 600;
            }
        }
    }

    .action-col {
        width: 30px;
        padding-top: 8px;
    }

    .mb-1 {
        margin-bottom: 4px;
    }

    .text-input {
        :deep(.el-textarea__inner) {
            background-color: #f8fafc;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
            font-size: 12px;
            color: #475569;
            resize: none;

            &:focus {
                border-color: #3b82f6;
                background-color: #ffffff;
            }
        }
    }

    .empty-items {
        text-align: center;
        padding: 20px;
        color: #94a3b8;
        font-size: 13px;
        font-style: italic;
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: center;
    padding: 16px 0 0;
    margin-top: 16px;

    .save-btn {
      width: 120px;
      height: 42px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      background: #3b82f6;
      color: white;
      border: none;

      &:hover {
        background: #2563eb;
      }
    }

    .cancel-btn {
      width: 120px;
      height: 42px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      background: #ffffff;
      color: #64748b;
      border: 1px solid #e2e8f0;
      margin-left: 16px;

      &:hover {
        background: #f8fafc;
      }
    }
  }
}
</style>
