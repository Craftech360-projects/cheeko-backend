<template>
  <div class="welcome">
    <!-- 公共头部 -->
    <HeaderBar :devices="devices" @search="handleSearch" @search-reset="handleSearchReset" />
    <el-main style="padding: 20px;display: flex;flex-direction: column;">
      <div>
        <!-- 首页内容 -->
        <div class="add-device">
          <div class="add-device-bg">
            <div class="hellow-text" style="margin-top: 30px;">
              Hello, Cheeko
            </div>
            <div class="hellow-text">
              Let's have a
              <div style="display: inline-block;color: var(--primary);">
                wonderful day!
              </div>
            </div>
            <div class="hi-hint">
              Hello, Let's have a wonderful day!
            </div>
            <div class="add-device-btn">
              <div class="left-add" @click="showAddDialog">
                Add Agent
              </div>
              <div style="width: 23px;height: 13px;background: var(--primary);margin-left: -10px;" />
              <div class="right-add">
                <i class="el-icon-right" @click="showAddDialog" style="font-size: 20px;color: #fff;" />
              </div>
            </div>
            <!-- Stats Boxes Container -->
            <div class="stats-container">
              <div class="stats-box">
                <div class="stats-count">{{ todayDeviceCount }}</div>
                <div class="stats-label">Active Devices Today</div>
              </div>
              <div class="stats-box">
                <div class="stats-count">{{ monthDeviceCount }}</div>
                <div class="stats-label">Active Devices This Month</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Agent Table -->
        <div class="agent-table-container">
          <el-card class="agent-card" shadow="never">
            <el-table
              ref="agentTable"
              :data="paginatedDevices"
              class="agent-table"
              v-loading="isLoading"
              element-loading-text="Loading..."
              element-loading-spinner="el-icon-loading"
              element-loading-background="rgba(255, 255, 255, 0.7)"
              row-key="agentId"
            >
              <!-- Agent Name -->
              <el-table-column label="Agent Name" prop="agentName" min-width="150">
                <template slot-scope="scope">
                  <div class="agent-name-cell">
                    <span class="agent-name">{{ scope.row.agentName }}</span>
                    <el-tooltip :content="scope.row.systemPrompt" placement="top" popper-class="custom-tooltip">
                      <i class="el-icon-info info-icon"></i>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>

              <!-- Owner (Admin only) -->
              <el-table-column v-if="isAdmin" label="Owner" prop="ownerUsername" min-width="180">
                <template slot-scope="scope">
                  {{ scope.row.ownerUsername || `User ID: ${scope.row.userId}` }}
                </template>
              </el-table-column>

              <!-- MAC ID(s) -->
              <el-table-column label="MAC ID(s)" min-width="140" align="center">
                <template slot-scope="scope">
                  <el-tooltip
                    :disabled="!scope.row.macAddresses || scope.row.macAddresses.length === 0"
                    placement="top"
                    popper-class="mac-tooltip"
                  >
                    <div slot="content">
                      <div v-if="scope.row.macAddresses && scope.row.macAddresses.length > 0">
                        <div v-for="(mac, index) in scope.row.macAddresses" :key="index" class="mac-tooltip-item">
                          {{ mac }}
                        </div>
                      </div>
                    </div>
                    <el-tag
                      :type="scope.row.deviceCount > 0 ? 'primary' : 'info'"
                      size="small"
                      class="device-count-tag"
                    >
                      <i class="el-icon-cpu"></i>
                      {{ scope.row.deviceCount }} device{{ scope.row.deviceCount !== 1 ? 's' : '' }}
                    </el-tag>
                  </el-tooltip>
                </template>
              </el-table-column>

              <!-- Last Conversation -->
              <el-table-column label="Last Conversation" min-width="160" align="center">
                <template slot-scope="scope">
                  <span class="last-conversation">{{ formatLastConnected(scope.row.lastConnectedAt) }}</span>
                </template>
              </el-table-column>

              <!-- Actions -->
              <el-table-column label="Actions" min-width="320" align="center">
                <template slot-scope="scope">
                  <div class="action-buttons">
                    <el-button type="text" size="small" @click="handleConfigure(scope.row)">
                      Configure Role
                    </el-button>
                    <el-button type="text" size="small" @click="handleVoicePrint(scope.row)">
                      Voice Recognition
                    </el-button>
                    <el-button type="text" size="small" @click="handleDeviceManageRow(scope.row)">
                      Devices
                    </el-button>
                    <el-button
                      type="text"
                      size="small"
                      @click="handleChatHistoryRow(scope.row)"
                      :disabled="scope.row.memModelId === 'Memory_nomem'"
                    >
                      <el-tooltip v-if="scope.row.memModelId === 'Memory_nomem'" content="Enable memory in 'Configure Role' first" placement="top">
                        <span>Chat History</span>
                      </el-tooltip>
                      <span v-else>Chat History</span>
                    </el-button>
                    <el-button type="text" size="small" class="delete-btn" @click="handleDeleteAgent(scope.row.agentId)">
                      <i class="el-icon-delete"></i>
                    </el-button>
                  </div>
                </template>
              </el-table-column>

              <template slot="empty">
                <span>No agents found</span>
              </template>
            </el-table>

            <!-- Pagination -->
            <div class="table-pagination" v-if="devices.length > 0">
              <div class="pagination-info">
                <span class="info-item">Total Users: {{ totalUsers }}</span>
                <span class="info-separator">|</span>
                <span class="info-item">Total Devices: {{ totalDevices }}</span>
              </div>
              <div class="pagination-controls">
                <el-select v-model="pageSize" @change="handlePageSizeChange" class="page-size-select" size="small">
                  <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} / page`" :value="item" />
                </el-select>
                <button class="pagination-btn" :disabled="currentPage === 1" @click="goFirst">First</button>
                <button class="pagination-btn" :disabled="currentPage === 1" @click="goPrev">
                  <i class="el-icon-arrow-left"></i>
                </button>
                <button
                  v-for="page in visiblePages"
                  :key="page"
                  class="pagination-btn page-number"
                  :class="{ active: page === currentPage }"
                  @click="goToPage(page)"
                >
                  {{ page }}
                </button>
                <button class="pagination-btn" :disabled="currentPage === pageCount" @click="goNext">
                  <i class="el-icon-arrow-right"></i>
                </button>
                <button class="pagination-btn" :disabled="currentPage === pageCount" @click="goLast">Last</button>
              </div>
            </div>
          </el-card>
        </div>
      </div>
      <AddWisdomBodyDialog :visible.sync="addDeviceDialogVisible" @confirm="handleWisdomBodyAdded" />
    </el-main>
    <el-footer>
      <version-footer />
    </el-footer>
    <chat-history-dialog :visible.sync="showChatHistory" :agent-id="currentAgentId" :agent-name="currentAgentName" />
  </div>

</template>

<script>
import Api from '@/apis/api';
import AddWisdomBodyDialog from '@/components/AddWisdomBodyDialog.vue';
import ChatHistoryDialog from '@/components/ChatHistoryDialog.vue';
import HeaderBar from '@/components/HeaderBar.vue';
import VersionFooter from '@/components/VersionFooter.vue';

export default {
  name: 'HomePage',
  components: { AddWisdomBodyDialog, HeaderBar, VersionFooter, ChatHistoryDialog },
  data() {
    return {
      addDeviceDialogVisible: false,
      devices: [],
      originalDevices: [],
      isSearching: false,
      searchRegex: null,
      isLoading: true,
      showChatHistory: false,
      currentAgentId: '',
      currentAgentName: '',
      // Pagination
      currentPage: 1,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50, 100],
      // Today's device count
      todayDeviceCount: 0,
      // Month's device count
      monthDeviceCount: 0,
      currentMonth: ''
    }
  },

  computed: {
    isAdmin() {
      return this.$store.getters.getIsSuperAdmin;
    },
    paginatedDevices() {
      const start = (this.currentPage - 1) * this.pageSize;
      const end = start + this.pageSize;
      return this.devices.slice(start, end);
    },
    pageCount() {
      return Math.ceil(this.devices.length / this.pageSize) || 1;
    },
    visiblePages() {
      const pages = [];
      const maxVisible = 5;
      let start = Math.max(1, this.currentPage - 2);
      let end = Math.min(this.pageCount, start + maxVisible - 1);

      if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    },
    totalUsers() {
      // Count unique users by userId or ownerUsername (email)
      const uniqueUsers = new Set(
        this.devices.map(d => d.userId || d.ownerUsername).filter(Boolean)
      );
      return uniqueUsers.size;
    },
    totalDevices() {
      return this.devices.reduce((sum, d) => sum + (d.deviceCount || 0), 0);
    }
  },

  mounted() {
    console.log('Home component mounted, fetching agent list'); // Debug log
    this.fetchAgentList();
    this.fetchTodayDeviceCount();
    this.fetchMonthDeviceCount();
  },

  activated() {
    // This runs when component is activated (useful if using keep-alive)
    console.log('Home component activated, fetching agent list'); // Debug log
    this.fetchAgentList();
  },

  created() {
    console.log('Home component created'); // Debug log
  },

  watch: {
    '$route'(to, from) {
      // Watch for route changes - refetch data when navigating back to home
      console.log('Route changed:', from.path, '->', to.path); // Debug log
      if (to.name === 'home' || to.path === '/home') {
        console.log('Navigated back to home, refetching agent list'); // Debug log
        this.$nextTick(() => {
          this.fetchAgentList();
        });
      }
    }
  },

  methods: {
    showAddDialog() {
      this.addDeviceDialogVisible = true
    },
    // Fetch today's device interaction count
    fetchTodayDeviceCount() {
      Api.agent.getTodayDeviceCount((response) => {
        if (response.data && response.data.code === 0) {
          this.todayDeviceCount = response.data.data.count || 0;
        }
      });
    },
    // Fetch this month's device interaction count
    fetchMonthDeviceCount() {
      Api.agent.getMonthDeviceCount((response) => {
        if (response.data && response.data.code === 0) {
          this.monthDeviceCount = response.data.data.count || 0;
          this.currentMonth = response.data.data.month || '';
        }
      });
    },
    goToRoleConfig() {
      // 点击配置角色后跳转到角色配置页
      this.$router.push('/role-config')
    },
    handleWisdomBodyAdded(res) {
      this.fetchAgentList();
      this.addDeviceDialogVisible = false;
    },
    handleDeviceManage() {
      this.$router.push('/device-management');
    },
    handleSearch(regex) {
      this.isSearching = true;
      this.searchRegex = regex;
      this.applySearchFilter();
      this.currentPage = 1; // Reset to first page on search
    },
    handleSearchReset() {
      this.isSearching = false;
      this.searchRegex = null;
      this.devices = [...this.originalDevices];
      this.currentPage = 1; // Reset to first page
    },
    applySearchFilter() {
      if (!this.isSearching || !this.searchRegex) {
        this.devices = [...this.originalDevices];
        return;
      }

      this.devices = this.originalDevices.filter(device => {
        return this.searchRegex.test(device.agentName);
      });
    },
    // 搜索更新智能体列表
    handleSearchResult(filteredList) {
      this.devices = filteredList; // 更新设备列表
    },
    // 获取智能体列表
    fetchAgentList() {
      this.isLoading = true;
      console.log('Starting to fetch agent list...'); // Debug log

      // Use /agent/list for both admin and regular users
      // Backend handles role-based filtering and includes ownerUsername for admins
      Api.agent.getUserAgentList((response) => {
        console.log('API response received:', response); // Debug log
        this.handleAgentListResponse(response.data);
      }, (error) => {
        console.error('Failed to fetch agent list:', error);
        this.$message.error('Failed to load agent list. Please check your connection and try again.');
        this.isLoading = false;
      });
    },

    // 处理智能体列表响应
    handleAgentListResponse(data) {
      console.log('Raw API Response:', data); // Debug log
      
      if (data) {
        // The parameter 'data' is already response.data from the API call
        let agentList = [];
        
        // The API response structure is nested: response.data.data.list
        if (data.data && data.data.list && Array.isArray(data.data.list)) {
          // For admin API: data.data.list (nested structure)
          agentList = data.data.list;
          console.log('Using data.data.list structure'); // Debug log
        } else if (data.list && Array.isArray(data.list)) {
          // For fallback: data.list
          agentList = data.list;
          console.log('Using data.list structure'); // Debug log
        } else if (Array.isArray(data.data)) {
          // For user API: data.data (direct array)
          agentList = data.data;
          console.log('Using data.data array structure'); // Debug log
        } else if (Array.isArray(data)) {
          // For direct array: data
          agentList = data;
          console.log('Using direct array structure'); // Debug log
        } else {
          console.error('Unexpected API response structure:', data);
          console.error('Available keys in data:', Object.keys(data || {})); // Debug log
          this.$message.error('Failed to load agent list: Invalid response format');
          this.isLoading = false;
          return;
        }

        console.log('Agent list before processing:', agentList); // Debug log

        // 处理agent数据并获取模型名称
        this.processAgentListWithModelNames(agentList);

        console.log('Final processed devices:', this.originalDevices); // Debug log

        // 动态设置骨架屏数量（可选）
        this.skeletonCount = Math.min(
          Math.max(this.originalDevices.length, 3), // 最少3个
          10 // 最多10个
        );

        this.handleSearchReset();
      } else {
        console.error('No data in API response:', data);
        this.$message.error('Failed to load agent list: No data received');
      }
      this.isLoading = false;
    },
    // Delete agent
    handleDeleteAgent(agentId) {
      this.$confirm('Are you sure you want to delete this agent?', 'Confirm', {
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        Api.agent.deleteAgent(agentId, (res) => {
          if (res.data.code === 0) {
            this.$message.success({
              message: 'Deleted successfully',
              showClose: true
            });
            this.fetchAgentList(); // Refresh list
          } else {
            this.$message.error({
              message: res.data.msg || 'Failed to delete',
              showClose: true
            });
          }
        });
      }).catch(() => { });
    },

    // 处理agent列表
    async processAgentListWithModelNames(agentList) {
      // 创建基本的设备列表
      const basicDevices = agentList
        .filter(item => item && (item.id || item.agentId))
        .map(item => ({
          ...item,
          agentId: item.agentId || item.id,
          agentName: item.agentName || item.name || 'Unknown Agent',
          userId: item.userId || item.user_id || item.ownerId || null,
          deviceCount: item.deviceCount || 0,
          macAddresses: [], // Will be populated by fetchDeviceDataForAgents
          memModelId: item.memModelId || 'Memory_nomem',
          lastConnectedAt: item.lastConnectedAt || null,
          systemPrompt: item.systemPrompt || 'No system prompt configured',
          ownerUsername: item.ownerUsername || null
        }));

      console.log('Basic devices processed:', basicDevices); // Debug log

      // 设置基本数据先显示
      this.originalDevices = basicDevices;
      this.handleSearchReset();

      // 异步获取设备数量和MAC地址
      this.fetchDeviceDataForAgents();
    },

    // 获取所有智能体的设备数量和MAC地址
    fetchDeviceDataForAgents() {
      console.log('Fetching device data for agents...');

      this.originalDevices.forEach(device => {
        if (device.agentId) {
          Api.device.getAgentBindDevices(device.agentId, (response) => {
            console.log(`Device response for agent ${device.agentId}:`, response);

            if (response.data && response.data.code === 0) {
              const devices = response.data.data || [];
              const deviceCount = Array.isArray(devices) ? devices.length : 0;

              // Extract MAC addresses from devices
              const macAddresses = Array.isArray(devices)
                ? devices.map(d => d.macAddress).filter(Boolean)
                : [];

              // 更新设备数量和MAC地址
              this.updateDeviceInfo(device.agentId, 'deviceCount', deviceCount);
              this.updateDeviceInfo(device.agentId, 'macAddresses', macAddresses);
              console.log(`Updated device data for ${device.agentName}: count=${deviceCount}, macs=${macAddresses.join(', ')}`);
            }
          });
        }
      });
    },

    // 更新设备信息（通用方法）
    updateDeviceInfo(agentId, field, value) {
      this.originalDevices = this.originalDevices.map(device => {
        if (device.agentId === agentId) {
          return { ...device, [field]: value };
        }
        return device;
      });

      // 同时更新搜索结果
      this.devices = this.devices.map(device => {
        if (device.agentId === agentId) {
          return { ...device, [field]: value };
        }
        return device;
      });
    },

    handleShowChatHistory({ agentId, agentName }) {
      this.currentAgentId = agentId;
      this.currentAgentName = agentName;
      this.showChatHistory = true;
    },

    // Table action methods
    handleConfigure(row) {
      this.$router.push({ path: '/role-config', query: { agentId: row.agentId } });
    },

    handleVoicePrint(row) {
      this.$router.push({ path: '/voice-print', query: { agentId: row.agentId } });
    },

    handleDeviceManageRow(row) {
      this.$router.push({ path: '/device-management', query: { agentId: row.agentId } });
    },

    handleChatHistoryRow(row) {
      if (row.memModelId === 'Memory_nomem') {
        return;
      }
      this.currentAgentId = row.agentId;
      this.currentAgentName = row.agentName;
      this.showChatHistory = true;
    },

    // Format last connected time
    formatLastConnected(lastConnectedAt) {
      if (!lastConnectedAt) return 'No conversations yet';

      const lastTime = new Date(lastConnectedAt);
      const now = new Date();
      const diffMinutes = Math.floor((now - lastTime) / (1000 * 60));

      if (diffMinutes <= 1) {
        return 'Just now';
      } else if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
      } else if (diffMinutes < 24 * 60) {
        const hours = Math.floor(diffMinutes / 60);
        const minutes = diffMinutes % 60;
        return `${hours} hour${hours > 1 ? 's' : ''} ${minutes > 0 ? minutes + ' min' : ''} ago`;
      } else {
        return lastConnectedAt;
      }
    },

    // Pagination methods
    handlePageSizeChange(val) {
      this.pageSize = val;
      this.currentPage = 1;
    },
    goFirst() {
      this.currentPage = 1;
    },
    goPrev() {
      if (this.currentPage > 1) this.currentPage--;
    },
    goNext() {
      if (this.currentPage < this.pageCount) this.currentPage++;
    },
    goLast() {
      this.currentPage = this.pageCount;
    },
    goToPage(page) {
      this.currentPage = page;
    }
  }
}
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.welcome {
  min-width: 900px;
  min-height: 506px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(145deg, #fff5eb, #fff7f0);
  background-size: cover;
  /* 确保背景图像覆盖整个元素 */
  background-position: center;
  /* 从顶部中心对齐 */
  -webkit-background-size: cover;
  /* 兼容老版本WebKit浏览器 */
  -o-background-size: cover;
  /* 兼容老版本Opera浏览器 */
}

.add-device {
  height: 195px;
  border-radius: 15px;
  position: relative;
  overflow: hidden;
  background: linear-gradient(269.62deg,
      rgba($primary, 0.15) 0%,
      rgba($secondary-pink, 0.1) 49.69%,
      rgba($secondary-blue, 0.15) 100%);
}

.add-device-bg {
  width: 100%;
  height: 100%;
  text-align: left;
  background-image: url("@/assets/home/main-top-bg.png");
  overflow: hidden;
  background-size: cover;
  /* 确保背景图像覆盖整个元素 */
  background-position: center;
  /* 从顶部中心对齐 */
  -webkit-background-size: cover;
  /* 兼容老版本WebKit浏览器 */
  -o-background-size: cover;
  box-sizing: border-box;

  /* 兼容老版本Opera浏览器 */
  .hellow-text {
    margin-left: 75px;
    color: #3d4566;
    font-size: 33px;
    font-weight: 700;
    letter-spacing: 0;
  }

  .hi-hint {
    font-weight: 400;
    font-size: 12px;
    text-align: left;
    color: #818cae;
    margin-left: 75px;
    margin-top: 5px;
  }
}

.add-device-btn {
  display: flex;
  align-items: center;
  margin-left: 75px;
  margin-top: 15px;
  cursor: pointer;

  .left-add {
    width: 105px;
    height: 34px;
    border-radius: 17px;
    background: $primary;
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    line-height: 34px;
  }

  .right-add {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: $primary;
    margin-left: -6px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
}

/* Stats Container */
.stats-container {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 20px;
}

/* Stats Box Styles */
.stats-box {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  padding: 18px 30px;
  box-shadow: 0 4px 20px rgba($primary, 0.25);
  text-align: center;
  backdrop-filter: blur(10px);
  border: 1px solid rgba($primary, 0.15);
  min-width: 120px;
}

.stats-count {
  font-size: 42px;
  font-weight: 700;
  color: $primary;
  line-height: 1;
  margin-bottom: 6px;
}

.stats-label {
  font-size: 13px;
  font-weight: 500;
  color: #3d4566;
  white-space: nowrap;
}

/* Responsive Stats */
@media screen and (max-width: 1200px) {
  .stats-container {
    gap: 15px;
  }
  .stats-box {
    padding: 15px 25px;
    min-width: 100px;
  }
  .stats-count {
    font-size: 36px;
  }
  .stats-label {
    font-size: 12px;
  }
}

@media screen and (max-width: 992px) {
  .add-device {
    height: auto;
    min-height: 195px;
  }
  .add-device-bg {
    overflow: visible;
    padding-bottom: 20px;
  }
  .stats-container {
    position: relative;
    left: auto;
    top: auto;
    transform: none;
    justify-content: center;
    margin-top: 20px;
    margin-left: 75px;
    gap: 12px;
  }
  .stats-box {
    padding: 12px 20px;
    min-width: 90px;
  }
  .stats-count {
    font-size: 30px;
  }
  .stats-label {
    font-size: 11px;
  }
}

@media screen and (max-width: 768px) {
  .add-device {
    height: auto;
    min-height: 180px;
  }
  .add-device-bg {
    overflow: visible;
    padding-bottom: 15px;
  }
  .stats-container {
    margin-left: 0;
    justify-content: center;
    flex-wrap: wrap;
  }
  .stats-box {
    padding: 10px 20px;
    min-width: 120px;
  }
  .stats-count {
    font-size: 28px;
  }
}

/* Agent Table Styles */
.agent-table-container {
  margin-top: 20px;
  border-radius: 15px;
  overflow: hidden;
}

.agent-card {
  background: white;
  border: none;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  border-radius: 15px;
}

::v-deep .agent-card .el-card__body {
  padding: 0;
}

.agent-table {
  width: 100%;
}

::v-deep .agent-table .el-table__header th {
  background: #f5f7fa !important;
  color: #3d4566;
  font-weight: 600;
  border-right: none !important;
}

::v-deep .agent-table .el-table__body tr td {
  border-top: 1px solid rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  border-right: none !important;
}

::v-deep .agent-table .el-table__body tr:hover > td {
  background: rgba($primary, 0.08) !important;
}

/* Agent Name Cell */
.agent-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-name {
  font-weight: 600;
  color: #3d4566;
  font-size: 14px;
}

.info-icon {
  color: $primary;
  cursor: pointer;
  font-size: 14px;
}

.info-icon:hover {
  color: $primary-dark;
}

/* Device Count Tag */
.device-count-tag {
  cursor: pointer;
  transition: all 0.2s ease;
}

.device-count-tag:hover {
  transform: scale(1.05);
}

.device-count-tag i {
  margin-right: 4px;
}

/* Last Conversation */
.last-conversation {
  color: #979db1;
  font-size: 12px;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-wrap: wrap;
}

.action-buttons .el-button--text {
  color: $primary;
  padding: 4px 8px;
  font-size: 12px;
}

.action-buttons .el-button--text:hover {
  color: $primary-dark;
}

.action-buttons .delete-btn {
  color: #f56c6c;
}

.action-buttons .delete-btn:hover {
  color: #f44336;
}

.action-buttons .el-button.is-disabled {
  color: #c0c4cc;
}

.footer {
  font-size: 12px;
  font-weight: 400;
  color: #979db1;
  text-align: center;
}

::v-deep .el-footer {
  height: auto !important;
  padding: 10px 0 !important;
}

/* Table border fixes */
::v-deep .el-table--border::after,
::v-deep .el-table--group::after,
::v-deep .el-table::before {
  display: none !important;
}

/* Pagination Styles */
.table-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-top: 1px solid #ebeef5;
  background: #fafbfc;
}

.pagination-info {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #606266;
  font-size: 14px;
}

.info-item {
  font-weight: 500;
}

.info-separator {
  color: #dcdfe6;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-size-select {
  width: 110px;
  margin-right: 10px;
}

::v-deep .page-size-select .el-input__inner {
  height: 32px;
  line-height: 32px;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  background: #fff;
  color: #606266;
  font-size: 13px;
}

.pagination-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  background: #fff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.pagination-btn:hover:not(:disabled) {
  border-color: $primary;
  color: $primary;
}

.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination-btn.page-number {
  min-width: 32px;
  padding: 0;
}

.pagination-btn.active {
  background: $primary;
  border-color: $primary;
  color: #fff;
}

.pagination-btn.active:hover {
  background: $primary-dark;
  border-color: $primary-dark;
  color: #fff;
}
</style>

<style>
.custom-tooltip {
  max-width: 400px;
  word-break: break-word;
}

.mac-tooltip {
  max-width: 300px;
}

.mac-tooltip-item {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  padding: 4px 0;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.mac-tooltip-item:last-child {
  border-bottom: none;
}
</style>