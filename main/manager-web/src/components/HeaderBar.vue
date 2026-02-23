<template>
  <el-header class="header">
    <div class="header-container">
      <!-- Left elements -->
      <div class="header-left" @click="goHome">
        <img loading="lazy" alt="" src="@/assets/cheeko-logo.svg" class="logo-img" />
        <!-- <img loading="lazy" alt="" src="@/assets/cheeko-ai.png" class="brand-img" /> -->
      </div>

      <!-- Center navigation menu -->
      <div class="header-center">
        <div class="equipment-management"
          :class="{ 'active-tab': $route.path === '/home' || $route.path === '/role-config' || $route.path === '/device-management' }"
          @click="goHome">
          <img loading="lazy" alt="" src="@/assets/header/robot.png"
            :style="{ filter: $route.path === '/home' || $route.path === '/role-config' || $route.path === '/device-management' ? 'brightness(0) invert(1)' : 'None' }" />
         Agent Management
        </div>
        <div v-if="isSuperAdmin" class="equipment-management"
          :class="{ 'active-tab': $route.path === '/user-management' }" @click="goUserManagement">
          <img loading="lazy" alt="" src="@/assets/header/user_management.png"
            :style="{ filter: $route.path === '/user-management' ? 'brightness(0) invert(1)' : 'None' }" />
         User Management
        </div>
        <div v-if="isSuperAdmin" class="equipment-management"
          :class="{ 'active-tab': $route.path === '/all-devices' }" @click="goAllDevices">
          <i class="el-icon-monitor"
            :style="{ fontSize: '15px', color: $route.path === '/all-devices' ? '#fff' : '#3d4566' }"></i>
          Device Management
        </div>
        <div v-if="isSuperAdmin" class="equipment-management"
          :class="{ 'active-tab': $route.path === '/ota-management' }" @click="goOtaManagement">
          <img loading="lazy" alt="" src="@/assets/header/firmware_update.png"
            :style="{ filter: $route.path === '/ota-management' ? 'brightness(0) invert(1)' : 'None' }" />
          OTA Management
        </div>
        <div v-if="isSuperAdmin" class="equipment-management"
          :class="{ 'active-tab': $route.path === '/token-analytics' }" @click="goTokenAnalytics">
          <i class="el-icon-data-analysis"
            :style="{ fontSize: '15px', color: $route.path === '/token-analytics' ? '#fff' : '#3d4566' }"></i>
          Token Analytics
        </div>
        <div v-if="isSuperAdmin" class="equipment-management"
          :class="{ 'active-tab': $route.path === '/game-analytics' }" @click="goGameAnalytics">
          <i class="el-icon-trophy"
            :style="{ fontSize: '15px', color: $route.path === '/game-analytics' ? '#fff' : '#3d4566' }"></i>
          Game Analytics
        </div>
        <div v-if="isSuperAdmin" class="equipment-management"
          :class="{ 'active-tab': $route.path === '/rfid-management' }" @click="goRfidManagement">
          <i class="el-icon-postcard"
            :style="{ fontSize: '15px', color: $route.path === '/rfid-management' ? '#fff' : '#3d4566' }"></i>
          RFID Management
        </div>
        <div v-if="isSuperAdmin" class="equipment-management"
          :class="{ 'active-tab': $route.path === '/content-library' }" @click="goContentLibrary">
          <i class="el-icon-folder-opened"
            :style="{ fontSize: '15px', color: $route.path === '/content-library' ? '#fff' : '#3d4566' }"></i>
          Content Library
        </div>
        <el-dropdown v-if="isSuperAdmin" trigger="click" class="equipment-management more-dropdown"
          :class="{ 'active-tab': $route.path === '/dict-management' || $route.path === '/params-management' || $route.path === '/server-side-management' || $route.path === '/template-management' || $route.path === '/email-reports' }"
          @visible-change="handleParamDropdownVisibleChange">
          <span class="el-dropdown-link">
            <img loading="lazy" alt="" src="@/assets/header/param_management.png"
              :style="{ filter: $route.path === '/dict-management' || $route.path === '/params-management' || $route.path === '/server-side-management' || $route.path === '/template-management' || $route.path === '/email-reports' ? 'brightness(0) invert(1)' : 'None' }" />
            Parameter Dictionary
            <i class="el-icon-arrow-down el-icon--right" :class="{ 'rotate-down': paramDropdownVisible }"></i>
          </span>
          <el-dropdown-menu slot="dropdown">
            <el-dropdown-item @click.native="goParamManagement">
              Parameter Management
            </el-dropdown-item>
            <el-dropdown-item @click.native="goDictManagement">
              Dictionary Management
            </el-dropdown-item>
            <el-dropdown-item @click.native="goServerSideManagement">
              Server Side Management
            </el-dropdown-item>
            <el-dropdown-item @click.native="goTemplateManagement">
              Template Management
            </el-dropdown-item>
            <el-dropdown-item @click.native="goEmailReports">
              Email Reports
            </el-dropdown-item>
          </el-dropdown-menu>
        </el-dropdown>
      </div>

      <!-- Right elements -->
      <div class="header-right">
        <div class="search-container" v-if="!(isSuperAdmin && isSmallScreen)">
          <GlobalSearchDropdown />
        </div>
        <img loading="lazy" alt="" src="@/assets/home/avatar.png" class="avatar-img" />
        <el-dropdown trigger="click" class="user-dropdown" @visible-change="handleUserDropdownVisibleChange">
          <span class="el-dropdown-link">
            {{ userInfo.username || 'Loading...' }}
            <i class="el-icon-arrow-down el-icon--right" :class="{ 'rotate-down': userDropdownVisible }"></i>
          </span>
          <el-dropdown-menu slot="dropdown">
            <el-dropdown-item @click.native="goOpenClawSetup">OpenClaw Setup</el-dropdown-item>
            <el-dropdown-item @click.native="showChangePasswordDialog">Change Password</el-dropdown-item>
            <el-dropdown-item @click.native="handleLogout">log out</el-dropdown-item>
          </el-dropdown-menu>
        </el-dropdown>
      </div>
    </div>

    <!-- Change password dialog -->
    <ChangePasswordDialog v-model="isChangePasswordDialogVisible" />
  </el-header>
</template>

<script>
import userApi from '@/apis/module/user';
import { mapActions, mapGetters } from 'vuex';
import ChangePasswordDialog from './ChangePasswordDialog.vue';
import GlobalSearchDropdown from './GlobalSearchDropdown.vue';

export default {
  name: 'HeaderBar',
  components: {
    ChangePasswordDialog,
    GlobalSearchDropdown
  },
  props: ['devices'],  // Receive device list from parent component
  data() {
    return {
      search: '',
      userInfo: {
        username: '',
        mobile: ''
      },
      isChangePasswordDialogVisible: false, // Control change password dialog visibility
      userDropdownVisible: false,
      paramDropdownVisible: false,
      isSmallScreen: false
    }
  },
  computed: {
    ...mapGetters(['getIsSuperAdmin']),
    isSuperAdmin() {
      return this.getIsSuperAdmin;
    }
  },
  mounted() {
    this.fetchUserInfo();
    this.checkScreenSize();
    window.addEventListener('resize', this.checkScreenSize);
  },
  // Remove event listener
  beforeDestroy() {
    window.removeEventListener('resize', this.checkScreenSize);
  },
  methods: {
    goHome() {
      // Navigate to home page
      this.$router.push('/home')
    },
    goUserManagement() {
      this.$router.push('/user-management')
    },
    goParamManagement() {
      this.$router.push('/params-management')
    },
    goOtaManagement() {
      this.$router.push('/ota-management')
    },
    goDictManagement() {
      this.$router.push('/dict-management')
    },
    goServerSideManagement() {
      this.$router.push('/server-side-management')
    },
    goRfidManagement() {
      this.$router.push('/rfid-management')
    },
    goTokenAnalytics() {
      this.$router.push('/token-analytics')
    },
    goGameAnalytics() {
      this.$router.push('/game-analytics')
    },
    goAllDevices() {
      this.$router.push('/all-devices')
    },
    goTemplateManagement() {
      this.$router.push('/template-management')
    },
    goContentLibrary() {
      this.$router.push('/content-library')
    },
    goEmailReports() {
      this.$router.push('/email-reports')
    },
    goOpenClawSetup() {
      this.$router.push('/openclaw-setup')
    },
    // Get user information
    fetchUserInfo() {
      userApi.getUserInfo(({ data }) => {
        this.userInfo = data.data
        if (data.data.superAdmin !== undefined) {
          this.$store.commit('setUserInfo', data.data);
        }
      })
    },
    checkScreenSize() {
      this.isSmallScreen = window.innerWidth <= 1386;
    },
    // Handle search
    handleSearch() {
      const searchValue = this.search.trim();

      // If search content is empty, trigger reset event
      if (!searchValue) {
        this.$emit('search-reset');
        return;
      }

      try {
        // Create case-insensitive regex
        const regex = new RegExp(searchValue, 'i');
        // Trigger search event, pass regex to parent component
        this.$emit('search', regex);
      } catch (error) {
        console.error('Failed to create regex:', error);
        this.$message.error({
          message: 'Invalid search keyword format',
          showClose: true
        });
      }
    },
    // Show change password dialog
    showChangePasswordDialog() {
      this.isChangePasswordDialogVisible = true;
    },
    // Logout
    async handleLogout() {
      try {
        // Call Vuex logout action
        await this.logout();
        this.$message.success({
          message: 'Logout successful',
          showClose: true
        });
      } catch (error) {
        console.error('Logout failed:', error);
        this.$message.error({
          message: 'Logout failed, please try again',
          showClose: true
        });
      }
    },
    handleUserDropdownVisibleChange(visible) {
      this.userDropdownVisible = visible;
    },
    // Listen to second dropdown menu visibility change
    handleParamDropdownVisibleChange(visible) {
      this.paramDropdownVisible = visible;
    },

    // Use mapActions to import Vuex logout action
    ...mapActions(['logout'])
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.header {
  background: rgba(255, 247, 240, 0.4);
  border: 1px solid #fff;
  height: 63px !important;
  min-width: 900px;
  /* 设置最小宽度防止过度压缩 */
  overflow: hidden;
}

.header-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
  padding: 0 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 80px;
}

.logo-img {
  width: 70px;
  height: 70px;
}

.brand-img {
  height: 20px;
}

.header-center {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 20px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 250px;
  justify-content: flex-end;
}

.equipment-management {
  height: 28px;
  border-radius: 14px;
  background: rgba($primary, 0.15);
  display: flex;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  gap: 5px;
  color: $text-dark;
  margin-left: 1px;
  align-items: center;
  transition: all 0.3s ease;
  cursor: pointer;
  flex-shrink: 0;
  /* 防止导航按钮被压缩 */
  padding: 0 10px;
  position: relative;
}

.equipment-management.active-tab {
  background: $primary !important;
  color: #fff !important;
}

.equipment-management img {
  width: 15px;
  height: 13px;
}

.search-container {
  margin-right: 10px;
  min-width: 200px;
  flex-grow: 1;
  max-width: 280px;
}

.custom-search-input>>>.el-input__inner {
  height: 30px;
  border-radius: 15px;
  background-color: #fff;
  border: 1px solid #e4e6ef;
  padding-left: 15px;
  font-size: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  width: 100%;
}

.search-icon {
  cursor: pointer;
  color: #909399;
  margin-right: 8px;
  font-size: 14px;
  line-height: 30px;
}

.custom-search-input::v-deep .el-input__suffix-inner {
  display: flex;
  align-items: center;
  height: 100%;
}

.avatar-img {
  width: 21px;
  height: 21px;
  flex-shrink: 0;
}

.user-dropdown {
  flex-shrink: 0;
}

.more-dropdown {
  padding-right: 20px;
}

.more-dropdown .el-dropdown-link {
  display: flex;
  align-items: center;
  gap: 7px;
}

.rotate-down {
  transform: rotate(180deg);
  transition: transform 0.3s ease;
}

.el-icon-arrow-down {
  transition: transform 0.3s ease;
}

/* 响应式调整 */
@media (max-width: 1200px) {
  .header-center {
    gap: 14px;
  }

  .equipment-management {
    width: 79px;
    font-size: 9px;
  }
}

.equipment-management.more-dropdown {
  position: relative;
}

.equipment-management.more-dropdown .el-dropdown-menu {
  position: absolute;
  right: 0;
  min-width: 120px;
  margin-top: 5px;
}

.el-dropdown-menu__item {
  min-width: 60px;
  padding: 8px 20px;
  font-size: 14px;
  color: #606266;
  white-space: nowrap;
}

.el-dropdown-menu__item:hover,
.el-dropdown-menu__item:focus {
  background-color: rgba($primary, 0.1) !important;
  color: $primary !important;
}
</style>