<template>
  <div class="welcome">
    <HeaderBar/>

    <div class="operation-bar">
      <h2 class="page-title">Device Management</h2>
      <div class="right-operations">
        <el-input placeholder="Enter device model or MAC address to search" v-model="searchKeyword" class="search-input"
                  @keyup.enter.native="handleSearch" clearable/>
        <el-button class="btn-search" @click="handleSearch">Search</el-button>
      </div>
    </div>

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <el-card class="device-card" shadow="never">
            <el-table ref="deviceTable" :data="paginatedDeviceList" class="transparent-table"
                      :header-cell-class-name="headerCellClassName" v-loading="loading"
                      element-loading-text="Loading..."
                      element-loading-spinner="el-icon-loading" element-loading-background="rgba(255, 255, 255, 0.7)">
              <el-table-column label="Select" align="center" width="120">
                <template slot-scope="scope">
                  <el-checkbox v-model="scope.row.selected"></el-checkbox>
                </template>
              </el-table-column>
              <el-table-column label="Device Model" prop="model" align="center">
                <template slot-scope="scope">
                  {{ getFirmwareTypeName(scope.row.model) }}
                </template>
              </el-table-column>
              <el-table-column label="Firmware Version" prop="firmwareVersion" align="center"></el-table-column>
              <el-table-column label="MAC Address" prop="macAddress" align="center"></el-table-column>
              <el-table-column label="Bind Time" prop="bindTime" align="center"></el-table-column>
              <el-table-column label="Last Conversation" prop="lastConversation" align="center"></el-table-column>
              <el-table-column label="Remark" align="center">
                <template #default="{ row }">
                  <el-input
                      v-show="row.isEdit"
                      v-model="row.remark"
                      size="mini"
                      maxlength="64"
                      show-word-limit
                      @blur="onRemarkBlur(row)"
                      @keyup.enter.native="onRemarkEnter(row)"
                  />
                  <span v-show="!row.isEdit" class="remark-view">
                  <i
                      class="el-icon-edit"
                      @click="row.isEdit = true"
                      style="cursor: pointer;"
                  ></i>
                  <span @click="row.isEdit = true">
                    {{ row.remark || '—' }}
                  </span>
                </span>
                </template>
              </el-table-column>
              <el-table-column label="OTA Upgrade" align="center">
                <template slot-scope="scope">
                  <el-switch v-model="scope.row.otaSwitch" size="mini" active-color="#13ce66" inactive-color="#ff4949"
                             @change="handleOtaSwitchChange(scope.row)"></el-switch>
                </template>
              </el-table-column>
              <el-table-column label="Actions" align="center" min-width="200">
                <template slot-scope="scope">
                  <el-button size="mini" type="text" @click="handlePlaylist(scope.row)">
                    Playlist
                  </el-button>
                  <el-button size="mini" type="text" @click="handleKidProfile(scope.row)">
                    Kid Profile
                  </el-button>
                  <el-button size="mini" type="text" @click="handleUnbind(scope.row.device_id)">
                    Unbind
                  </el-button>
                </template>
              </el-table-column>
              <template slot="empty">
                <span>No toys</span>
              </template>
            </el-table>

            <div class="table_bottom">
              <div class="ctrl_btn">
                <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAll">
                  {{ isCurrentPageAllSelected ? 'Deselect All' : 'Select All' }}
                </el-button>
                <el-button type="success" size="mini" class="add-device-btn" @click="handleAddDevice">
                  Bind with Code
                </el-button>
                <el-button type="success" size="mini" class="add-device-btn" @click="handleManualAddDevice">
                  Manual Add
                </el-button>
                <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelected">Unbind</el-button>
              </div>
              <div class="custom-pagination">
                <el-select v-model="pageSize" @change="handlePageSizeChange" class="page-size-select">
                  <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item">
                  </el-option>
                </el-select>
                <button class="pagination-btn" :disabled="currentPage === 1" @click="goFirst">First</button>
                <button class="pagination-btn" :disabled="currentPage === 1" @click="goPrev">Previous</button>
                <button v-for="page in visiblePages" :key="page" class="pagination-btn"
                        :class="{ active: page === currentPage }" @click="goToPage(page)">
                  {{ page }}
                </button>
                <button class="pagination-btn" :disabled="currentPage === pageCount" @click="goNext">Next</button>
                <span class="total-text">Total {{ deviceList.length }} records</span>
              </div>
            </div>
          </el-card>
        </div>
      </div>
    </div>

    <AddDeviceDialog :visible.sync="addDeviceDialogVisible" :agent-id="currentAgentId"
                     @refresh="fetchBindDevices(currentAgentId)"/>
    <ManualAddDeviceDialog :visible.sync="manualAddDeviceDialogVisible" :agent-id="currentAgentId"
                     @refresh="fetchBindDevices(currentAgentId)"/>

    <!-- Playlist Dialog -->
    <el-dialog :title="'Playlist - ' + (playlistDevice.macAddress || '')" :visible.sync="playlistDialogVisible" width="650px" top="5vh">
      <el-tabs v-model="playlistActiveTab" @tab-click="handlePlaylistTabClick">
        <el-tab-pane label="Music Playlist" name="music">
          <div class="playlist-header">
            <span class="playlist-count">{{ musicPlaylist.length }} items</span>
            <div class="playlist-actions">
              <el-button type="primary" size="mini" @click="openContentPicker('music')">
                <i class="el-icon-plus"></i> Add Music
              </el-button>
              <el-button type="danger" size="mini" @click="handleClearPlaylist('music')" :disabled="musicPlaylist.length === 0">
                <i class="el-icon-delete"></i> Clear All
              </el-button>
            </div>
          </div>
          <el-table :data="musicPlaylist" v-loading="playlistLoading" max-height="350" empty-text="No music in playlist">
            <el-table-column type="index" label="#" width="50" align="center"></el-table-column>
            <el-table-column prop="title" label="Title" min-width="180">
              <template slot-scope="scope">
                <div class="playlist-item-title">
                  <i class="el-icon-video-play music-icon"></i>
                  {{ scope.row.content?.title || scope.row.title || 'Untitled' }}
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="category" label="Category" min-width="120">
              <template slot-scope="scope">
                {{ scope.row.content?.category || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="duration" label="Duration" width="80" align="center">
              <template slot-scope="scope">
                {{ formatDuration(scope.row.content?.duration_seconds) }}
              </template>
            </el-table-column>
            <el-table-column label="Actions" width="80" align="center">
              <template slot-scope="scope">
                <el-button type="text" size="mini" class="remove-btn" @click="handleRemoveFromPlaylist('music', scope.row)">
                  <i class="el-icon-close"></i>
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="Story Playlist" name="story">
          <div class="playlist-header">
            <span class="playlist-count">{{ storyPlaylist.length }} items</span>
            <div class="playlist-actions">
              <el-button type="primary" size="mini" @click="openContentPicker('story')">
                <i class="el-icon-plus"></i> Add Story
              </el-button>
              <el-button type="danger" size="mini" @click="handleClearPlaylist('story')" :disabled="storyPlaylist.length === 0">
                <i class="el-icon-delete"></i> Clear All
              </el-button>
            </div>
          </div>
          <el-table :data="storyPlaylist" v-loading="playlistLoading" max-height="350" empty-text="No stories in playlist">
            <el-table-column type="index" label="#" width="50" align="center"></el-table-column>
            <el-table-column prop="title" label="Title" min-width="200">
              <template slot-scope="scope">
                <div class="playlist-item-title">
                  <i class="el-icon-reading story-icon"></i>
                  {{ scope.row.content?.title || scope.row.title || 'Untitled' }}
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="category" label="Category" min-width="120">
              <template slot-scope="scope">
                {{ scope.row.content?.category || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="duration" label="Duration" width="80" align="center">
              <template slot-scope="scope">
                {{ formatDuration(scope.row.content?.duration_seconds) }}
              </template>
            </el-table-column>
            <el-table-column label="Actions" width="80" align="center">
              <template slot-scope="scope">
                <el-button type="text" size="mini" class="remove-btn" @click="handleRemoveFromPlaylist('story', scope.row)">
                  <i class="el-icon-close"></i>
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div slot="footer">
        <el-button @click="playlistDialogVisible = false">Close</el-button>
      </div>
    </el-dialog>

    <!-- Content Picker Dialog -->
    <el-dialog title="Add Content to Playlist" :visible.sync="contentPickerVisible" width="700px" top="5vh" append-to-body>
      <div class="content-picker-header">
        <el-input v-model="contentSearchQuery" placeholder="Search content..." size="small" clearable @input="searchContent" style="width: 250px;">
          <i slot="prefix" class="el-icon-search"></i>
        </el-input>
        <el-select v-model="contentFilterCategory" placeholder="Category" size="small" clearable @change="fetchAvailableContent" style="width: 150px; margin-left: 10px;">
          <el-option v-for="cat in contentCategories" :key="cat" :label="cat" :value="cat"></el-option>
        </el-select>
      </div>
      <el-table :data="availableContent" v-loading="contentPickerLoading" max-height="400" @selection-change="handleContentSelection">
        <el-table-column type="selection" width="45"></el-table-column>
        <el-table-column label="Thumbnail" width="60" align="center">
          <template slot-scope="scope">
            <img v-if="scope.row.thumbnail_url" :src="scope.row.thumbnail_url" class="content-thumbnail" />
            <i v-else :class="contentPickerType === 'music' ? 'el-icon-headset' : 'el-icon-reading'" class="content-icon"></i>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="Title" min-width="180">
          <template slot-scope="scope">
            <div>{{ scope.row.title }}</div>
            <div class="content-desc" v-if="scope.row.description">{{ scope.row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="Category" width="100"></el-table-column>
        <el-table-column prop="duration_seconds" label="Duration" width="80" align="center">
          <template slot-scope="scope">
            {{ formatDuration(scope.row.duration_seconds) }}
          </template>
        </el-table-column>
      </el-table>
      <div class="content-picker-footer">
        <span class="selected-count">{{ selectedContent.length }} selected</span>
        <el-pagination
          small
          layout="prev, pager, next"
          :total="contentTotalCount"
          :page-size="contentPageSize"
          :current-page.sync="contentCurrentPage"
          @current-change="fetchAvailableContent">
        </el-pagination>
      </div>
      <div slot="footer">
        <el-button @click="contentPickerVisible = false">Cancel</el-button>
        <el-button type="primary" @click="addSelectedToPlaylist" :disabled="selectedContent.length === 0" :loading="addingToPlaylist">
          Add {{ selectedContent.length }} Item(s)
        </el-button>
      </div>
    </el-dialog>

  </div>
</template>

<script>
import Api from '@/apis/api';
import AddDeviceDialog from "@/components/AddDeviceDialog.vue";
import ManualAddDeviceDialog from "@/components/ManualAddDeviceDialog.vue";
import HeaderBar from "@/components/HeaderBar.vue";

export default {
  components: {
    HeaderBar, 
    AddDeviceDialog,
    ManualAddDeviceDialog
  },
  data() {
    return {
      addDeviceDialogVisible: false,
      manualAddDeviceDialogVisible: false,
      searchKeyword: "",
      activeSearchKeyword: "",
      currentAgentId: this.$route.query.agentId || '',
      currentPage: 1,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50, 100],
      deviceList: [],
      loading: false,
      userApi: null,
      firmwareTypes: [],
      // Playlist dialog
      playlistDialogVisible: false,
      playlistDevice: {},
      playlistActiveTab: 'music',
      playlistLoading: false,
      musicPlaylist: [],
      storyPlaylist: [],
      // Content picker
      contentPickerVisible: false,
      contentPickerType: 'music',
      contentPickerLoading: false,
      availableContent: [],
      selectedContent: [],
      contentSearchQuery: '',
      contentFilterCategory: '',
      contentCategories: [],
      contentTotalCount: 0,
      contentCurrentPage: 1,
      contentPageSize: 10,
      addingToPlaylist: false,
    };
  },
  computed: {
    filteredDeviceList() {
      const keyword = this.activeSearchKeyword.toLowerCase();
      if (!keyword) return this.deviceList;
      return this.deviceList.filter(device =>
          (device.model && device.model.toLowerCase().includes(keyword)) ||
          (device.macAddress && device.macAddress.toLowerCase().includes(keyword))
      );
    },

    paginatedDeviceList() {
      const start = (this.currentPage - 1) * this.pageSize;
      const end = start + this.pageSize;
      return this.filteredDeviceList.slice(start, end);
    },
    pageCount() {
      return Math.ceil(this.filteredDeviceList.length / this.pageSize);
    },
    // Calculate if current page is fully selected
    isCurrentPageAllSelected() {
      return this.paginatedDeviceList.length > 0 && 
             this.paginatedDeviceList.every(device => device.selected);
    },
    visiblePages() {
      const pages = [];
      const maxVisible = 3;
      let start = Math.max(1, this.currentPage - 1);
      let end = Math.min(this.pageCount, start + maxVisible - 1);

      if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    },
  },
  mounted() {
    const agentId = this.$route.query.agentId;
    const macAddress = this.$route.query.macAddress;

    if (agentId) {
      this.fetchBindDevices(agentId);
    } else if (macAddress) {
      // Fetch single device by MAC (from User Management navigation)
      this.fetchDeviceByMac(macAddress);
    }
  },
  created() {
    this.getFirmwareTypes()
  },
  methods: {
    async getFirmwareTypes() {
      try {
        const res = await Api.dict.getDictDataByType('FIRMWARE_TYPE')
        this.firmwareTypes = res.data
      } catch (error) {
        console.error('Failed to get firmware types:', error)
        this.$message.error(error.message || 'Failed to get firmware types')
      }
    },
    handlePageSizeChange(val) {
      this.pageSize = val;
      this.currentPage = 1;
    },
    handleSearch() {
      this.activeSearchKeyword = this.searchKeyword;
      this.currentPage = 1;
    },

    handleSelectAll() {
      const shouldSelectAll = !this.isCurrentPageAllSelected;
      this.paginatedDeviceList.forEach(row => {
        row.selected = shouldSelectAll;
      });
    },

    deleteSelected() {
      const selectedDevices = this.paginatedDeviceList.filter(device => device.selected);
      if (selectedDevices.length === 0) {
        this.$message.warning({
          message: 'Please select at least one record',
          showClose: true
        });
        return;
      }

      this.$confirm(`Are you sure you want to unbind ${selectedDevices.length} selected device(s)?`, 'Warning', {
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        const deviceIds = selectedDevices.map(device => device.device_id);
        this.batchUnbindDevices(deviceIds);
      });
    },
    batchUnbindDevices(deviceIds) {
      const promises = deviceIds.map(id => {
        return new Promise((resolve, reject) => {
          Api.device.unbindDevice(id, ({data}) => {
            if (data.code === 0) {
              resolve();
            } else {
              reject(data.msg || 'Unbind failed');
            }
          });
        });
      });
      Promise.all(promises)
          .then(() => {
            this.$message.success({
              message: `Successfully unbound ${deviceIds.length} device(s)`,
              showClose: true
            });
            this.fetchBindDevices(this.currentAgentId);
          })
          .catch(error => {
            this.$message.error({
              message: error || 'Error occurred during batch unbinding',
              showClose: true
            });
          });
    },
    handleAddDevice() {
      this.addDeviceDialogVisible = true;
    },
    handleManualAddDevice() {
      this.manualAddDeviceDialogVisible = true;
    },
    submitRemark(row) {
      if (row._submitting) return;

      const text = (row.remark || '').trim();
      if (text.length > 64) {
        this.$message.warning('Remark cannot exceed 64 characters');
        return;
      }
      if (text === row._originalRemark) {
        return;
      }

      row._submitting = true;
      this.updateDeviceInfo(row.device_id, { alias: text }, (ok, resp) => {
        if (ok) {
          row._originalRemark = text;
          this.$message.success('Remark saved');
        } else {
          row.remark = row._originalRemark;
          this.$message.error(resp.msg || 'Failed to save remark');
        }
        row._submitting = false;
      });
    },
    // Remark input: Submit on blur
    onRemarkBlur(row) {
      row.isEdit = false;
      setTimeout(() => {
        this.submitRemark(row);
      }, 100); // Delay 100ms to avoid enter+blur simultaneous trigger
    },
    // Remark input: Submit on Enter key
    onRemarkEnter(row) {
      row.isEdit = false;
      this.submitRemark(row);
    },
    handleUnbind(device_id) {
      this.$confirm('Are you sure you want to unbind this device?', 'Warning', {
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        Api.device.unbindDevice(device_id, ({data}) => {
          if (data.code === 0) {
            this.$message.success({
              message: 'Device unbound successfully',
              showClose: true
            });
            this.fetchBindDevices(this.$route.query.agentId);
          } else {
            this.$message.error({
              message: data.msg || 'Failed to unbind device',
              showClose: true
            });
          }
        });
      });
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
    goToPage(page) {
      this.currentPage = page;
    },

    fetchBindDevices(agentId) {
      this.loading = true;
      Api.device.getAgentBindDevices(agentId, ({data}) => {
        this.loading = false;
        if (data.code === 0) {
          this.deviceList = data.data.map(device => {
            return {
              device_id: device.id,
              model: device.board,
              firmwareVersion: device.appVersion,
              macAddress: device.macAddress,
              bindTime: device.createDate,
              lastConversation: device.lastConnectedAt,
              remark: device.alias,
              _originalRemark: device.alias,
              isEdit: false,
              _submitting: false,
              otaSwitch: device.autoUpdate === 1,
              rawBindTime: new Date(device.createDate).getTime(),
              selected: false,
              kidId: device.kidId || device.kid_id || null
            };
          })
              .sort((a, b) => a.rawBindTime - b.rawBindTime);
          this.activeSearchKeyword = "";
          this.searchKeyword = "";
        } else {
          this.$message.error(data.msg || 'Failed to get device list');
        }
      });
    },
    fetchDeviceByMac(macAddress) {
      this.loading = true;
      Api.device.getDeviceByMac(macAddress, ({data}) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          const device = data.data;
          this.deviceList = [{
            device_id: device.id,
            model: device.board,
            firmwareVersion: device.app_version,
            macAddress: device.mac_address,
            bindTime: device.create_date,
            lastConversation: device.last_connected_at,
            remark: device.alias,
            _originalRemark: device.alias,
            isEdit: false,
            _submitting: false,
            otaSwitch: device.auto_update === 1,
            rawBindTime: device.create_date ? new Date(device.create_date).getTime() : 0,
            selected: false,
            kidId: device.kid_id || null
          }];
          this.activeSearchKeyword = "";
          this.searchKeyword = "";
        } else {
          this.$message.error(data.msg || 'Device not found');
        }
      });
    },
    headerCellClassName({columnIndex}) {
      if (columnIndex === 0) {
        return "custom-selection-header";
      }
      return "";
    },
    getFirmwareTypeName(type) {
      const firmwareType = this.firmwareTypes.find(item => item.key === type)
      return firmwareType ? firmwareType.name : type
    },
    updateDeviceInfo(device_id, payload, callback) {
      return Api.device.updateDeviceInfo(device_id, payload, ({data}) => {
        callback(data.code === 0, data);
      })
    },
    handleOtaSwitchChange(row) {
      this.updateDeviceInfo(row.device_id, {autoUpdate: row.otaSwitch ? 1 : 0}, (result, {msg}) => {
        if (result) {
          this.$message.success(row.otaSwitch ? 'Auto-upgrade enabled' : 'Auto-upgrade disabled');
          return;
        }
        row.otaSwitch = !row.otaSwitch
        this.$message.error(msg || 'Operation failed')
      })
    },
    handleKidProfile(row) {
      this.$router.push({
        path: '/kid-profiles',
        query: {
          deviceId: row.device_id,
          macAddress: row.macAddress,
          kidId: row.kidId
        }
      });
    },

    // Playlist methods
    handlePlaylist(row) {
      this.playlistDevice = row;
      this.playlistDialogVisible = true;
      this.playlistActiveTab = 'music';
      this.fetchPlaylists();
    },

    handlePlaylistTabClick() {
      // Tab already changed, data is pre-fetched
    },

    fetchPlaylists() {
      this.playlistLoading = true;
      const mac = this.playlistDevice.macAddress;

      // Fetch both playlists in parallel
      Promise.all([
        new Promise(resolve => {
          Api.device.getMusicPlaylist(mac, ({ data }) => {
            if (data.code === 0) {
              this.musicPlaylist = data.data || [];
            } else {
              this.musicPlaylist = [];
            }
            resolve();
          });
        }),
        new Promise(resolve => {
          Api.device.getStoryPlaylist(mac, ({ data }) => {
            if (data.code === 0) {
              this.storyPlaylist = data.data || [];
            } else {
              this.storyPlaylist = [];
            }
            resolve();
          });
        })
      ]).finally(() => {
        this.playlistLoading = false;
      });
    },

    handleRemoveFromPlaylist(type, item) {
      const contentId = item.contentId || item.content_id || item.id;
      const mac = this.playlistDevice.macAddress;
      const title = item.content?.title || item.title || 'this item';

      this.$confirm(`Remove "${title}" from ${type} playlist?`, 'Confirm', {
        confirmButtonText: 'Remove',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        if (type === 'music') {
          Api.device.removeFromMusicPlaylist(mac, contentId, ({ data }) => {
            if (data.code === 0) {
              this.$message.success('Removed from playlist');
              this.fetchPlaylists();
            } else {
              this.$message.error(data.msg || 'Failed to remove');
            }
          });
        } else {
          Api.device.removeFromStoryPlaylist(mac, contentId, ({ data }) => {
            if (data.code === 0) {
              this.$message.success('Removed from playlist');
              this.fetchPlaylists();
            } else {
              this.$message.error(data.msg || 'Failed to remove');
            }
          });
        }
      }).catch(() => {});
    },

    handleClearPlaylist(type) {
      const mac = this.playlistDevice.macAddress;
      const count = type === 'music' ? this.musicPlaylist.length : this.storyPlaylist.length;

      this.$confirm(`Clear all ${count} items from ${type} playlist?`, 'Clear Playlist', {
        confirmButtonText: 'Clear All',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        if (type === 'music') {
          Api.device.clearMusicPlaylist(mac, ({ data }) => {
            if (data.code === 0) {
              this.$message.success('Music playlist cleared');
              this.musicPlaylist = [];
            } else {
              this.$message.error(data.msg || 'Failed to clear playlist');
            }
          });
        } else {
          Api.device.clearStoryPlaylist(mac, ({ data }) => {
            if (data.code === 0) {
              this.$message.success('Story playlist cleared');
              this.storyPlaylist = [];
            } else {
              this.$message.error(data.msg || 'Failed to clear playlist');
            }
          });
        }
      }).catch(() => {});
    },

    formatDuration(seconds) {
      if (!seconds) return '-';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    // Content picker methods
    openContentPicker(type) {
      this.contentPickerType = type;
      this.contentPickerVisible = true;
      this.selectedContent = [];
      this.contentSearchQuery = '';
      this.contentFilterCategory = '';
      this.contentCurrentPage = 1;
      this.fetchAvailableContent();
      this.fetchContentCategories();
    },

    fetchContentCategories() {
      // getLibraryCategories expects contentType as string, not object
      Api.content.getLibraryCategories(this.contentPickerType, ({ data }) => {
        if (data.code === 0 && data.data) {
          this.contentCategories = [...new Set(data.data.map(c => c.category).filter(Boolean))];
        }
      });
    },

    fetchAvailableContent() {
      this.contentPickerLoading = true;
      const params = {
        page: this.contentCurrentPage,
        limit: this.contentPageSize,
        contentType: this.contentPickerType,
        search: this.contentSearchQuery || undefined,
        category: this.contentFilterCategory || undefined,
      };

      Api.content.getLibraryList(params, ({ data }) => {
        this.contentPickerLoading = false;
        if (data.code === 0) {
          // API returns { list, total, page, limit }
          this.availableContent = data.data?.list || data.data?.items || [];
          this.contentTotalCount = data.data?.total || this.availableContent.length;
        } else {
          this.availableContent = [];
          this.contentTotalCount = 0;
        }
      });
    },

    searchContent() {
      // Debounce search
      clearTimeout(this._searchTimeout);
      this._searchTimeout = setTimeout(() => {
        this.contentCurrentPage = 1;
        this.fetchAvailableContent();
      }, 300);
    },

    handleContentSelection(selection) {
      this.selectedContent = selection;
    },

    async addSelectedToPlaylist() {
      if (this.selectedContent.length === 0) return;

      this.addingToPlaylist = true;
      const mac = this.playlistDevice.macAddress;
      const type = this.contentPickerType;
      let successCount = 0;
      let errorCount = 0;

      for (const content of this.selectedContent) {
        try {
          await new Promise((resolve, reject) => {
            if (type === 'music') {
              Api.device.addToMusicPlaylist(mac, content.id, ({ data }) => {
                if (data.code === 0) {
                  successCount++;
                  resolve();
                } else {
                  errorCount++;
                  resolve(); // Continue even on error
                }
              });
            } else {
              Api.device.addToStoryPlaylist(mac, content.id, ({ data }) => {
                if (data.code === 0) {
                  successCount++;
                  resolve();
                } else {
                  errorCount++;
                  resolve();
                }
              });
            }
          });
        } catch (e) {
          errorCount++;
        }
      }

      this.addingToPlaylist = false;

      if (successCount > 0) {
        this.$message.success(`Added ${successCount} item(s) to playlist`);
        this.fetchPlaylists();
      }
      if (errorCount > 0) {
        this.$message.warning(`${errorCount} item(s) failed (may already exist)`);
      }

      this.contentPickerVisible = false;
    },
  }
};
</script>

<style scoped>
.welcome {
  min-width: 900px;
  min-height: 506px;
  height: 100vh;
  display: flex;
  position: relative;
  flex-direction: column;
  background: linear-gradient(to bottom right, #fff5eb, #fff7f0, #ffe8d6);
  background-size: cover;
  -webkit-background-size: cover;
  -o-background-size: cover;
}

.main-wrapper {
  margin: 5px 22px;
  border-radius: 15px;
  min-height: calc(100vh - 24vh);
  height: auto;
  max-height: 80vh;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  position: relative;
  background: rgba(237, 242, 255, 0.5);
  display: flex;
  flex-direction: column;
}

.operation-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
}

.page-title {
  font-size: 24px;
  margin: 0;
  color: #2c3e50;
}

.right-operations {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.search-input {
  width: 280px;
  border-radius: 4px;
}

.btn-search {
  background: linear-gradient(135deg, #6b8cff, #a966ff);
  border: none;
  color: white;
}

::v-deep .search-input .el-input__inner {
  border-radius: 4px;
  border: 1px solid #DCDFE6;
  background-color: white;
  transition: border-color 0.2s;
}

::v-deep .page-size-select {
  width: 100px;
  margin-right: 8px;
}

::v-deep .page-size-select .el-input__inner {
  height: 32px;
  line-height: 32px;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  background: #dee7ff;
  color: #606266;
  font-size: 14px;
}

::v-deep .page-size-select .el-input__suffix {
  right: 6px;
  width: 15px;
  height: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  top: 6px;
  border-radius: 4px;
}

::v-deep .page-size-select .el-input__suffix-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

::v-deep .page-size-select .el-icon-arrow-up:before {
  content: "";
  display: inline-block;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 9px solid #606266;
  position: relative;
  transform: rotate(0deg);
  transition: transform 0.3s;
}

::v-deep .search-input .el-input__inner:focus {
  border-color: #6b8cff;
  outline: none;
}

.content-panel {
  flex: 1;
  display: flex;
  overflow: hidden;
  height: 100%;
  border-radius: 15px;
  background: transparent;
  border: 1px solid #fff;
}

.content-area {
  flex: 1;
  height: 100%;
  min-width: 600px;
  overflow: auto;
  background-color: white;
  display: flex;
  flex-direction: column;
}

.device-card {
  background: white;
  border: none;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

::v-deep .el-card__body {
  padding: 15px;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.table_bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding-bottom: 10px;
}


.ctrl_btn {
  display: flex;
  gap: 8px;
  padding-left: 26px;
}

.ctrl_btn .el-button {
  min-width: 72px;
  height: 32px;
  padding: 7px 12px 7px 10px;
  font-size: 12px;
  border-radius: 4px;
  line-height: 1;
  font-weight: 500;
  border: none;
  transition: all 0.3s ease;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.ctrl_btn .el-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.ctrl_btn .el-button--primary {
  background: #5f70f3;
  color: white;
}

.ctrl_btn .el-button--success {
  background: #5bc98c;
  color: white;
}

.ctrl_btn .el-button--danger {
  background: #fd5b63;
  color: white;
}

.custom-pagination {
  display: flex;
  align-items: center;
  gap: 10px;
}

.custom-pagination .el-select {
  margin-right: 8px;
}

.custom-pagination .pagination-btn:first-child,
.custom-pagination .pagination-btn:nth-child(2),
.custom-pagination .pagination-btn:nth-last-child(2),
.custom-pagination .pagination-btn:nth-child(3) {
  min-width: 60px;
  height: 32px;
  padding: 0 12px;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  background: #dee7ff;
  color: #606266;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.custom-pagination .pagination-btn:first-child:hover,
.custom-pagination .pagination-btn:nth-child(2):hover,
.custom-pagination .pagination-btn:nth-last-child(2):hover,
.custom-pagination .pagination-btn:nth-child(3):hover {
  background: #d7dce6;
}

.custom-pagination .pagination-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.custom-pagination .pagination-btn:not(:first-child):not(:nth-child(3)):not(:nth-child(2)):not(:nth-last-child(2)) {
  min-width: 28px;
  height: 32px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: #606266;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.custom-pagination .pagination-btn:not(:first-child):not(:nth-child(3)):not(:nth-child(2)):not(:nth-last-child(2)):hover {
  background: rgba(245, 247, 250, 0.3);
}

.custom-pagination .pagination-btn.active {
  background: #5f70f3 !important;
  color: #ffffff !important;
  border-color: #5f70f3 !important;
}

.custom-pagination .pagination-btn.active:hover {
  background: #6d7cf5 !important;
}

.custom-pagination .total-text {
  color: #909399;
  font-size: 14px;
  margin-left: 10px;
}

:deep(.transparent-table) {
  background: white;
  border: none;
}

:deep(.transparent-table .el-table__header th) {
  background: white !important;
  color: black;
  border-right: none !important;
}

:deep(.transparent-table .el-table__body tr td) {
  border-top: 1px solid rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  border-right: none !important;
}

:deep(.transparent-table .el-table__header tr th:first-child .cell),
:deep(.transparent-table .el-table__body tr td:first-child .cell) {
  padding-left: 10px;
}

:deep(.el-icon-edit) {
  color: #7079aa;
  cursor: pointer;
}

:deep(.el-icon-edit:hover) {
  color: #5a64b5;
}

:deep(.custom-selection-header .el-checkbox) {
  display: none !important;
}


:deep(.el-table .el-button--text) {
  color: #7079aa;
}

:deep(.el-table .el-button--text:hover) {
  color: #5a64b5;
}

:deep(.transparent-table) {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 40vh);
}

:deep(.el-table__body-wrapper) {
  flex: 1;
  overflow-y: auto;
  max-height: none !important;
}

:deep(.el-table__header-wrapper) {
  flex-shrink: 0;
}

@media (min-width: 1144px) {
  .table_bottom {
    margin-top: 40px;
  }

  :deep(.transparent-table) .el-table__body tr td {
    padding-top: 16px;
    padding-bottom: 16px;
  }
}

:deep(.el-checkbox__inner) {
  background-color: #eeeeee !important;
  border-color: #cccccc !important;
}

:deep(.el-checkbox__inner:hover) {
  border-color: #cccccc !important;
}

:deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: #5f70f3 !important;
  border-color: #5f70f3 !important;
}

::v-deep .el-table--border::after,
::v-deep .el-table--group::after,
::v-deep .el-table::before {
  display: none !important;
}

/* Playlist Dialog Styles */
.playlist-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.playlist-count {
  font-size: 13px;
  color: #909399;
}

.playlist-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.music-icon {
  color: #409EFF;
  font-size: 16px;
}

.story-icon {
  color: #67C23A;
  font-size: 16px;
}

.remove-btn {
  color: #F56C6C !important;
}

.remove-btn:hover {
  color: #f78989 !important;
}

::v-deep .el-dialog__body {
  padding-top: 10px;
}

::v-deep .el-tabs__nav-wrap::after {
  height: 1px;
}

::v-deep .el-tabs__item {
  font-size: 14px;
  font-weight: 500;
}

::v-deep .el-tabs__item.is-active {
  color: #5f70f3;
}

::v-deep .el-tabs__active-bar {
  background-color: #5f70f3;
}

.playlist-actions {
  display: flex;
  gap: 8px;
}

/* Content Picker Styles */
.content-picker-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.content-thumbnail {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
}

.content-icon {
  font-size: 24px;
  color: #909399;
}

.content-desc {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.content-picker-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #ebeef5;
}

.selected-count {
  font-size: 13px;
  color: #606266;
}
</style>
