<template>
  <div class="admin-shell">
    <aside class="admin-sidebar" :class="{ collapsed }">
      <div class="sidebar-logo" @click="goHome">
        <img loading="lazy" alt="Cheeko" src="@/assets/cheeko-logo.svg" class="logo-img" />
      </div>

      <!-- Flat groups with monospace headers: every destination stays visible
           instead of hiding behind an accordion. Collapsed, it is an icon rail. -->
      <nav class="rail-nav">
        <div v-for="group in visibleGroups" :key="group.key" class="rail-group">
          <h6 class="rail-group-label">{{ group.label }}</h6>
          <router-link
            v-for="item in group.children"
            :key="item.path"
            :to="item.path"
            class="rail-item"
            :class="{ on: isActive(item.path) }"
            :title="item.label"
          >
            <i :class="item.icon || group.icon"></i>
            <span class="rail-item-label">{{ item.label }}</span>
          </router-link>
        </div>
      </nav>

      <button class="sidebar-collapse-btn" :title="collapsed ? 'Expand menu' : 'Collapse menu'" @click="toggleCollapsed">
        <i :class="collapsed ? 'el-icon-s-unfold' : 'el-icon-s-fold'"></i>
        <span v-if="!collapsed">Collapse</span>
      </button>

      <div v-if="!collapsed" class="rail-foot">{{ railFoot }}</div>
    </aside>

    <div class="admin-main" :class="{ shifted: collapsed }">
      <header class="admin-topbar">
        <div class="topbar-title">{{ pageTitle }}</div>
        <div class="topbar-right">
          <div class="search-container">
            <GlobalSearchDropdown />
          </div>
          <el-dropdown trigger="click" class="user-dropdown" @visible-change="handleUserDropdownVisibleChange">
            <span class="el-dropdown-link">
              <span class="user-mark">{{ userInitials }}</span>
              <span class="user-name">{{ userInfo.username || 'Loading...' }}</span>
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
import { mapActions, mapGetters, mapState } from 'vuex';
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue';
import GlobalSearchDropdown from '@/components/GlobalSearchDropdown.vue';

// Fixed list/dashboard pages cached across navigation. Query-driven drill-downs
// (role-config, device-management, voice-print, kid-profiles) must stay out:
// keep-alive would reuse the component when only the query changes.
const CACHED_VIEWS = [
  'Overview', 'Home', 'AllDevices', 'TokenAnalytics', 'GameAnalytics', 'ActiveDevices',
  'Families', 'Costs', 'Operate', 'Engagement', 'Conversations', 'UserManagement',
  'OtaManagement', 'DictManagement', 'ParamsManagement', 'EmailReportSettings', 'QuizProgress',
  'TemplateManagement', 'RuntimeProviders', 'RfidManagement', 'ServerSideManager'
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
    ...mapState({
      appVersion: state => (state.pubConfig && state.pubConfig.version) || ''
    }),
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
    userInitials() {
      const name = (this.userInfo.username || '').trim();
      if (!name) return '—';
      const parts = name.split(/[\s._-]+/).filter(Boolean);
      const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
      return letters.toUpperCase();
    },
    railFoot() {
      return this.appVersion ? `build ${this.appVersion}` : 'Cheeko Admin';
    },
    navGroups() {
      return [
        {
          key: 'overview', label: 'Overview', icon: 'el-icon-s-home', superAdmin: true,
          children: [
            { path: '/overview', label: 'Overview', icon: 'el-icon-s-home' }
          ]
        },
        {
          key: 'characters', label: 'Characters', icon: 'el-icon-s-custom', superAdmin: false,
          children: [
            { path: '/home', label: 'Agents', icon: 'el-icon-s-custom' },
            { path: '/template-management', label: 'Templates', icon: 'el-icon-document-copy', superAdmin: true }
          ]
        },
        {
          key: 'families', label: 'Families', icon: 'el-icon-user', superAdmin: true,
          children: [
            { path: '/families', label: 'Family 360', icon: 'el-icon-user' },
            { path: '/user-management', label: 'Users', icon: 'el-icon-user-solid' },
            { path: '/kid-profiles', label: 'Kid Profiles', icon: 'el-icon-star-off' }
          ]
        },
        {
          key: 'engagement', label: 'Engagement', icon: 'el-icon-data-line', superAdmin: true,
          children: [
            { path: '/engagement', label: 'Engagement', icon: 'el-icon-data-line' },
            { path: '/game-analytics', label: 'Game Analytics', icon: 'el-icon-s-data' },
            { path: '/active-devices', label: 'Active Devices', icon: 'el-icon-monitor' }
          ]
        },
        {
          key: 'conversations', label: 'Conversations', icon: 'el-icon-chat-dot-round', superAdmin: true,
          children: [
            { path: '/conversations', label: 'Conversations', icon: 'el-icon-chat-dot-round' }
          ]
        },
        {
          key: 'content', label: 'Content & Games', icon: 'el-icon-folder-opened', superAdmin: false,
          children: [
            { path: '/quiz-progress', label: 'Quiz Progress', icon: 'el-icon-s-claim' },
            { path: '/rfid-management', label: 'RFID Cards', icon: 'el-icon-postcard', superAdmin: true }
          ]
        },
        {
          key: 'costs', label: 'Costs', icon: 'el-icon-coin', superAdmin: true,
          children: [
            { path: '/costs', label: 'AI Cost', icon: 'el-icon-coin' },
            { path: '/token-analytics', label: 'Raw Tokens', icon: 'el-icon-s-marketing' }
          ]
        },
        {
          key: 'operate', label: 'Operate', icon: 'el-icon-monitor', superAdmin: true,
          children: [
            { path: '/operate', label: 'Fleet & Ops', icon: 'el-icon-s-platform' },
            { path: '/all-devices', label: 'Devices', icon: 'el-icon-cpu' },
            { path: '/ota-management', label: 'OTA Firmware', icon: 'el-icon-upload2' },
            { path: '/runtime-providers', label: 'Runtime Providers', icon: 'el-icon-connection' },
            { path: '/email-reports', label: 'Email Reports', icon: 'el-icon-message' }
          ]
        },
        {
          key: 'settings', label: 'Settings', icon: 'el-icon-s-tools', superAdmin: true,
          children: [
            { path: '/dict-management', label: 'Dictionaries', icon: 'el-icon-notebook-2' },
            { path: '/params-management', label: 'Parameters', icon: 'el-icon-s-tools' },
            { path: '/server-side-management', label: 'Server Side', icon: 'el-icon-s-cooperation' }
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
    this.revealActiveItem();
    window.addEventListener('resize', this.handleMobileSidebar);
  },
  watch: {
    activePath() {
      this.revealActiveItem();
    }
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.handleMobileSidebar);
  },
  methods: {
    isActive(path) {
      return this.activePath === path;
    },
    // The rail scrolls; without this a deep destination opens with its own
    // entry below the fold and the highlight clipped at the edge.
    revealActiveItem() {
      this.$nextTick(() => {
        const el = this.$el && this.$el.querySelector('.rail-item.on');
        if (el && el.scrollIntoView) {
          el.scrollIntoView({ block: 'nearest' });
        }
      });
    },
    goHome() {
      this.$router.push(this.isSuperAdmin ? '/overview' : '/home');
    },
    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      localStorage.setItem('sidebarCollapsed', String(this.collapsed));
    },
    // On phones the 232px sidebar would eat most of the screen — force the
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

// ---------- Rail ----------
.admin-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 232px;
  background: $surface-rail;
  border-right: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow: hidden;
  transition: width 0.2s ease;

  &.collapsed {
    width: 64px;

    .sidebar-logo { padding: 0 8px; }
    .logo-img { height: 24px; }
    .rail-group-label { display: none; }
    .rail-item-label { display: none; }
    .rail-group { padding: 0 12px; margin-bottom: 10px; }

    .rail-item {
      justify-content: center;
      padding: 8px 0;

      i { width: auto; }
    }
  }
}

.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60px;
  padding: 0 16px;
  cursor: pointer;
  flex-shrink: 0;
  margin-bottom: 14px;
  border-bottom: 1px solid $divider-color;
}

.logo-img {
  display: block;
  max-width: 100%;
  width: auto;
  height: 28px;
  object-fit: contain;
}

.rail-nav {
  // The only scroller in the rail: the collapse button and footer below it
  // stay pinned instead of being overlapped by a long nav.
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 4px;
}

.rail-group {
  padding: 0 10px;
  margin-bottom: 16px;
}

.rail-group-label {
  margin: 0;
  padding: 0 10px 8px;
  font-family: $font-mono;
  font-size: 9.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: $text-light;
}

.rail-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  margin-bottom: 1px;
  border-radius: $radius-sm;
  color: $text-body;
  font-size: 13px;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;

  i {
    color: $text-light;
    font-size: 14px;
    width: 16px;
    flex: 0 0 auto;
  }

  .rail-item-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    background: rgba(22, 19, 15, 0.04);
    color: $text-dark;
  }

  // Current page: the whole row fills, edge to edge within the rail's gutter
  &.on {
    background: $text-dark;
    color: $white;
    font-weight: 540;
    box-shadow: none;

    i { color: $white; }

    &:hover {
      background: $text-dark;
      color: $white;
    }
  }
}

.sidebar-collapse-btn {
  margin: 8px 12px 10px;
  flex: 0 0 auto;
  height: 30px;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  background: transparent;
  color: $text-light;
  font-family: $font-mono;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;

  i { font-size: 14px; }

  &:hover {
    background: rgba(22, 19, 15, 0.04);
    color: $text-body;
  }
}

.rail-foot {
  padding: 12px 22px 18px;
  border-top: 1px solid $divider-color;
  font-family: $font-mono;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: $text-light;
  flex-shrink: 0;
}

// Phones: icon rail only — no expand button, it would fill the screen
@media (max-width: 768px) {
  .sidebar-collapse-btn { display: none; }
}

// ---------- Main ----------
.admin-main {
  margin-left: 232px;
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
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 32px;
  background: $surface;
  border-bottom: 1px solid $border-color;
  box-shadow: none;
}

.topbar-title {
  font-family: $font-mono;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: $text-light;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  min-width: 0;
}

.search-container {
  // Shrink with the topbar instead of overflowing onto the avatar
  flex: 0 1 280px;
  min-width: 0;
  max-width: 280px;

  ::v-deep .global-search-wrapper {
    min-width: 0;
    width: 100%;
  }

  @media (max-width: 960px) {
    display: none;
  }
}

.user-dropdown {
  flex-shrink: 0;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;

  ::v-deep .el-dropdown-link {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: $text-body;
    cursor: pointer;
  }

  ::v-deep .user-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  ::v-deep i { color: $text-light; transition: transform 0.15s ease; }
}

.user-mark {
  width: 26px;
  height: 26px;
  border-radius: $radius-sm;
  background: $accent-wash;
  color: $primary-dark;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex: 0 0 auto;
}

.rotate-down {
  transform: rotate(180deg);
}

.admin-content {
  flex: 1;
  padding: 34px 32px 40px;
  min-width: 0;
  // Wide children (data tables, RFID strips) scroll in place instead of
  // stretching the whole page sideways on mobile
  overflow-x: auto;
}

@media (max-width: 768px) {
  .admin-topbar { padding: 0 16px; }
  .admin-content { padding: 20px 16px 32px; }
}
</style>
