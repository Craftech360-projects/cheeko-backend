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
              <el-button type="primary" size="small" @click="showAddDialog" disabled>
                <i class="el-icon-plus"></i> Add Content
              </el-button>
              <button class="custom-close-btn" @click="goToHome">×</button>
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
            <el-select v-model="filters.type" placeholder="Type" size="small" clearable @change="fetchContent">
              <el-option label="All Types" value="" />
              <el-option label="Music" value="music" />
              <el-option label="Story" value="story" />
              <el-option label="Textbook" value="textbook" />
            </el-select>
            <el-select v-model="filters.category" placeholder="Category" size="small" clearable @change="fetchContent">
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
            <el-table-column label="Type" width="80" align="center">
              <template slot-scope="scope">
                <el-tag :type="getTypeTagColor(scope.row.type)" size="mini">
                  {{ scope.row.type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="Title" min-width="200" />
            <el-table-column prop="category" label="Category" width="120" />
            <el-table-column prop="language" label="Language" width="100" />
            <el-table-column label="Duration" width="100" align="center">
              <template slot-scope="scope">
                {{ formatDuration(scope.row.duration) }}
              </template>
            </el-table-column>
            <el-table-column label="Status" width="90" align="center">
              <template slot-scope="scope">
                <el-tag :type="scope.row.status === 'active' ? 'success' : 'info'" size="mini">
                  {{ scope.row.status || 'active' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Actions" width="120" align="center" fixed="right">
              <template slot-scope="scope">
                <el-button type="text" size="mini" @click="handleEdit(scope.row)" disabled>
                  Edit
                </el-button>
                <el-button type="text" size="mini" class="delete-btn" @click="handleDelete(scope.row)" disabled>
                  Delete
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div v-if="content.length === 0 && !loading" class="empty-state">
            <i class="el-icon-folder-opened"></i>
            <p>No content found. Content management coming soon!</p>
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
      }
    };
  },
  created() {
    this.handleSearchDebounced = debounce(this.fetchContent, 300);
  },
  methods: {
    goToHome() {
      this.$router.push("/home");
    },
    fetchContent() {
      this.loading = true;
      // API call to fetch content - to be implemented
      // For now, show placeholder data
      setTimeout(() => {
        this.content = [];
        this.stats = {
          total: 0,
          music: 0,
          stories: 0,
          textbooks: 0
        };
        this.loading = false;
        this.$message.info("Content Library API integration pending");
      }, 500);
    },
    fetchStats() {
      // Fetch content statistics
      // To be implemented when API is ready
    },
    fetchCategories() {
      // Fetch available categories
      // To be implemented when API is ready
      this.categories = ["Kids", "Education", "Entertainment", "Bedtime", "Learning"];
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
    handleSizeChange(val) {
      this.pagination.limit = val;
      this.pagination.page = 1;
      this.fetchContent();
    },
    handlePageChange(val) {
      this.pagination.page = val;
      this.fetchContent();
    },
    showAddDialog() {
      this.$message.info("Add Content feature coming soon");
    },
    handleEdit(row) {
      this.$message.info("Edit feature coming soon");
    },
    handleDelete(row) {
      this.$message.info("Delete feature coming soon");
    }
  },
  mounted() {
    this.fetchContent();
    this.fetchCategories();
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
</style>
