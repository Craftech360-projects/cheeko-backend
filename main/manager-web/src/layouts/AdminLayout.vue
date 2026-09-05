<template>
  <div class="admin-shell">
    <aside class="admin-sidebar" :class="{ collapsed }">
      <div class="sidebar-logo" @click="goHome">
        <img loading="lazy" alt="Cheeko" src="@/assets/cheeko-logo.svg" class="logo-img" />
      </div>

      <el-menu
        :default-active="activePath"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        unique-opened
        class="sidebar-menu"
      >
        <template v-for="group in visibleGroups">
          <el-submenu v-if="group.children.length > 1" :key="group.key" :index="group.key">
            <template slot="title">
              <i :class="group.icon"></i>
              <span>{{ group.label }}</span>
            </template>
            <el-menu-item
              v-for="item in group.children"
              :key="item.path"
              :index="item.path"
            >{{ item.label }}</el-menu-item>
          </el-submenu>
          <el-menu-item v-else :key="group.key" :index="group.children[0].path">
            <i :class="group.icon"></i>
            <span>{{ group.children[0].label }}</span>
          </el-menu-item>
        </template>
      </el-menu>

      <button class="sidebar-collapse-btn" :title="collapsed ? 'Expand menu' : 'Collapse menu'" @click="toggleCollapsed">
        <i :class="collapsed ? 'el-icon-s-unfold' : 'el-icon-s-fold'"></i>
        <span v-if="!collapsed">Collapse</span>
      </button>
    </aside>

    <div class="admin-main" :class="{ shifted: collapsed }">
      <header class="admin-topbar">
        <div class="topbar-title">{{ pageTitle }}</div>
        <div class="topbar-right">
          <div class="search-container">
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
              <el-dropdown-item @click.native="handleLogout">Log out</el-dropdown-item>
            </el-dropdown-menu>
          </el-dropdown>
        </div>
      </header>

      <main class="admin-content">
        <keep-alive :include="cachedViews">
          <router-view />
        </keep-alive>
      </main>
    </div>

    <ChangePasswordDialog v-model="isChangePasswordDialogVisible" />
  </div>
</template>

<script>
import { mapActions, mapGetters } from 'vuex';
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue';
import GlobalSearchDropdown from '@/components/GlobalSearchDropdown.vue';

// Fixed list/dashboard pages cached across navigation. Query-driven drill-downs
// (role-config, device-management, voice-print, kid-profiles) must stay out:
// keep-alive would reuse the component when only the query changes.
const CACHED_VIEWS = [
  'Overview', 'Home', 'AllDevices', 'TokenAnalytics', 'GameAnalytics', 'ActiveDevices',
  'Families', 'Costs', 'Operate', 'Engagement', 'Conversations', 'ContentLibrary', 'UserManagement',
  'OtaManagement', 'DictManagement', 'ParamsManagement', 'EmailReportSettings', 'QuizProgress',
  'TemplateManagement', 'RuntimeProviders', 'BulkImport', 'RfidManagement', 'ServerSideManager'
];

export default {
  name: 'AdminLayout',
  components: {
    ChangePasswordDialog,
    GlobalSearchDropdown
  },
  data() {
    return {
      userInfo: {},
      isChangePasswordDialogVisible: false,
      userDropdownVisible: false,
      collapsed: localStorage.getItem('sidebarCollapsed') === 'true'
    }
  },
  computed: {
    ...mapGetters(['getIsSuperAdmin']),
    isSuperAdmin() {
      return this.getIsSuperAdmin;
    },
    activePath() {
      // Highlight by first path segment so deep links like
      // /rfid-management/cards still light up their menu item
      const segment = this.$route.path.split('/')[1];
      return segment ? `/${segment}` : this.$route.path;
    },
    pageTitle() {
      return this.$route.meta.title || '';
    },
    cachedViews() {
      return CACHED_VIEWS.join(',');
    },
    navGroups() {
      return [
        {
          key: 'overview', label: 'Overview', icon: 'el-icon-s-home', superAdmin: true,
          children: [
            { path: '/overview', label: 'Overview' }
          ]
        },
        {
          key: 'characters', label: 'Characters', icon: 'el-icon-s-custom', superAdmin: false,
          children: [
            { path: '/home', label: 'Agents' },
            { path: '/template-management', label: 'Templates', superAdmin: true }
          ]
        },
        {
          key: 'families', label: 'Families', icon: 'el-icon-user', superAdmin: true,
          children: [
            { path: '/families', label: 'Family 360' },
            { path: '/user-management', label: 'Users' },
            { path: '/kid-profiles', label: 'Kid Profiles' }
          ]
        },
        {
          key: 'engagement', label: 'Engagement', icon: 'el-icon-data-line', superAdmin: true,
          children: [
            { path: '/engagement', label: 'Engagement' },
            { path: '/game-analytics', label: 'Game Analytics' },
            { path: '/active-devices', label: 'Active Devices' }
          ]
        },
        {
          key: 'conversations', label: 'Conversations', icon: 'el-icon-chat-dot-round', superAdmin: true,
          children: [
            { path: '/conversations', label: 'Conversations' }
          ]
        },
        {
          key: 'content', label: 'Content & Games', icon: 'el-icon-folder-opened', superAdmin: false,
          children: [
            { path: '/quiz-progress', label: 'Quiz Progress' },
            { path: '/content-library', label: 'Content Library', superAdmin: true },
            { path: '/rfid-management', label: 'RFID Cards', superAdmin: true },
            { path: '/bulk-import', label: 'Bulk Import', superAdmin: true }
          ]
        },
        {
          key: 'costs', label: 'Costs', icon: 'el-icon-coin', superAdmin: true,
          children: [
            { path: '/costs', label: 'AI Cost' },
            { path: '/token-analytics', label: 'Raw Tokens' }
          ]
        },
        {
          key: 'operate', label: 'Operate', icon: 'el-icon-monitor', superAdmin: true,
          children: [
            { path: '/operate', label: 'Fleet & Ops' },
            { path: '/all-devices', label: 'Devices' },
            { path: '/ota-management', label: 'OTA Firmware' },
            { path: '/runtime-providers', label: 'Runtime Providers' },
            { path: '/email-reports', label: 'Email Reports' }
          ]
        },
        {
          key: 'settings', label: 'Settings', icon: 'el-icon-s-tools', superAdmin: true,
          children: [
            { path: '/dict-management', label: 'Dictionaries' }
          ]
        }
      ];
    },
    visibleGroups() {
      return this.navGroups
        .filter(group => !group.superAdmin || this.isSuperAdmin)
        .map(group => ({
          ...group,
          children: group.children.filter(item => !item.superAdmin || this.isSuperAdmin)
        }))
        .filter(group => group.children.length > 0);
    }
  },
  mounted() {
    this.fetchUserInfoOnce();
    this.handleMobileSidebar();
    window.addEventListener('resize', this.handleMobileSidebar);
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.handleMobileSidebar);
  },
  methods: {
    goHome() {
      this.$router.push(this.isSuperAdmin ? '/overview' : '/home');
    },
    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      localStorage.setItem('sidebarCollapsed', String(this.collapsed));
    },
    // On phones the 224px sidebar would eat most of the screen — force the
    // icon rail and keep it that way (the expand toggle is hidden by CSS)
    handleMobileSidebar() {
      if (window.innerWidth <= 768) {
        this.collapsed = true;
      }
    },
    // Fetched once per session by the layout (previously one call per navigation
    // because every view mounted its own HeaderBar)
    fetchUserInfoOnce() {
      this.$store.dispatch('fetchUserInfoOnce').then((info) => {
        if (info) this.userInfo = info;
      });
    },
    showChangePasswordDialog() {
      this.isChangePasswordDialogVisible = true;
    },
    async handleLogout() {
      try {
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
    ...mapActions(['logout'])
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.admin-shell {
  display: flex;
  min-height: 100vh;
  background: $background-soft;
}

.admin-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 224px;
  background: #fff;
  border-right: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.2s ease;

  &.collapsed {
    width: 64px;

    .sidebar-logo { justify-content: center; padding: 0; }

    .logo-img { width: 36px; height: 36px; }
  }
}

.sidebar-collapse-btn {
  margin: 6px 10px 12px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: rgba($primary, 0.1);
  color: $primary-dark;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;

  i { font-size: 16px; }

  &:hover { background: rgba($primary, 0.2); }
}

.admin-sidebar.collapsed .sidebar-collapse-btn {
  margin: 6px 12px 12px;

  span { display: none; }
}

// Phones: icon rail only — no expand button, it would fill the screen
@media (max-width: 768px) {
  .sidebar-collapse-btn { display: none; }
}

.sidebar-logo {
  display: flex;
  align-items: center;
  height: 64px;
  padding: 0 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.logo-img {
  width: 74px;
  height: 74px;
  object-fit: contain;
}

.sidebar-menu {
  border-right: none;
  padding: 8px;
  flex: 1;
}

.admin-main {
  margin-left: 224px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: margin-left 0.2s ease;

  &.shifted { margin-left: 64px; }
}

.admin-topbar {
  position: sticky;
  top: 0;
  z-index: 90;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 20px;
  background: rgba(255, 250, 244, 0.92);
  border-bottom: 1px solid rgba($primary, 0.12);
  box-shadow: 0 4px 16px rgba(61, 69, 102, 0.05);
}

.topbar-title {
  font-size: 15px;
  font-weight: 600;
  color: $text-dark;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-width: 0;
}

.search-container {
  // Shrink with the topbar instead of overflowing onto the avatar
  flex: 0 1 260px;
  min-width: 0;
  max-width: 260px;

  ::v-deep .global-search-wrapper {
    min-width: 0;
    width: 100%;
  }

  @media (max-width: 960px) {
    display: none;
  }
}

.avatar-img {
  width: 21px;
  height: 21px;
  flex-shrink: 0;
}

.user-dropdown {
  flex-shrink: 0;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rotate-down {
  transform: rotate(180deg);
}

.admin-content {
  flex: 1;
  padding: 16px 20px 32px;
  min-width: 0;
  // Wide children (data tables, RFID strips) scroll in place instead of
  // stretching the whole page sideways on mobile
  overflow-x: auto;
}

// Sidebar menu skin on the brand tokens
.sidebar-menu {
  ::v-deep .el-menu-item,
  ::v-deep .el-submenu__title {
    height: 40px;
    line-height: 40px;
    border-radius: 10px;
    margin-bottom: 2px;
    color: $text-dark;
    font-size: 13.5px;

    i {
      color: $text-gray;
      margin-right: 6px;
      width: 20px;
    }

    &:hover {
      background: rgba($primary, 0.1);
    }
  }

  ::v-deep .el-menu-item.is-active {
    background: $primary;
    // Element UI inlines its own active-text-color (theme orange) on the item,
    // which would vanish against the orange pill — force white
    color: #fff !important;
    box-shadow: 0 6px 16px rgba($primary, 0.24);

    i {
      color: #fff;
    }
  }

  ::v-deep .el-submenu .el-menu {
    background: transparent;

    .el-menu-item {
      padding-left: 48px !important;
      font-size: 13px;
      min-width: 0;
    }
  }

  ::v-deep .el-submenu.is-active > .el-submenu__title {
    color: $primary;

    i {
      color: $primary;
    }
  }
}

.el-dropdown-menu__item {
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
