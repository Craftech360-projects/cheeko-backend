<template>
  <div class="welcome">

    <div class="page-head">
      <div>
        <h1 class="page-title">Users</h1>
        <p class="page-lead">Parent accounts, their children and the toys attached to each household.</p>
      </div>
    </div>

    <ListToolbar
      :count="total"
      count-noun="users"
      :total="total"
      :sort-options="sortOptions"
      :sort-by.sync="sortBy"
      :sort-dir.sync="sortDir"
      :group-options="groupOptions"
      :group-by.sync="groupBy"
      :selecting.sync="selecting"
      :selected-count="selectedCount"
      :all-selected="isAllSelected"
      :search.sync="searchPhone"
      search-placeholder="Enter phone number to search"
      @select-all-matching="selectAllRows"
      @clear-selection="clearSelection"
    >
      <template #filters>
        <el-select v-model="filterStatus" size="mini" placeholder="Status" clearable class="lb-filter">
          <el-option label="Active" :value="1" />
          <el-option label="Disabled" :value="0" />
        </el-select>
      </template>
      <template #bulk>
        <el-button @click="batchEnable">Enable</el-button>
        <el-button @click="batchDisable">Disable</el-button>
        <el-button type="danger" @click="batchDelete">Delete</el-button>
      </template>
    </ListToolbar>

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <el-card class="user-card" shadow="never">
            <el-table ref="userTable" :data="visibleRows" class="transparent-table" v-loading="loading"
              :row-class-name="userRowClass"
              @sort-change="onTableSortChange"
              element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
              element-loading-background="rgba(250, 249, 247, 0.75)">
              <el-table-column v-if="selecting" label="" align="center" width="52">
                <template slot-scope="scope">
                  <el-checkbox v-model="scope.row.selected"></el-checkbox>
                </template>
              </el-table-column>
              <el-table-column label="User ID" prop="userid" sortable="custom" min-width="120">
                <template slot-scope="scope"><span class="mono">{{ scope.row.userid }}</span></template>
              </el-table-column>
              <el-table-column label="User Name" prop="mobile" sortable="custom" min-width="160">
                <template slot-scope="scope">
                  <div class="rowid">
                    <span class="rowid-mark accent">{{ initials(scope.row.mobile) }}</span>
                    <span class="cell-key">{{ scope.row.mobile }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="Device Count" prop="deviceCount" sortable="custom" align="right" min-width="120">
                <template slot-scope="scope">
                  <el-popover
                    v-if="scope.row.devices && scope.row.devices.length > 0"
                    placement="bottom"
                    trigger="hover"
                    popper-class="device-list-popover"
                  >
                    <div class="device-mac-list">
                      <div class="device-mac-title">Devices ({{ scope.row.devices.length }})</div>
                      <div
                        v-for="device in scope.row.devices"
                        :key="device.id"
                        class="device-mac-item"
                        @click="goToDeviceManagement(device)"
                      >
                        {{ device.macAddress }}
                      </div>
                    </div>
                    <span slot="reference" class="device-count-link">{{ scope.row.deviceCount }}</span>
                  </el-popover>
                  <span v-else>{{ scope.row.deviceCount }}</span>
                </template>
              </el-table-column>
              <el-table-column label="Registration Time" prop="createDate" sortable="custom" min-width="160">
                <template slot-scope="scope"><span class="mono">{{ scope.row.createDate }}</span></template>
              </el-table-column>
              <el-table-column label="Status" prop="status" sortable="custom" width="110">
                <template slot-scope="scope">
                  <span class="chip" :class="scope.row.status === 1 ? 'ok' : 'bad'">
                    {{ scope.row.status === 1 ? 'Active' : 'Disabled' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="Actions" align="right" min-width="300">
                <template slot-scope="scope">
                  <el-button size="mini" type="text" @click="viewKidProfiles(scope.row)">Kid Profiles</el-button>
                  <el-button size="mini" type="text" @click="resetPassword(scope.row)">Reset Password</el-button>
                  <el-button size="mini" type="text" v-if="scope.row.status === 1"
                    @click="handleChangeStatus(scope.row, 0)">Disable Account</el-button>
                  <el-button size="mini" type="text" v-if="scope.row.status === 0"
                    @click="handleChangeStatus(scope.row, 1)">Enable Account</el-button>
                  <el-button size="mini" type="text" @click="deleteUser(scope.row)">Delete User</el-button>
                </template>
              </el-table-column>
            </el-table>

            <div class="table_bottom">
              <div class="ctrl_btn">
                <span class="muted">Showing {{ visibleRows.length }} of {{ total }} users</span>
              </div>
              <div class="custom-pagination">
                <el-select v-model="pageSize" @change="handlePageSizeChange" class="page-size-select">
                  <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item">
                  </el-option>
                </el-select>

                <button class="pagination-btn" :disabled="currentPage === 1" @click="goFirst">
                  First
                </button>
                <button class="pagination-btn" :disabled="currentPage === 1" @click="goPrev">
                  Previous
                </button>
                <button v-for="page in visiblePages" :key="page" class="pagination-btn"
                  :class="{ active: page === currentPage }" @click="goToPage(page)">
                  {{ page }}
                </button> <button class="pagination-btn" :disabled="currentPage === pageCount" @click="goNext">
                  Next
                </button>
                <span class="total-text">Total {{ total }} records</span>
              </div>
            </div>
          </el-card>
        </div>
      </div>
    </div>

    <view-password-dialog :visible.sync="showViewPassword" :password="currentPassword" />

    <!-- Kid Profiles Dialog -->
    <el-dialog :title="`Kid Profiles - ${selectedUserName}`" :visible.sync="showKidProfiles" width="700px">
      <el-table :data="kidProfilesList" v-loading="loadingKidProfiles" style="width: 100%">
        <el-table-column prop="name" label="Name" min-width="120" />
        <el-table-column prop="nickname" label="Nickname" min-width="100" />
        <el-table-column label="Age" min-width="60">
          <template slot-scope="scope">
            {{ calculateAge(scope.row.date_of_birth || scope.row.birth_date || scope.row.birthDate) }}
          </template>
        </el-table-column>
        <el-table-column prop="gender" label="Gender" min-width="70" />
        <el-table-column label="Interests" min-width="180">
          <template slot-scope="scope">
            <el-tag v-for="interest in (scope.row.interests || [])" :key="interest" size="mini" style="margin-right: 3px;">
              {{ interest }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Language" min-width="80">
          <template slot-scope="scope">
            {{ scope.row.primary_language || scope.row.language || '-' }}
          </template>
        </el-table-column>
      </el-table>
      <div v-if="kidProfilesList.length === 0 && !loadingKidProfiles" style="text-align: center; padding: 30px; color: #A8A199;">
        <i class="el-icon-user" style="font-size: 32px; margin-bottom: 10px; display: block;"></i>
        No kid profiles found for this user
      </div>
      <span slot="footer" class="dialog-footer">
        <el-button @click="showKidProfiles = false">Close</el-button>
      </span>
    </el-dialog>

    <el-footer>
      <version-footer />
    </el-footer>
  </div>
</template>

<script>
import Api from "@/apis/api";
import VersionFooter from "@/components/VersionFooter.vue";
import ViewPasswordDialog from "@/components/ViewPasswordDialog.vue";
import ListToolbar from "@/components/ListToolbar.vue";
import listControls from "@/mixins/listControls";
export default {
  name: 'UserManagement',
  components: { ViewPasswordDialog, VersionFooter, ListToolbar },
  mixins: [listControls],
  data() {
    return {
      // list controls — selection stays on `row.selected`, which the existing
      // batch handlers already read
      sortBy: 'createDate',
      sortDir: 'desc',
      sortOptions: [
        { label: 'Registration time', value: 'createDate' },
        { label: 'User name', value: 'mobile' },
        { label: 'User ID', value: 'userid' },
        { label: 'Device count', value: 'deviceCount' },
        { label: 'Status', value: 'status' }
      ],
      groupOptions: [
        { label: 'None', value: '' },
        { label: 'Status', value: 'status' }
      ],
      filterStatus: '',
      searchTimer: null,
      showViewPassword: false,
      currentPassword: "",
      searchPhone: "",
      userList: [],
      pageSizeOptions: [10, 20, 50, 100],
      currentPage: 1,
      pageSize: 10,
      total: 0,
      isAllSelected: false,
      loading: false,
      // Kid profiles
      showKidProfiles: false,
      loadingKidProfiles: false,
      kidProfilesList: [],
      selectedUserName: '' };
  },
  created() {
    this.fetchUsers();
  },
  beforeDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },
  watch: {
    // The toolbar's search box drives the same server-side lookup the old
    // input + button did, debounced instead of requiring Enter.
    searchPhone() {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.handleSearch(), 350);
    }
  },
  computed: {
    // Preserve object identity so `row.selected` keeps working
    sourceRows() {
      if (this.filterStatus === '' || this.filterStatus === null) return this.userList;
      return this.userList.filter(row => row.status === this.filterStatus);
    },
    selectedCount() {
      return this.userList.filter(row => row.selected).length;
    },
    pageCount() {
      return Math.ceil(this.total / this.pageSize);
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
    } },
  methods: {
    handlePageSizeChange(val) {
      this.pageSize = val;
      this.currentPage = 1;
      this.fetchUsers();
    },

    fetchUsers() {
      this.loading = true;
      Api.admin.getUserList(
        {
          page: this.currentPage,
          limit: this.pageSize,
          mobile: this.searchPhone },
        ({ data }) => {
          this.loading = false; // End loading
          if (data.code === 0) {
            this.userList = data.data.list.map(item => ({
              ...item,
              selected: false
            }));
            this.total = data.data.total;
          }
        }
      );
    },
    handleSearch() {
      this.currentPage = 1;
      this.fetchUsers();
    },
    initials(name) {
      const value = String(name || '').trim();
      if (!value) return '—';
      return value.replace(/\D/g, '').slice(-2) || value.slice(0, 2).toUpperCase();
    },
    userRowClass({ row }) {
      return row.selected ? 'selected-row' : '';
    },
    selectAllRows() {
      this.isAllSelected = true;
      this.userList.forEach(row => { row.selected = true; });
    },
    clearSelection() {
      this.isAllSelected = false;
      this.userList.forEach(row => { row.selected = false; });
    },
    handleSelectAll() {
      this.isAllSelected = !this.isAllSelected;
      this.userList.forEach(row => {
        row.selected = this.isAllSelected;
      });
    },
    batchDelete() {
      const selectedUsers = this.userList.filter(user => user.selected);
      if (selectedUsers.length === 0) {
        this.$message.warning("Please select users to delete first");
        return;
      }

      this.$confirm(`Are you sure you want to delete ${selectedUsers.length} selected users?`, "Warning", {
        confirmButtonText: "Confirm",
        cancelButtonText: "Cancel",
        type: "warning" })
        .then(async () => {
          const loading = this.$loading({
            lock: true,
            text: "Deleting...",
            spinner: "el-icon-loading",
            background: "rgba(0, 0, 0, 0.7)" });

          try {
            const results = await Promise.all(
              selectedUsers.map((user) => {
                return new Promise((resolve) => {
                  Api.admin.deleteUser(user.userid, ({ data }) => {
                    if (data.code === 0) {
                      resolve({ success: true, userid: user.userid });
                    } else {
                      resolve({ success: false, userid: user.userid, msg: data.msg });
                    }
                  });
                });
              })
            );

            const successCount = results.filter((r) => r.success).length;
            const failCount = results.length - successCount;

            if (failCount === 0) {
              this.$message.success({
                message: `Successfully deleted ${successCount} users`,
                showClose: true
              });
            } else if (successCount === 0) {
              this.$message.error({
                message: 'Delete failed, please try again',
                showClose: true
              });
            } else {
              this.$message.warning(
                `Successfully deleted ${successCount} users, ${failCount} failed`
              );
            }

            this.fetchUsers();
          } catch (error) {
            this.$message.error("Error occurred during deletion");
          } finally {
            loading.close();
          }
        })
        .catch(() => {
          this.$message.info("Delete cancelled");
        });
    },
    batchEnable() {
      const selectedUsers = this.userList.filter(user => user.selected);
      this.handleChangeStatus(selectedUsers, 1);
    },
    batchDisable() {
      const selectedUsers = this.userList.filter(user => user.selected);
      this.handleChangeStatus(selectedUsers, 0);
    },
    resetPassword(row) {
      this.$confirm("A new password will be generated after reset, continue?", "Tip", {
        confirmButtonText: "Confirm",
        cancelButtonText: "Cancel" }).then(() => {
        Api.admin.resetUserPassword(row.userid, ({ data }) => {
          if (data.code === 0) {
            this.currentPassword = data.data;
            this.showViewPassword = true;
            this.$message.success({
              message: "Password has been reset, please notify the user to login with the new password",
              showClose: true
            });
          }
        });
      });
    },
    deleteUser(row) {
      this.$confirm("Are you sure you want to delete this user?", "Warning", {
        confirmButtonText: "Confirm",
        cancelButtonText: "Cancel",
        type: "warning" })
        .then(() => {
          Api.admin.deleteUser(row.userid, ({ data }) => {
            if (data.code === 0) {
              this.$message.success({
                message: "Delete successful",
                showClose: true
              });
              this.fetchUsers();
            } else {
              this.$message.error({
                message: data.msg || "Delete failed",
                showClose: true
              });
            }
          });
        })
        .catch(() => { });
    },
    goFirst() {
      this.currentPage = 1;
      this.fetchUsers();
    },
    goPrev() {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.fetchUsers();
      }
    },
    goNext() {
      if (this.currentPage < this.pageCount) {
        this.currentPage++;
        this.fetchUsers();
      }
    },
    goToPage(page) {
      this.currentPage = page;
      this.fetchUsers();
    },
    handleChangeStatus(row, status) {
      // Handle single user or user array
      const users = Array.isArray(row) ? row : [row];
      const confirmText = status === 0 ? 'disable' : 'enable';
      const userCount = users.length;

      this.$confirm(`Are you sure you want to ${confirmText} ${userCount} selected users?`, 'Tip', {
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }).then(() => {
        const userIds = users.map(user => user.userid);
        if (userIds.some(id => isNaN(id))) {
          this.$message.error('Invalid user ID exists');
          return;
        }

        Api.user.changeUserStatus(status, userIds, ({ data }) => {
          if (data.code === 0) {
            this.$message.success({
              message: `Successfully ${confirmText}d ${userCount} users`,
              showClose: true
            });
            this.fetchUsers(); // Refresh user list
          } else {
            this.$message.error({
              message: 'Operation failed, please try again',
              showClose: true
            });
          }
        });
      }).catch(() => {
        // User cancelled operation
      });
    },
    viewKidProfiles(row) {
      this.selectedUserName = row.mobile || `User #${row.userid}`;
      this.showKidProfiles = true;
      this.loadingKidProfiles = true;
      this.kidProfilesList = [];

      Api.admin.getUserKidProfiles(row.userid, ({ data }) => {
        this.loadingKidProfiles = false;
        if (data.code === 0) {
          this.kidProfilesList = data.data || [];
        } else {
          this.$message.error(data.msg || 'Failed to load kid profiles');
        }
      });
    },
    calculateAge(birthDate) {
      if (!birthDate) return '-';
      const birth = new Date(birthDate);
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      const monthDiff = now.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
        age--;
      }
      return age > 0 ? age : '-';
    },
    goToDeviceManagement(device) {
      this.$router.push({
        path: '/device-management',
        query: { macAddress: device.macAddress, deviceId: device.id }
      });
    } } };
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

// Page chrome (.welcome, .main-wrapper, .content-panel, .content-area,
// .table_bottom, .custom-pagination, .pagination-btn …) now lives in
// styles/ds.scss — only what is genuinely this view's stays here.

.device-count-link {
  color: $text-dark;
  cursor: pointer;
  border-bottom: 1px solid $border-color;

  &:hover { border-bottom-color: $text-light; }
}

.device-mac-list { min-width: 200px; }

.device-mac-title {
  font-family: $font-mono;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: $text-light;
  padding-bottom: 8px;
  border-bottom: 1px solid $divider-color;
  margin-bottom: 6px;
}

.device-mac-item {
  font-family: $font-mono;
  font-size: 11.5px;
  color: $text-body;
  padding: 6px 8px;
  border-radius: $radius-sm;
  cursor: pointer;

  &:hover { background: $surface-sunk; color: $text-dark; }
}

.table_bottom { border-top: 1px solid $border-color; }
</style>
