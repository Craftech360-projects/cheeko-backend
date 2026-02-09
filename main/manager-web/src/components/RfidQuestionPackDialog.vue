<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="680px"
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

      <el-form :model="form" :rules="rules" ref="form" label-width="120px" label-position="left" class="rfid-form">
        <!-- Pack Metadata -->
        <el-form-item label="Pack Code" prop="packCode" class="form-item">
          <el-input v-model="form.packCode" placeholder="e.g., AN123456" maxlength="8" show-word-limit class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Pack Name" prop="name" class="form-item">
          <el-input v-model="form.name" placeholder="e.g., Animal Questions Pack" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Description" prop="description" class="form-item">
          <el-input type="textarea" v-model="form.description" placeholder="Brief description of this Q&A pack" :rows="2" class="custom-textarea"></el-input>
        </el-form-item>

        <el-form-item label="Category" prop="category" class="form-item">
          <el-select v-model="form.category" placeholder="Select category" class="custom-select" allow-create filterable>
            <el-option label="Animals" value="animals"/>
            <el-option label="Math" value="math"/>
            <el-option label="Story" value="story"/>
            <el-option label="Colors" value="colors"/>
            <el-option label="Numbers" value="numbers"/>
            <el-option label="Alphabet" value="alphabet"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Language" prop="language" class="form-item">
          <el-select v-model="form.language" placeholder="Select language" class="custom-select">
            <el-option label="English" value="en"/>
            <el-option label="Hindi" value="hi"/>
            <el-option label="Chinese" value="zh"/>
          </el-select>
        </el-form-item>

        <div class="form-row">
          <el-form-item label="Status" prop="status" class="form-item half-width">
            <el-select v-model="form.status" placeholder="Status" class="custom-select">
              <el-option label="Draft" value="draft"/>
              <el-option label="Published" value="published"/>
            </el-select>
          </el-form-item>

          <el-form-item label="Version" prop="version" class="form-item half-width">
            <el-input-number v-model="form.version" :min="1" class="custom-input-number"></el-input-number>
          </el-form-item>
        </div>

        <!-- Question Selection -->
        <!-- Questions Section -->
        <div class="questions-section">
          <!-- CREATE MODE: Inline Questions -->
          <template v-if="!form.id">
            <div class="section-header">
              <span class="section-title">📝 Questions (Max 10)</span>
              <el-button size="mini" type="primary" icon="el-icon-plus" @click="addQuestion" :disabled="(form.questions || []).length >= 10">Add Question</el-button>
            </div>
            
            <div class="inline-questions-list">
               <div v-for="(q, idx) in (form.questions || [])" :key="idx" class="question-row">
                  <div class="q-seq">{{ idx + 1 }}</div>
                  <div class="q-inputs">
                      <el-input v-model="q.text" placeholder="Question Text (Required)" size="small" class="mb-2"></el-input>
                      <el-input v-model="q.audio" placeholder="Audio URL (Optional)" size="small">
                         <template slot="prepend"><i class="el-icon-mic"></i></template>
                         <el-button slot="append" :icon="playingUrl === q.audio ? 'el-icon-video-pause' : 'el-icon-video-play'" @click="toggleAudio(q.audio)" v-if="q.audio"></el-button>
                      </el-input>
                  </div>
                  <el-button type="text" icon="el-icon-delete" class="text-danger" @click="removeQuestion(idx)"></el-button>
               </div>
               <div v-if="(!form.questions || form.questions.length === 0)" class="empty-state-text">
                  Click 'Add Question' to define questions for this pack.
               </div>
            </div>
          </template>

          <!-- EDIT MODE: Linked Questions with Inline Edit -->
          <template v-else>
            <div class="section-header">
              <span class="section-title">📝 Linked Questions (Max 10)</span>
              <div>
                <span class="question-count" style="margin-right: 8px">{{ localQuestions.length }}/10</span>
                <el-button size="mini" type="success" icon="el-icon-plus" @click="addNewLinkedQuestion" :disabled="localQuestions.length >= 10">Create New</el-button>
              </div>
            </div>

            <!-- Add Existing Question -->
             <div style="margin-bottom: 15px; display: flex; gap: 10px;">
                <el-select 
                  v-model="selectedQuestionToAdd" 
                  placeholder="Link existing question..." 
                  class="custom-select" 
                  filterable 
                  style="flex: 1"
                  :disabled="localQuestions.length >= 10"
                  @change="addLinkedQuestion"
                  value-key="id">
                  <el-option
                    v-for="q in availableQuestions"
                    :key="q.id"
                    :label="`${q.code} - ${q.title}`"
                    :value="q.id"/>
                </el-select>
             </div>

            <div class="inline-questions-list">
               <div v-for="(q, idx) in localQuestions" :key="idx" class="question-row">
                  <div class="q-seq">{{ idx + 1 }}</div>
                  <div class="q-inputs">
                      <!-- Editable Prompt Text -->
                      <el-input v-model="q.promptText" placeholder="Question Text" size="small" class="mb-2">
                         <template slot="prepend">Prompt</template>
                      </el-input>
                      <!-- Editable Audio URL -->
                      <el-input v-model="q.cachedAudioUrl" placeholder="Audio URL" size="small">
                         <template slot="prepend"><i class="el-icon-mic"></i> URL</template>
                         <el-button slot="append" :icon="playingUrl === q.cachedAudioUrl ? 'el-icon-video-pause' : 'el-icon-video-play'" @click="toggleAudio(q.cachedAudioUrl)" v-if="q.cachedAudioUrl"></el-button>
                      </el-input>
                      <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                          Code: {{ q.code || 'PENDING' }} <span v-if="q.id">(ID: {{ q.id }})</span>
                      </div>
                  </div>
                  <el-button type="text" icon="el-icon-delete" class="text-danger" @click="removeLinkedQuestion(idx)"></el-button>
               </div>
               <div v-if="localQuestions.length === 0" class="empty-state-text">
                  No questions linked. Create new or select existing above.
               </div>
            </div>
          </template>
        </div>

        <el-form-item label="Active" prop="active" class="form-item">
          <el-switch v-model="form.active"></el-switch>
        </el-form-item>
      </el-form>

      <div class="dialog-footer">
        <el-button
          type="primary"
          @click="submit"
          class="save-btn"
          :loading="saving"
          :disabled="saving">
          Save Q&A Pack
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
      default: 'Add Q&A Pack'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        id: null,
        packCode: '',
        name: '',
        description: '',
        questionIds: [],
        language: 'en',
        category: '',
        status: 'draft',
        version: 1,
        active: true,
        questions: [] // For inline creation
      })
    },
    questions: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      dialogKey: Date.now(),
      saving: false,
      localQuestions: [], // For Edit Mode: Stores full question objects
      selectedQuestionToAdd: null,
      currentAudio: null,
      playingUrl: null,
      rules: {
        packCode: [
          { required: true, message: "Please enter pack code", trigger: "blur" },
          { max: 8, message: "Pack code must be 8 characters or less", trigger: "blur" }
        ],
        name: [
          { required: true, message: "Please enter pack name", trigger: "blur" }
        ]
      }
    };
  },
  computed: {
    availableQuestions() {
        // Filter out already selected questions
        const selectedIds = this.localQuestions.map(q => q.id).filter(id => id !== null);
        return this.questions.filter(q => !selectedIds.includes(q.id));
    }
  },
  methods: {
    // Create Mode Methods
    addQuestion() {
        if (!this.form.questions) this.$set(this.form, 'questions', []);
        if (this.form.questions.length < 10) {
            this.form.questions.push({ text: '', audio: '' });
        }
    },
    removeQuestion(index) {
        this.form.questions.splice(index, 1);
    },

    // Edit Mode Methods
    initLocalQuestions() {
        if (this.form.id && this.form.questionIds) {
            this.localQuestions = this.form.questionIds.map(id => {
                const q = this.questions.find(item => item.id === id);
                if (q) {
                    // Deep clone to avoid mutating prop directly and to allow diffing later if needed
                    return JSON.parse(JSON.stringify(q));
                }
                // Fallback for ID not found in dropdown
                return { id, promptText: 'Unknown Question', cachedAudioUrl: '', code: '?' };
            }).filter(q => !!q);
        } else {
            this.localQuestions = [];
        }
    },
    addLinkedQuestion(id) {
        if(!id) return;
        const q = this.questions.find(item => item.id === id);
        if (q) {
            this.localQuestions.push(JSON.parse(JSON.stringify(q)));
        }
        this.selectedQuestionToAdd = null;
    },
    addNewLinkedQuestion() {
        if (this.localQuestions.length < 10) {
            // Add a new pending question
            this.localQuestions.push({ 
                id: null, 
                promptText: '', 
                cachedAudioUrl: '', 
                code: '', // Will be generated or labeled PENDING
                language: this.form.language 
            });
        }
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
    removeLinkedQuestion(index) {
        this.localQuestions.splice(index, 1);
    },


    submit() {
      this.$refs.form.validate((valid) => {
        if (valid) {
          // Validation based on mode
          if (!this.form.id) {
             // Add Mode: Check Inline Questions
             if (!this.form.questions || this.form.questions.length === 0) {
                 this.$message.warning("Please add at least one question.");
                 return;
             }
             if (this.form.questions.some(q => !q.text || !q.text.trim())) {
                 this.$message.warning("All questions must have text.");
                 return;
             }
          } else {
             // Edit Mode: Check localQuestions
             if (this.localQuestions.length === 0) {
                 this.$message.warning("Please link or create at least one question.");
                 return;
             }
             if (this.localQuestions.some(q => !q.promptText || !q.promptText.trim())) {
                 this.$message.warning("All questions must have prompt text.");
                 return;
             }
             
             // Sync only EXISTING IDs to form for now. New ones (id=null) will be handled by parent.
             this.form.questionIds = this.localQuestions
                 .filter(q => q.id !== null)
                 .map(q => q.id);
          }

          this.saving = true;
          this.$emit('submit', {
            form: this.form,
            questionsToProcess: this.form.id ? this.localQuestions : [], // Dictionary of questions including new ones
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
        this.initLocalQuestions();
      } else {
        this.stopAudio();
      }
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
    letter-spacing: 0.5px;
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
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

    &:hover {
      color: #ffffff;
      background: #ef4444;
      transform: rotate(90deg);
      box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);
    }
  }

  .rfid-form {
    .form-item {
      margin-bottom: 20px;

      :deep(.el-form-item__label) {
        color: #475569;
        font-weight: 500;
        padding-right: 12px;
        text-align: right;
        font-size: 14px;
      }
    }

    .form-row {
      display: flex;
      gap: 16px;

      .half-width {
        flex: 1;
      }
    }

    .custom-input {
      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        height: 42px;
        padding: 0 14px;
        transition: all 0.3s;
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

        &:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
      }
    }

    .custom-input-number {
      width: 100%;

      :deep(.el-input__inner) {
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        height: 42px;
      }
    }
  }

  .questions-section {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
    border: 1px solid #e2e8f0;

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }

    .question-count {
      font-size: 14px;
      font-weight: 500;
      color: #64748b;
      background: #f1f5f9;
      padding: 4px 12px;
      border-radius: 12px;
    }

    .field-hint {
      margin-top: 8px;
      font-size: 12px;
      color: #64748b;
      font-style: italic;
    }

    .inline-questions-list {
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      padding: 16px;
      max-height: 400px;
      overflow-y: auto;
      margin-top: 10px;
    }

    .question-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e2e8f0;

      &:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }

      .q-seq {
        width: 24px;
        height: 24px;
        background: #3b82f6;
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        flex-shrink: 0;
        margin-top: 2px;
      }

      .q-inputs {
        flex: 1;
        .mb-2 { margin-bottom: 8px; }
      }
    }

    .empty-state-text {
      text-align: center;
      color: #94a3b8;
      font-style: italic;
      padding: 20px;
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: center;
    padding: 16px 0 0;
    margin-top: 16px;

    .save-btn {
      width: 160px;
      height: 42px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      background: #3b82f6;
      color: white;
      border: none;

      &:hover {
        background: #2563eb;
        transform: translateY(-1px);
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
        color: #475569;
      }
    }
  }
}
</style>
