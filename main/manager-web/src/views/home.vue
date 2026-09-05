<template>
  <div class="welcome">
    <!-- Common Header -->
    <el-main style="padding: 20px;display: flex;flex-direction: column;">
      <div>
        <!-- Home Page Content -->
        <div class="page-head">
          <div>
            <h1 class="page-title">Agents</h1>
            <p class="page-lead">Every character a child talks to — voice, prompt, memory and the toys it runs on.</p>
          </div>
          <div class="page-actions">
            <el-button size="small" type="primary" @click="showAddDialog">New agent</el-button>
          </div>
        </div>

        <div class="bento" :class="isAdmin ? 'g4' : 'g2'">
          <div v-if="isAdmin" class="card kpi">
            <div class="kpi-label">Total users</div>
            <div class="kpi-value">{{ systemStats.totalUsers }}</div>
          </div>
          <div v-if="isAdmin" class="card kpi">
            <div class="kpi-label">Total devices</div>
            <div class="kpi-value">{{ systemStats.totalDevices }}</div>
          </div>
          <el-popover placement="bottom" width="280" trigger="hover" popper-class="device-popover"
            @show="fetchTodayActiveDevices">
            <div class="device-list-popover">
              <div class="popover-title">Active devices today</div>
              <div v-if="todayActiveDevices.length === 0" class="no-devices">No active devices</div>
              <div v-else class="device-item" v-for="(device, index) in todayActiveDevices" :key="index">
                <div class="device-mac">{{ formatMacAddress(device.macAddress) }}</div>
                <div class="device-owner">{{ device.ownerName || 'Unknown' }}</div>
              </div>
            </div>
            <div slot="reference" class="card kpi hoverable">
              <div class="kpi-label">Active today</div>
              <div class="kpi-value">{{ todayDeviceCount }}</div>
            </div>
          </el-popover>
          <el-popover placement="bottom" width="280" trigger="hover" popper-class="device-popover"
            @show="fetchMonthActiveDevices">
            <div class="device-list-popover">
              <div class="popover-title">Active devices this month</div>
              <div v-if="monthActiveDevices.length === 0" class="no-devices">No active devices</div>
              <div v-else class="device-item" v-for="(device, index) in monthActiveDevices" :key="index">
                <div class="device-mac">{{ formatMacAddress(device.macAddress) }}</div>
                <div class="device-owner">{{ device.ownerName || 'Unknown' }}</div>
              </div>
            </div>
            <div slot="reference" class="card kpi hoverable">
              <div class="kpi-label">Active this month</div>
              <div class="kpi-value">{{ monthDeviceCount }}</div>
            </div>
          </el-popover>
        </div>

        <ListToolbar
          :count="totalAgents || devices.length"
          count-noun="agents"
          :total="totalAgents || devices.length"
          :sort-options="sortOptions"
          :sort-by.sync="sortBy"
          :sort-dir.sync="sortDir"
          :group-options="groupOptions"
          :group-by.sync="groupBy"
          :selecting.sync="selecting"
          :selected-count="selectedCount"
          :all-selected="allSelected"
          :search.sync="listSearch"
          search-placeholder="Agent, child or MAC"
          @select-all-matching="selectAllMatching"
          @clear-selection="clearSelection"
        >
          <template #bulk>
            <el-button @click="bulkExport">Export</el-button>
            <el-button type="danger" @click="bulkDelete">Delete agents</el-button>
          </template>
        </ListToolbar>

        <!-- Agent Table -->
        <div class="agent-table-container">
          <el-card class="agent-card" shadow="never">
            <el-table
              ref="agentTable"
              :data="visibleRows"
              class="agent-table"
              v-loading="isLoading"
              element-loading-text="Loading..."
              element-loading-spinner="el-icon-loading"
              element-loading-background="rgba(255, 255, 255, 0.7)"
              row-key="agentId"
              :row-class-name="rowClass"
              @sort-change="onTableSortChange"
              @selection-change="onSelectionChange"
            >
              <el-table-column v-if="selecting" type="selection" width="44" />
              <!-- Agent Name -->
              <el-table-column label="Agent Name" prop="agentName" min-width="190" sortable="custom">
                <template slot-scope="scope">
                  <div class="agent-name-cell">
                    <span class="rowid-mark accent">{{ initials(scope.row.agentName) }}</span>
                    <span class="agent-name cell-key">{{ scope.row.agentName }}</span>
                    <el-tooltip placement="top" popper-class="agent-role-tooltip">
                      <div slot="content" class="agent-role">{{ scope.row.agentRole }}</div>
                      <i class="el-icon-info info-icon"></i>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>

              <!-- Owner (Admin only) -->
              <el-table-column v-if="isAdmin" label="Owner" prop="ownerUsername" min-width="180" sortable="custom">
                <template slot-scope="scope">
                  {{ scope.row.ownerUsername || `User ID: ${scope.row.userId}` }}
                </template>
              </el-table-column>

              <!-- Parent contact (Admin only) — Apple sign-ups have an opaque
                   UID as their Owner, so this is what identifies them -->
              <el-table-column v-if="isAdmin" label="Parent Contact" min-width="220">
                <template slot-scope="scope">
                  <div v-if="scope.row.parentName" class="parent-name">{{ scope.row.parentName }}</div>
                  <div v-if="scope.row.parentEmail" class="parent-contact">{{ scope.row.parentEmail }}</div>
                  <div v-if="scope.row.parentPhone" class="parent-contact">{{ scope.row.parentPhone }}</div>
                  <span
                    v-if="!scope.row.parentName && !scope.row.parentEmail && !scope.row.parentPhone"
                    class="parent-contact-empty"
                  >No parent profile</span>
                </template>
              </el-table-column>

              <!-- Child (Admin only) -->
              <el-table-column v-if="isAdmin" label="Child" min-width="140">
                <template slot-scope="scope">
                  <span v-if="scope.row.kidNames && scope.row.kidNames.length">
                    {{ scope.row.kidNames.join(', ') }}
                  </span>
                  <span v-else class="parent-contact-empty">—</span>
                </template>
              </el-table-column>

              <!-- MAC ID(s) -->
              <el-table-column label="MAC ID(s)" prop="deviceCount" min-width="150" sortable="custom">
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
              <el-table-column label="Last Conversation" prop="lastConnectedAt" min-width="170" sortable="custom">
                <template slot-scope="scope">
                  <span class="last-conversation">{{ formatLastConnected(scope.row.lastConnectedAt) }}</span>
                </template>
              </el-table-column>

              <!-- Actions -->
              <el-table-column label="Actions" min-width="330" align="right">
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
                    >
                      Chat History
                    </el-button>
                    <el-button type="text" size="small" class="delete-btn" @click="handleDeleteAgent(scope.row.agentId)">
                      <i class="el-icon-delete"></i>
                    </el-button>
                  </div>
                </template>
              </el-table-column>

              <template slot="empty">
                <div class="ds-empty"><b>No agents yet.</b>Create one to give a toy its character.</div>
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
import VersionFooter from '@/components/VersionFooter.vue';
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';
import { summarizeAgentPrompt } from '@/utils/agentSummary';

export default {
  name: 'Home',
  components: { AddWisdomBodyDialog, VersionFooter, ChatHistoryDialog, ListToolbar },
  mixins: [listControls],
  data() {
    return {
      // list controls
      rowKey: 'agentId',
      sortBy: 'lastConnectedAt',
      sortDir: 'desc',
      sortOptions: [
        { label: 'Last conversation', value: 'lastConnectedAt' },
        { label: 'Agent name', value: 'agentName' },
        { label: 'Owner', value: 'ownerUsername' },
        { label: 'Devices', value: 'deviceCount' }
      ],
      groupOptions: [
        { label: 'None', value: '' },
        { label: 'Owner', value: 'ownerUsername' }
      ],
      searchFields: ['agentName', 'ownerUsername', 'parentName', 'parentEmail', 'parentPhone'],
      addDeviceDialogVisible: false,
      devices: [],
      originalDevices: [],
      isLoading: true,
      showChatHistory: false,
      currentAgentId: '',
      currentAgentName: '',
      // Pagination
      currentPage: 1,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50, 100],
      totalAgents: 0, // Total count from server for pagination
      // Today's device count
      todayDeviceCount: 0,
      // Month's device count
      monthDeviceCount: 0,
      currentMonth: '',
      // Active devices lists for tooltips
      todayActiveDevices: [],
      monthActiveDevices: [],
      // System-wide stats (admin only)
      systemStats: {
        totalUsers: 0,
        totalDevices: 0,
        totalAgents: 0,
        totalSessions: 0
      }
    }
  },

  computed: {
    isAdmin() {
      return this.$store.getters.getIsSuperAdmin;
    },
    // Server already paginated these; the mixin sorts/searches the page
    sourceRows() {
      return this.devices;
    },
    paginatedDevices() {
      return this.devices;
    },
    pageCount() {
      // Use totalAgents from server response for pagination
      return Math.ceil(this.totalAgents / this.pageSize) || 1;
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
    if (this.isAdmin) {
      this.fetchSystemStats();
    }
  },

  activated() {
    // keep-alive fires activated right after the first mount too — mounted()
    // already loaded the list then; refresh only on genuine re-entries
    if (!this._homeEverActivated) {
      this._homeEverActivated = true;
      return;
    }
    this.fetchAgentList();
  },

  created() {
    console.log('Home component created'); // Debug log
    this._homeEverActivated = false;
  },

  // Re-entry refresh is handled by activated() — the layout's keep-alive
  // re-activates this component on every navigation back to /home.

  methods: {
    initials(name) {
      const value = String(name || '').trim();
      if (!value) return '—';
      const parts = value.split(/\s+/).filter(Boolean);
      return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase();
    },
    bulkExport() {
      const rows = this.selectedRows;
      if (!rows.length) {
        this.$message.warning('Nothing to export.');
        return;
      }
      const cols = ['agentName', 'ownerUsername', 'parentName', 'parentEmail', 'deviceCount'];
      const escape = value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
      const csv = [cols.join(',')]
        .concat(rows.map(row => cols.map(col => escape(row[col])).join(',')))
        .join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'agents.csv';
      link.click();
      URL.revokeObjectURL(url);
    },
    bulkDelete() {
      const rows = this.selectedRows;
      if (!rows.length) return;
      this.$confirm(`Delete ${rows.length} agent${rows.length === 1 ? '' : 's'}? This cannot be undone.`, 'Delete agents', {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        rows.forEach(row => this.handleDeleteAgent(row.agentId, true));
        this.clearSelection();
      }).catch(() => {});
    },
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
    // Fetch today's active devices list
    fetchTodayActiveDevices() {
      Api.agent.getTodayActiveDevices((response) => {
        if (response.data && response.data.code === 0) {
          this.todayActiveDevices = response.data.data || [];
        }
      });
    },
    // Fetch this month's active devices list
    fetchMonthActiveDevices() {
      Api.agent.getMonthActiveDevices((response) => {
        if (response.data && response.data.code === 0) {
          this.monthActiveDevices = response.data.data || [];
        }
      });
    },
    // Fetch system-wide statistics (admin only)
    fetchSystemStats() {
      Api.admin.getSystemStats((response) => {
        if (response.data && response.data.code === 0) {
          this.systemStats = {
            totalUsers: response.data.data.totalUsers || 0,
            totalDevices: response.data.data.totalDevices || 0,
            totalAgents: response.data.data.totalAgents || 0,
            totalSessions: response.data.data.totalSessions || 0
          };
        }
      });
    },
    // Format MAC address for display
    formatMacAddress(mac) {
      if (!mac) return 'Unknown';
      // Convert format like "6825ddbb23a4" to "68:25:DD:BB:23:A4"
      const cleaned = mac.replace(/[:-]/g, '').toUpperCase();
      return cleaned.match(/.{1,2}/g)?.join(':') || mac;
    },
    goToRoleConfig() {
      // Navigate to role config page after clicking configure role
      this.$router.push('/role-config')
    },
    handleWisdomBodyAdded(res) {
      this.fetchAgentList();
      this.addDeviceDialogVisible = false;
    },
    handleDeviceManage() {
      this.$router.push('/device-management');
    },
    // Set devices without resetting page (used after API fetch)
    setDevicesFromOriginal() {
      this.devices = [...this.originalDevices];
    },
    // Get agent list
    fetchAgentList() {
      this.isLoading = true;
      console.log('Starting to fetch agent list...'); // Debug log

      // Use /agent/list for both admin and regular users
      // Backend handles role-based filtering and includes ownerUsername for admins
      const params = {
        page: this.currentPage,
        limit: this.pageSize
      };
      Api.agent.getUserAgentList(params, (response) => {
        console.log('API response received:', response); // Debug log
        this.handleAgentListResponse(response.data);
      }, (error) => {
        console.error('Failed to fetch agent list:', error);
        this.$message.error('Failed to load agent list. Please check your connection and try again.');
        this.isLoading = false;
      });
    },

    // Handle agent list response
    handleAgentListResponse(data) {
      console.log('Raw API Response:', data); // Debug log

      if (data) {
        // The parameter 'data' is already response.data from the API call
        let agentList = [];
        let total = 0;

        // The API response structure is nested: response.data.data.list with total
        if (data.data && data.data.list && Array.isArray(data.data.list)) {
          // For admin API: data.data.list (nested structure)
          agentList = data.data.list;
          total = data.data.total || agentList.length;
          console.log('Using data.data.list structure, total:', total); // Debug log
        } else if (data.list && Array.isArray(data.list)) {
          // For fallback: data.list
          agentList = data.list;
          total = data.total || agentList.length;
          console.log('Using data.list structure, total:', total); // Debug log
        } else if (Array.isArray(data.data)) {
          // For user API: data.data (direct array)
          agentList = data.data;
          total = agentList.length;
          console.log('Using data.data array structure'); // Debug log
        } else if (Array.isArray(data)) {
          // For direct array: data
          agentList = data;
          total = agentList.length;
          console.log('Using direct array structure'); // Debug log
        } else {
          console.error('Unexpected API response structure:', data);
          console.error('Available keys in data:', Object.keys(data || {})); // Debug log
          this.$message.error('Failed to load agent list: Invalid response format');
          this.isLoading = false;
          return;
        }

        // Store total for pagination
        this.totalAgents = total;

        console.log('Agent list before processing:', agentList); // Debug log

        // Process agent data and get model names
        this.processAgentListWithModelNames(agentList);

        console.log('Final processed devices:', this.originalDevices); // Debug log

        // Dynamically set skeleton count (optional)
        this.skeletonCount = Math.min(
          Math.max(this.originalDevices.length, 3), // Minimum 3
          10 // Maximum 10
        );

        this.setDevicesFromOriginal();
      } else {
        console.error('No data in API response:', data);
        this.$message.error('Failed to load agent list: No data received');
      }
      this.isLoading = false;
    },
    // Delete agent
    // `skipConfirm` is set by the bulk path, which confirms once for the
    // whole selection.
    handleDeleteAgent(agentId, skipConfirm) {
      const run = () => {
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
      };

      if (skipConfirm) {
        run();
        return;
      }

      this.$confirm('Are you sure you want to delete this agent?', 'Confirm', {
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(run).catch(() => { });
    },

    // Process agent list
    async processAgentListWithModelNames(agentList) {
      // Create basic device list
      const basicDevices = agentList
        .filter(item => item && (item.id || item.agentId))
        .map(item => ({
          ...item,
          agentId: item.agentId || item.id,
          agentName: item.agentName || item.name || 'Unknown Agent',
          userId: item.userId || item.user_id || item.ownerId || null,
          deviceCount: item.deviceCount || 0,
          macAddresses: item.deviceMacAddresses ? String(item.deviceMacAddresses).split(',').filter(Boolean) : [],
          memModelId: item.memModelId || 'Memory_nomem',
          lastConnectedAt: item.lastConnectedAt || null,
          // What the agent is and what it is responsible for, read out of the
          // prompt. The prompt itself is a page of operating procedure and
          // belongs in the editor, not in a hover.
          agentRole: summarizeAgentPrompt(item.systemPrompt) || 'No system prompt configured',
          ownerUsername: item.ownerUsername || null,
          parentName: item.parentName || null,
          parentEmail: item.parentEmail || null,
          parentPhone: item.parentPhone || null,
          kidNames: item.kidNames || []
        }));

      console.log('Basic devices processed:', basicDevices); // Debug log

      // Set basic data for initial display (deviceCount/macAddresses come
      // from the /agent/list response — no per-agent device fetches needed)
      this.originalDevices = basicDevices;
      this.setDevicesFromOriginal();
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
      this.currentAgentId = row.agentId;
      this.currentAgentName = row.agentName;
      this.showChatHistory = true;
    },

    handleKidProfilesRow(row) {
      this.$router.push({
        path: '/kid-profiles',
        query: { agentId: row.agentId, agentName: row.agentName }
      });
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

    // Pagination methods - fetch from server when page changes
    handlePageSizeChange(val) {
      this.pageSize = val;
      this.currentPage = 1;
      this.fetchAgentList();
    },
    goFirst() {
      if (this.currentPage !== 1) {
        this.currentPage = 1;
        this.fetchAgentList();
      }
    },
    goPrev() {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.fetchAgentList();
      }
    },
    goNext() {
      if (this.currentPage < this.pageCount) {
        this.currentPage++;
        this.fetchAgentList();
      }
    },
    goLast() {
      if (this.currentPage !== this.pageCount) {
        this.currentPage = this.pageCount;
        this.fetchAgentList();
      }
    },
    goToPage(page) {
      if (this.currentPage !== page) {
        this.currentPage = page;
        this.fetchAgentList();
      }
    }
  }
}
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.parent-name {
  font-weight: 500;
}

.parent-contact {
  font-size: 12px;
  color: $text-light;
  line-height: 1.5;
  word-break: break-all;
}

.parent-contact-empty {
  color: #bfbfbf;
  font-style: italic;
}

.welcome {
  min-height: 506px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  background-size: cover;
  /* Ensure background image covers entire element */
  background-position: center;
  /* Align from top center */
  -webkit-background-size: cover;
  /* Compatible with older WebKit browsers */
  -o-background-size: cover;
  /* Compatible with older Opera browsers */
}





/* Stats Container — flows with the hero instead of floating over the text */

/* Stats Box Styles */



/* Hoverable stats box */
.stats-box.hoverable {
  cursor: pointer;
  transition: all 0.2s ease;
}

.stats-box.hoverable:hover {
  transform: translateY(-2px);
  box-shadow: none;
}

/* Responsive Stats */
@media screen and (max-width: 1200px) {
  .stats-container {
    gap: 12px;
  }
  .stats-box {
    padding: 10px 20px;
    min-width: 100px;
  }
  .stats-count {
    font-size: 28px;
  }
  .stats-label {
    font-size: 12px;
  }
}

@media screen and (max-width: 992px) {
  .add-device {
    height: auto;
    min-height: 155px;
  }
  .add-device-bg {
    overflow: visible;
    padding-bottom: 15px;
  }
  .stats-container {
    position: relative;
    left: auto;
    top: auto;
    transform: none;
    justify-content: center;
    margin-top: 15px;
    margin-left: 50px;
    gap: 10px;
  }
  .stats-box {
    padding: 10px 18px;
    min-width: 90px;
  }
  .stats-count {
    font-size: 26px;
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
  box-shadow: none;
  border-radius: 15px;
}

::v-deep .agent-card .el-card__body {
  padding: 0;
}

.agent-table {
  width: 100%;
}

::v-deep .agent-table .el-table__header th {
  background: $surface-sunk !important;
  color: $text-dark;
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
  gap: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-name {
  font-weight: 600;
  color: $text-dark;
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
  color: $text-light;
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
  color: $danger;
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
  color: $text-light;
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
  color: $text-body;
  font-size: 14px;
}

.info-item {
  font-weight: 500;
}

.info-separator {
  color: $border-color;
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
  color: $text-body;
  font-size: 13px;
}

.pagination-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  background: #fff;
  color: $text-body;
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
/* The role summary is two sentences on two lines, so the tooltip has to keep
   the newline the summary puts between them. */
.agent-role-tooltip {
  max-width: 420px;
}

.agent-role-tooltip .agent-role {
  white-space: pre-line;
  line-height: 1.55;
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

/* Device Popover Styles */
.device-popover {
  padding: 0 !important;
}

.device-list-popover {
  max-height: 300px;
  overflow-y: auto;
}

.device-list-popover .popover-title {
  font-size: 14px;
  font-weight: 600;
  color: $text-dark;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  background: #fafbfc;
}

.device-list-popover .no-devices {
  padding: 20px 16px;
  text-align: center;
  color: $text-light;
  font-size: 13px;
}

.device-list-popover .device-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
}

.device-list-popover .device-item:last-child {
  border-bottom: none;
}

.device-list-popover .device-item:hover {
  background: $surface-sunk;
}

.device-list-popover .device-mac {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: $text-dark;
  font-weight: 500;
}

.device-list-popover .device-owner {
  font-size: 12px;
  color: $primary;
  font-weight: 500;
}
</style>