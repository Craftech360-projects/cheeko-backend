<template>
  <el-header class="header">
    <div class="header-container">
      <!-- Left elements -->
      <div class="header-left" @click="goHome">
        <img loading="lazy" alt="" src="@/assets/cheeko-logo.svg" class="logo-img" />
        <!-- <img loading="lazy" alt="" src="@/assets/cheeko-ai.png" class="brand-img" /> -->
      </div>

      <!-- Center navigation menu -->
      <div class="header-nav-shell">
        <span class="nav-scroll-hint nav-scroll-left"><i class="el-icon-arrow-left"></i></span>
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
            :class="{ 'active-tab': $route.path === '/bulk-import' }" @click="goBulkImport">
            <i class="el-icon-upload2"
              :style="{ fontSize: '15px', color: $route.path === '/bulk-import' ? '#fff' : '#3d4566' }"></i>
            Bulk Import
          </div>
          <div v-if="isSuperAdmin" class="equipment-management"
            :class="{ 'active-tab': $route.path === '/content-library' }" @click="goContentLibrary">
            <i class="el-icon-folder-opened"
              :style="{ fontSize: '15px', color: $route.path === '/content-library' ? '#fff' : '#3d4566' }"></i>
            Content Library
          </div>
        </div>
        <span class="nav-scroll-hint nav-scroll-right"><i class="el-icon-arrow-right"></i></span>
      </div>

      <!-- Right elements -->
      <div class="header-right">
        <el-dropdown v-if="isSuperAdmin" trigger="click" class="equipment-management more-dropdown pinned-dropdown"
          :class="{ 'active-tab': isParameterRouteActive }"
          @visible-change="handleParamDropdownVisibleChange">
          <span class="el-dropdown-link">
            <img loading="lazy" alt="" src="@/assets/header/param_management.png"
              :style="{ filter: isParameterRouteActive ? 'brightness(0) invert(1)' : 'None' }" />
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
            <el-dropdown-item @click.native="goRuntimeProviders">
              Runtime Providers
            </el-dropdown-item>
          </el-dropdown-menu>
        </el-dropdown>
        <div class="search-container" v-if="showSearch">
          <GlobalSearchDropdown />
        </div>
        <img loading="lazy" alt="" src="@/assets/home/avatar.png" class="avatar-img" />
        <el-dropdown trigger="click" class="user-dropdown" @visible-change="handleUserDropdownVisibleChange">
          <span class="el-dropdown-link">
            {{ userInfo.username || 'Loading...' }}
            <i class="el-icon-arrow-down el-icon--right" :class="{ 'rotate-down': userDropdownVisible }"></i>
          </span>
          <el-dropdown-menu slot="dropdown">
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
      isCompactHeader: false
    }
  },
  computed: {
    ...mapGetters(['getIsSuperAdmin']),
    isSuperAdmin() {
      return this.getIsSuperAdmin;
    },
    isParameterRouteActive() {
      return [
        '/dict-management',
        '/params-management',
        '/server-side-management',
        '/template-management',
        '/email-reports',
        '/runtime-providers'
      ].includes(this.$route.path);
    },
    showSearch() {
      return !(this.isSuperAdmin && this.isCompactHeader);
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
    goBulkImport() {
      this.$router.push('/bulk-import')
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
    goRuntimeProviders() {
      this.$router.push('/runtime-providers')
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
      this.isCompactHeader = window.innerWidth <= 1680;
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
  background: rgba(255, 250, 244, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.82);
  border-bottom-color: rgba($primary, 0.12);
  height: 64px !important;
  min-width: 900px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(61, 69, 102, 0.07);
}

.header-container {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
  padding: 0 14px;
  min-width: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 94px;
  min-width: 94px;
  cursor: pointer;
}

.logo-img {
  width: 74px;
  height: 74px;
  object-fit: contain;
}

.brand-img {
  height: 20px;
}

.header-nav-shell {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  margin-left: 0;
  align-items: center;
}

.header-nav-shell::before,
.header-nav-shell::after {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 8px;
  width: 34px;
  z-index: 2;
  pointer-events: none;
}

.header-nav-shell::before {
  left: 0;
  background: linear-gradient(90deg, rgba(255, 250, 244, 0.98), rgba(255, 250, 244, 0));
}

.header-nav-shell::after {
  right: 0;
  background: linear-gradient(270deg, rgba(255, 250, 244, 0.98), rgba(255, 250, 244, 0));
}

.header-center {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px 30px;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.header-center::-webkit-scrollbar {
  display: none;
}

.nav-scroll-hint {
  position: absolute;
  top: 50%;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: -11px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: $primary;
  box-shadow: 0 3px 10px rgba(61, 69, 102, 0.16);
  pointer-events: none;
  animation: navHintPulse 1.8s ease-in-out infinite;
}

.nav-scroll-left {
  left: 4px;
}

.nav-scroll-right {
  right: 4px;
}

@keyframes navHintPulse {
  0%, 100% {
    opacity: 0.48;
    transform: translateX(0);
  }
  50% {
    opacity: 1;
    transform: translateX(2px);
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  justify-content: flex-end;
}

.equipment-management {
  min-height: 32px;
  height: 32px;
  border-radius: 16px;
  background: rgba($primary, 0.15);
  display: flex;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  gap: 5px;
  color: $text-dark;
  margin-left: 1px;
  align-items: center;
  transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0 11px;
  position: relative;
  white-space: nowrap;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.52);
}

.equipment-management:hover {
  background: rgba($primary, 0.24);
}

.equipment-management.active-tab {
  background: $primary !important;
  color: #fff !important;
  box-shadow: 0 7px 18px rgba($primary, 0.22);
}

.equipment-management img {
  width: 15px;
  height: 13px;
}

.search-container {
  width: clamp(180px, 14vw, 260px);
  margin-right: 8px;
  flex: 0 1 260px;
  min-width: 180px;
  max-width: 260px;
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
  white-space: nowrap;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.more-dropdown {
  padding-right: 12px;
}

.pinned-dropdown {
  flex: 0 0 auto;
  margin-left: 0;
}

.more-dropdown .el-dropdown-link {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.rotate-down {
  transform: rotate(180deg);
  transition: transform 0.3s ease;
}

.el-icon-arrow-down {
  transition: transform 0.3s ease;
}

@media (max-width: 1680px) {
  .header-container {
    gap: 10px;
  }

  .equipment-management {
    min-height: 30px;
    height: 30px;
    padding: 0 10px;
    font-size: 11px;
  }

  .pinned-dropdown {
    padding: 0 11px;
  }
}

@media (max-width: 1180px) {
  .header {
    min-width: 760px;
  }

  .header-left {
    flex-basis: 78px;
    min-width: 78px;
  }

  .logo-img {
    width: 62px;
    height: 62px;
  }

  .equipment-management {
    padding: 0 9px;
  }

  .pinned-dropdown .el-dropdown-link {
    max-width: 150px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .header-center {
    scroll-behavior: auto;
  }

  .nav-scroll-hint {
    animation: none;
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
