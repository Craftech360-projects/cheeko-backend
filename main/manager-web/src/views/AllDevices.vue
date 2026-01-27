<template>
  <div class="welcome">
    <header-bar />
    <div class="main-content">
      <div class="content-area">
        <div class="toolbar">
          <div class="left-actions">
            <el-input
              v-model="searchKeyword"
              placeholder="Search by MAC address, alias..."
              prefix-icon="el-icon-search"
              class="search-input"
              clearable
              @keyup.enter.native="handleSearch"
              @clear="handleSearch"
            />
            <el-button type="primary" size="small" @click="handleSearch">Search</el-button>
          </div>
          <div class="right-actions">
            <el-button size="small" @click="refreshList">
              <i class="el-icon-refresh"></i> Refresh
            </el-button>
          </div>
        </div>

        <el-table
          :data="paginatedDeviceList"
          v-loading="loading"
          style="width: 100%"
          :header-cell-style="{ background: '#f5f7fa', color: '#606266' }"
        >
          <el-table-column label="MAC Address" min-width="160">
            <template slot-scope="scope">
              <span class="mac-address">{{ scope.row.macAddress }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Alias" min-width="120">
            <template slot-scope="scope">
              <el-input
                v-if="scope.row.isEdit"
                v-model="scope.row.alias"
                size="mini"
                @blur="onAliasBlur(scope.row)"
                @keyup.enter.native="onAliasEnter(scope.row)"
              />
              <span v-else @dblclick="scope.row.isEdit = true" class="editable-text">
                {{ scope.row.alias || '-' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="User" min-width="120">
            <template slot-scope="scope">
              <span>{{ scope.row.userName || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Board" prop="board" min-width="100" />
          <el-table-column label="Firmware" prop="appVersion" min-width="100" />
          <el-table-column label="Last Connected" min-width="160">
            <template slot-scope="scope">
              {{ formatDate(scope.row.lastConnectedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="Mode" min-width="100" align="center">
            <template slot-scope="scope">
              <el-switch
                v-model="scope.row.modeSwitch"
                size="mini"
                active-color="#67c23a"
                inactive-color="#909399"
                active-text="Auto"
                inactive-text="Manual"
                @change="handleModeSwitchChange(scope.row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="OTA" min-width="80" align="center">
            <template slot-scope="scope">
              <el-switch
                v-model="scope.row.otaSwitch"
                size="mini"
                active-color="#13ce66"
                inactive-color="#ff4949"
                @change="handleOtaSwitchChange(scope.row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="Actions" min-width="180" align="center">
            <template slot-scope="scope">
              <el-button
                type="text"
                size="small"
                @click="handleKidProfile(scope.row)"
                :disabled="!scope.row.userId"
              >
                Kid Profile
              </el-button>
              <el-button
                type="text"
                size="small"
                class="danger-btn"
                @click="handleUnbind(scope.row)"
                :disabled="!scope.row.userId"
              >
                Unbind
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-container" v-if="filteredDeviceList.length > 0">
          <span class="total-info">Total: {{ filteredDeviceList.length }} devices</span>
          <el-pagination
            background
            layout="prev, pager, next"
            :total="filteredDeviceList.length"
            :page-size="pageSize"
            :current-page.sync="currentPage"
            @current-change="handlePageChange"
          />
        </div>

        <div v-if="deviceList.length === 0 && !loading" class="empty-state">
          <i class="el-icon-monitor"></i>
          <p>No devices found</p>
        </div>
      </div>
    </div>
    <version-footer />
  </div>
</template>

<script>
import Api from '@/apis/api'
import HeaderBar from '@/components/HeaderBar.vue'
import VersionFooter from '@/components/VersionFooter.vue'

export default {
  name: 'AllDevices',
  components: { HeaderBar, VersionFooter },
  data() {
    return {
      loading: false,
      deviceList: [],
      searchKeyword: '',
      activeSearchKeyword: '',
      currentPage: 1,
      pageSize: 20
    }
  },
  computed: {
    filteredDeviceList() {
      if (!this.activeSearchKeyword) return this.deviceList;
      const keyword = this.activeSearchKeyword.toLowerCase();
      return this.deviceList.filter(device => {
        return (
          (device.macAddress && device.macAddress.toLowerCase().includes(keyword)) ||
          (device.alias && device.alias.toLowerCase().includes(keyword)) ||
          (device.userName && device.userName.toLowerCase().includes(keyword))
        );
      });
    },
    paginatedDeviceList() {
      const start = (this.currentPage - 1) * this.pageSize;
      return this.filteredDeviceList.slice(start, start + this.pageSize);
    }
  },
  created() {
    this.loadDevices();
  },
  methods: {
    loadDevices() {
      this.loading = true;
      Api.admin.getAllDevices({ page: 1, limit: 1000 }, ({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.deviceList = (data.data.list || data.data).map(device => ({
            id: device.id,
            macAddress: device.macAddress || device.mac_address,
            alias: device.alias,
            _originalAlias: device.alias,
            isEdit: false,
            board: device.board || device.deviceType,
            appVersion: device.appVersion || device.app_version,
            lastConnectedAt: device.lastConnectedAt || device.last_connected_at || device.recentChatTime,
            userId: device.userId || device.user_id,
            userName: device.bindUserName || device.userName || device.username,
            agentId: device.agentId || device.agent_id,
            kidId: device.kidId || device.kid_id,
            deviceMode: device.deviceMode || device.device_mode || 'manual',
            modeSwitch: (device.deviceMode || device.device_mode || 'manual') === 'auto',
            otaSwitch: (device.autoUpdate || device.otaUpgrade || device.auto_update) === 1
          }));
        } else {
          this.$message.error(data.msg || 'Failed to load devices');
        }
      });
    },
    refreshList() {
      this.loadDevices();
    },
    handleSearch() {
      this.activeSearchKeyword = this.searchKeyword;
      this.currentPage = 1;
    },
    handlePageChange(page) {
      this.currentPage = page;
    },
    formatDate(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleString();
    },
    onAliasBlur(row) {
      row.isEdit = false;
      this.submitAlias(row);
    },
    onAliasEnter(row) {
      row.isEdit = false;
      this.submitAlias(row);
    },
    submitAlias(row) {
      const newAlias = (row.alias || '').trim();
      if (newAlias === row._originalAlias) return;

      Api.device.updateDeviceInfo(row.id, { alias: newAlias }, ({ data }) => {
        if (data.code === 0) {
          row._originalAlias = newAlias;
          this.$message.success('Alias updated');
        } else {
          row.alias = row._originalAlias;
          this.$message.error(data.msg || 'Failed to update alias');
        }
      });
    },
    handleOtaSwitchChange(row) {
      Api.device.updateDeviceInfo(row.id, { autoUpdate: row.otaSwitch ? 1 : 0 }, ({ data }) => {
        if (data.code === 0) {
          this.$message.success(row.otaSwitch ? 'Auto-upgrade enabled' : 'Auto-upgrade disabled');
        } else {
          row.otaSwitch = !row.otaSwitch;
          this.$message.error(data.msg || 'Failed to update OTA setting');
        }
      });
    },
    handleModeSwitchChange(row) {
      const newMode = row.modeSwitch ? 'auto' : 'manual';
      Api.device.updateDeviceInfo(row.id, { deviceMode: newMode }, ({ data }) => {
        if (data.code === 0) {
          row.deviceMode = newMode;
          this.$message.success(row.modeSwitch ? 'Mode changed to Auto' : 'Mode changed to Manual');
        } else {
          row.modeSwitch = !row.modeSwitch;
          this.$message.error(data.msg || 'Failed to update device mode');
        }
      });
    },
    handleKidProfile(row) {
      if (!row.userId) {
        this.$message.warning('Device is not bound to any user. Cannot view kid profiles.');
        return;
      }
      this.$router.push({
        path: '/kid-profiles',
        query: {
          deviceId: row.id,
          macAddress: row.macAddress,
          kidId: row.kidId,
          userId: row.userId // Pass device owner's userId for admin view
        }
      });
    },
    handleUnbind(row) {
      if (!row.userId) {
        this.$message.warning('Device is not bound to any user');
        return;
      }

      this.$confirm('Are you sure you want to unbind this device?', 'Warning', {
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        Api.device.unbindDevice(row.id, ({ data }) => {
          if (data.code === 0) {
            this.$message.success('Device unbound successfully');
            this.loadDevices();
          } else {
            this.$message.error(data.msg || 'Failed to unbind device');
          }
        });
      }).catch(() => {});
    }
  }
}
</script>

<style scoped lang="scss">
.welcome {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(to bottom right, #fff5eb, #fff7f0, #ffe8d6);
}

.main-content {
  flex: 1;
  padding: 20px 40px;
  max-width: 1800px;
  margin: 0 auto;
  width: 100%;
}

.content-area {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 10px;
}

.left-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.search-input {
  width: 300px;
}

.mac-address {
  font-family: monospace;
  font-size: 13px;
}

.editable-text {
  cursor: pointer;

  &:hover {
    color: #5f70f3;
  }
}

.danger-btn {
  color: #f56c6c !important;
}

.pagination-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #ebeef5;
}

.total-info {
  color: #909399;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #909399;

  i {
    font-size: 48px;
    margin-bottom: 15px;
  }

  p {
    margin: 0;
  }
}
</style>
