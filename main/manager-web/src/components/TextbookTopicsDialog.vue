<template>
  <el-dialog
    :title="`📋 Important Topics - ${textbook ? textbook.originalFilename : ''}`"
    :visible.sync="dialogVisible"
    width="80%"
    :close-on-click-modal="false"
  >
    <div v-if="textbook" class="topics-viewer">
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
              <span class="info-label">Language:</span>
              <span class="info-value">{{ textbook.language || 'en' }}</span>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="info-item">
              <span class="info-label">Total Topics:</span>
              <span class="info-value">{{ topics.length }}</span>
            </div>
          </el-col>
        </el-row>
      </el-card>
      
      <!-- Topic Categories -->
      <el-card class="categories-card">
        <h3>Topic Categories</h3>
        <div class="categories-grid">
          <div 
            v-for="category in categories" 
            :key="category.name"
            class="category-item"
            @click="filterByCategory(category.name)"
            :class="{ active: selectedCategory === category.name }"
          >
            <div class="category-icon">{{ category.icon }}</div>
            <div class="category-name">{{ category.name }}</div>
            <div class="category-count">{{ category.count }} topics</div>
          </div>
        </div>
      </el-card>
      
      <!-- Search and Filters -->
      <el-card class="filter-card">
        <el-row :gutter="15">
          <el-col :span="8">
            <el-input
              v-model="searchQuery"
              placeholder="Search topics..."
              prefix-icon="el-icon-search"
              clearable
            />
          </el-col>
          <el-col :span="6">
            <el-select v-model="selectedCategory" placeholder="All Categories" clearable>
              <el-option label="All Categories" value="" />
              <el-option 
                v-for="category in categories" 
                :key="category.name"
                :label="category.name" 
                :value="category.name"
              />
            </el-select>
          </el-col>
          <el-col :span="6">
            <el-select v-model="sortBy" placeholder="Sort by">
              <el-option label="Topic Name" value="name" />
              <el-option label="Importance" value="importance" />
              <el-option label="Page Number" value="page" />
              <el-option label="Chapter Order" value="chapter" />
            </el-select>
          </el-col>
          <el-col :span="4">
            <el-button type="primary" @click="generateTopicsSummary" icon="el-icon-cpu">
              AI Summary
            </el-button>
          </el-col>
        </el-row>
      </el-card>
      
      <!-- Topics List -->
      <el-card class="topics-card" v-loading="loading">
        <div class="topics-grid">
          <div 
            v-for="topic in filteredTopics" 
            :key="topic.id"
            class="topic-card"
            @click="selectTopic(topic)"
            :class="{ selected: selectedTopic?.id === topic.id }"
          >
            <div class="topic-header">
              <div class="topic-title">{{ topic.title }}</div>
              <el-tag 
                :type="getImportanceColor(topic.importance)" 
                size="mini"
              >
                {{ topic.importance }}
              </el-tag>
            </div>
            
            <div class="topic-meta">
              <span class="topic-category">{{ topic.category }}</span>
              <span class="topic-page">Page {{ topic.page || '-' }}</span>
            </div>
            
            <div class="topic-description">
              {{ topic.description }}
            </div>
            
            <div class="topic-keywords">
              <el-tag 
                v-for="keyword in topic.keywords.slice(0, 3)" 
                :key="keyword"
                size="mini"
                type="info"
              >
                {{ keyword }}
              </el-tag>
              <span v-if="topic.keywords.length > 3" class="more-keywords">
                +{{ topic.keywords.length - 3 }} more
              </span>
            </div>
          </div>
        </div>
        
        <!-- Empty State -->
        <el-empty v-if="filteredTopics.length === 0" description="No topics found" />
      </el-card>
      
      <!-- AI Generated Summary -->
      <el-card v-if="aiSummary" class="summary-card">
        <h3>🤖 AI Generated Summary</h3>
        <div class="summary-content">
          <p><strong>Key Learning Objectives:</strong></p>
          <ul>
            <li v-for="objective in aiSummary.objectives" :key="objective">{{ objective }}</li>
          </ul>
          
          <p><strong>Important Concepts Covered:</strong></p>
          <div class="concepts-tags">
            <el-tag 
              v-for="concept in aiSummary.concepts" 
              :key="concept"
              type="success"
            >
              {{ concept }}
            </el-tag>
          </div>
          
          <p><strong>Recommended Study Sequence:</strong></p>
          <ol>
            <li v-for="step in aiSummary.sequence" :key="step">{{ step }}</li>
          </ol>
        </div>
      </el-card>
    </div>
    
    <!-- Dialog Footer -->
    <span slot="footer" class="dialog-footer">
      <el-button @click="exportTopics" type="success" icon="el-icon-download">
        Export Topics
      </el-button>
      <el-button @click="generateStudyGuide" type="warning" icon="el-icon-document">
        Study Guide
      </el-button>
      <el-button @click="dialogVisible = false">Close</el-button>
    </span>
  </el-dialog>
</template>

<script>
export default {
  name: 'TextbookTopicsDialog',
  
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
      topics: [],
      selectedTopic: null,
      searchQuery: '',
      selectedCategory: '',
      sortBy: 'importance',
      aiSummary: null
    }
  },
  
  computed: {
    categories() {
      const categoryMap = {}
      
      this.topics.forEach(topic => {
        if (!categoryMap[topic.category]) {
          categoryMap[topic.category] = {
            name: topic.category,
            count: 0,
            icon: this.getCategoryIcon(topic.category)
          }
        }
        categoryMap[topic.category].count++
      })
      
      return Object.values(categoryMap)
    },
    
    filteredTopics() {
      let filtered = this.topics
      
      // Search filter
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase()
        filtered = filtered.filter(topic =>
          topic.title.toLowerCase().includes(query) ||
          topic.description.toLowerCase().includes(query) ||
          topic.keywords.some(k => k.toLowerCase().includes(query))
        )
      }
      
      // Category filter
      if (this.selectedCategory) {
        filtered = filtered.filter(topic => topic.category === this.selectedCategory)
      }
      
      // Sort
      filtered.sort((a, b) => {
        switch (this.sortBy) {
          case 'name':
            return a.title.localeCompare(b.title)
          case 'importance':
            const importanceOrder = { 'High': 3, 'Medium': 2, 'Low': 1 }
            return importanceOrder[b.importance] - importanceOrder[a.importance]
          case 'page':
            return (a.page || 0) - (b.page || 0)
          case 'chapter':
            return (a.chapterOrder || 0) - (b.chapterOrder || 0)
          default:
            return 0
        }
      })
      
      return filtered
    }
  },
  
  watch: {
    visible(newVal) {
      this.dialogVisible = newVal
      if (newVal && this.textbook) {
        this.loadTopics()
      }
    },
    dialogVisible(newVal) {
      this.$emit('update:visible', newVal)
    }
  },
  
  methods: {
    async loadTopics() {
      if (!this.textbook) return
      
      this.loading = true
      try {
        // First try to get cached topics
        const cachedResponse = await this.$http.get(`/api/textbooks/${this.textbook.id}/topics`)
        
        if (cachedResponse.data && cachedResponse.data.length > 0) {
          this.topics = cachedResponse.data
        } else {
          // Generate topics using AI if not cached
          await this.generateTopics()
        }
      } catch (error) {
        console.error('Load topics error:', error)
        // Generate topics as fallback
        await this.generateTopics()
      } finally {
        this.loading = false
      }
    },
    
    async generateTopics() {
      try {
        const response = await this.$http.post(`/api/textbooks/${this.textbook.id}/generate-topics`)
        this.topics = response.data || this.generateMockTopics()
      } catch (error) {
        console.error('Generate topics error:', error)
        this.topics = this.generateMockTopics()
      }
    },
    
    generateMockTopics() {
      // Generate mock topics based on subject
      const subject = this.textbook.subject?.toLowerCase() || 'general'
      const grade = this.textbook.grade || '5'
      
      const topicTemplates = {
        math: [
          { title: 'Addition and Subtraction', category: 'Arithmetic', importance: 'High', keywords: ['addition', 'subtraction', 'carry', 'borrow'] },
          { title: 'Multiplication Tables', category: 'Arithmetic', importance: 'High', keywords: ['multiplication', 'times', 'factors'] },
          { title: 'Fractions', category: 'Numbers', importance: 'Medium', keywords: ['fractions', 'numerator', 'denominator'] },
          { title: 'Geometry Basics', category: 'Geometry', importance: 'Medium', keywords: ['shapes', 'angles', 'area', 'perimeter'] }
        ],
        science: [
          { title: 'Plant Life Cycle', category: 'Biology', importance: 'High', keywords: ['plants', 'photosynthesis', 'growth', 'seeds'] },
          { title: 'Water Cycle', category: 'Earth Science', importance: 'High', keywords: ['water', 'evaporation', 'condensation', 'precipitation'] },
          { title: 'Force and Motion', category: 'Physics', importance: 'Medium', keywords: ['force', 'motion', 'gravity', 'friction'] },
          { title: 'Human Body Systems', category: 'Biology', importance: 'Medium', keywords: ['body', 'organs', 'systems', 'health'] }
        ],
        english: [
          { title: 'Grammar Rules', category: 'Grammar', importance: 'High', keywords: ['grammar', 'sentences', 'punctuation'] },
          { title: 'Reading Comprehension', category: 'Reading', importance: 'High', keywords: ['reading', 'comprehension', 'stories'] },
          { title: 'Creative Writing', category: 'Writing', importance: 'Medium', keywords: ['writing', 'creativity', 'essays'] },
          { title: 'Vocabulary Building', category: 'Vocabulary', importance: 'Medium', keywords: ['words', 'vocabulary', 'meaning'] }
        ]
      }
      
      const templates = topicTemplates[subject] || topicTemplates.science
      
      return templates.map((template, index) => ({
        id: index + 1,
        title: template.title,
        category: template.category,
        importance: template.importance,
        description: `Important ${template.category.toLowerCase()} concept for Grade ${grade} students`,
        keywords: template.keywords,
        page: Math.floor(Math.random() * 100) + 1,
        chapterOrder: index + 1
      }))
    },
    
    filterByCategory(category) {
      this.selectedCategory = this.selectedCategory === category ? '' : category
    },
    
    selectTopic(topic) {
      this.selectedTopic = topic
    },
    
    getCategoryIcon(category) {
      const icons = {
        'Arithmetic': '🧮',
        'Numbers': '🔢',
        'Geometry': '📐',
        'Biology': '🌱',
        'Physics': '⚡',
        'Chemistry': '⚗️',
        'Earth Science': '🌍',
        'Grammar': '📝',
        'Reading': '📚',
        'Writing': '✍️',
        'Vocabulary': '📖',
        'History': '🏛️',
        'Geography': '🗺️',
        'Computer': '💻'
      }
      return icons[category] || '📋'
    },
    
    getImportanceColor(importance) {
      const colors = {
        'High': 'danger',
        'Medium': 'warning', 
        'Low': 'info'
      }
      return colors[importance] || 'info'
    },
    
    async generateTopicsSummary() {
      this.loading = true
      try {
        // Simulate AI summary generation
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        this.aiSummary = {
          objectives: [
            'Understand fundamental concepts in ' + (this.textbook.subject || 'the subject'),
            'Apply knowledge to solve practical problems',
            'Develop critical thinking skills',
            'Build foundation for advanced topics'
          ],
          concepts: this.topics.slice(0, 8).map(t => t.title),
          sequence: [
            'Start with basic concepts and definitions',
            'Practice with simple examples and exercises',
            'Gradually move to complex problems',
            'Review and reinforce learning through activities'
          ]
        }
      } catch (error) {
        this.$message.error('Failed to generate AI summary')
      } finally {
        this.loading = false
      }
    },
    
    exportTopics() {
      const exportData = {
        textbook: {
          name: this.textbook.originalFilename,
          grade: this.textbook.grade,
          subject: this.textbook.subject
        },
        topics: this.topics,
        categories: this.categories,
        summary: this.aiSummary,
        exportDate: new Date().toISOString()
      }
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${this.textbook.filename}_topics.json`
      link.click()
      URL.revokeObjectURL(url)
      
      this.$message.success('Topics exported successfully')
    },
    
    generateStudyGuide() {
      const studyGuide = `
# Study Guide: ${this.textbook.originalFilename}
## Grade ${this.textbook.grade} - ${this.textbook.subject}

### Important Topics:
${this.topics.filter(t => t.importance === 'High').map(t => `- ${t.title}`).join('\n')}

### Key Concepts:
${this.topics.map(t => `**${t.title}**: ${t.description}`).join('\n\n')}

### Study Sequence:
${this.aiSummary?.sequence.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'Follow the chapter order in the textbook.'}
      `.trim()
      
      const blob = new Blob([studyGuide], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${this.textbook.filename}_study_guide.md`
      link.click()
      URL.revokeObjectURL(url)
      
      this.$message.success('Study guide generated!')
    }
  }
}
</script>

<style lang="scss" scoped>
.topics-viewer {
  .info-card {
    margin-bottom: 20px;
    
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
  
  .categories-card {
    margin-bottom: 20px;
    
    h3 {
      margin: 0 0 15px;
      color: #303133;
    }
    
    .categories-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 15px;
      
      .category-item {
        padding: 15px;
        border: 2px solid #e4e7ed;
        border-radius: 8px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        
        &:hover, &.active {
          border-color: #409EFF;
          background: #ecf5ff;
        }
        
        .category-icon {
          font-size: 24px;
          margin-bottom: 8px;
        }
        
        .category-name {
          font-weight: 500;
          color: #303133;
          margin-bottom: 4px;
        }
        
        .category-count {
          font-size: 12px;
          color: #909399;
        }
      }
    }
  }
  
  .filter-card {
    margin-bottom: 20px;
  }
  
  .topics-card {
    .topics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 15px;
      
      .topic-card {
        padding: 15px;
        border: 1px solid #e4e7ed;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s;
        
        &:hover, &.selected {
          border-color: #409EFF;
          box-shadow: 0 2px 12px rgba(64, 158, 255, 0.2);
        }
        
        .topic-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 10px;
          
          .topic-title {
            font-weight: 600;
            color: #303133;
            flex: 1;
            margin-right: 10px;
          }
        }
        
        .topic-meta {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #909399;
          margin-bottom: 10px;
        }
        
        .topic-description {
          font-size: 13px;
          color: #606266;
          line-height: 1.4;
          margin-bottom: 10px;
        }
        
        .topic-keywords {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          align-items: center;
          
          .more-keywords {
            font-size: 12px;
            color: #909399;
          }
        }
      }
    }
  }
  
  .summary-card {
    margin-top: 20px;
    
    h3 {
      margin: 0 0 15px;
      color: #303133;
    }
    
    .summary-content {
      p {
        margin: 15px 0 8px;
        font-weight: 500;
        color: #303133;
      }
      
      ul, ol {
        margin: 0 0 15px;
        padding-left: 20px;
      }
      
      .concepts-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 15px;
      }
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
}
</style>