import Vue from 'vue'
import VueRouter from 'vue-router'

Vue.use(VueRouter)

// Authenticated pages render inside AdminLayout. Child paths are absolute so
// every URL stays exactly as it was before the layout existed.
const adminRoutes = [
  {
    path: '/overview',
    name: 'Overview',
    component: function () {
      return import('../views/Overview.vue')
    },
    meta: {
      requiresAuth: true,
      superAdminOnly: true,
      title: 'Overview'
    }
  },
  {
    path: '/home',
    name: 'home',
    component: function () {
      return import('../views/home.vue')
    },
    meta: { title: 'Agent Management' }
  },
  {
    path: '/role-config',
    name: 'RoleConfig',
    component: function () {
      return import('../views/roleConfig.vue')
    },
    meta: { title: 'Role Configuration' }
  },
  {
    path: '/voice-print',
    name: 'VoicePrint',
    component: function () {
      return import('../views/VoicePrint.vue')
    },
    meta: { title: 'Voice Recognition' }
  },
  // Device Management page route
  {
    path: '/device-management',
    name: 'DeviceManagement',
    component: function () {
      return import('../views/DeviceManagement.vue')
    },
    meta: { title: 'Agent Devices' }
  },
  // Add user management route
  {
    path: '/user-management',
    name: 'UserManagement',
    component: function () {
      return import('../views/UserManagement.vue')
    },
    meta: { title: 'User Management' }
  },
  {
    path: '/families',
    name: 'Families',
    component: function () {
      return import('../views/Families.vue')
    },
    meta: {
      requiresAuth: true,
      superAdminOnly: true,
      title: 'Family 360'
    }
  },
  {
    path: '/families/:id',
    name: 'FamilyProfile',
    component: function () {
      return import('../views/FamilyProfile.vue')
    },
    meta: {
      requiresAuth: true,
      superAdminOnly: true,
      title: 'Family Profile'
    }
  },
  {
    path: '/params-management',
    name: 'ParamsManagement',
    component: function () {
      return import('../views/ParamsManagement.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Parameter Management'
    }
  },
  {
    path: '/server-side-management',
    name: 'ServerSideManager',
    component: function () {
      return import('../views/ServerSideManager.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Server Side Management'
    }
  },
  {
    path: '/ota-management',
    name: 'OtaManagement',
    component: function () {
      return import('../views/OtaManagement.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'OTA Management'
    }
  },
  {
    path: '/dict-management',
    name: 'DictManagement',
    component: function () {
      return import('../views/DictManagement.vue')
    },
    meta: { title: 'Dictionary Management' }
  },
  {
    path: '/template-management',
    name: 'TemplateManagement',
    component: function () {
      return import('../views/TemplateManagement.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Template Management'
    }
  },
  {
    path: '/costs',
    name: 'Costs',
    component: function () {
      return import('../views/Costs.vue')
    },
    meta: {
      requiresAuth: true,
      superAdminOnly: true,
      title: 'Costs'
    }
  },
  {
    path: '/token-analytics',
    name: 'TokenAnalytics',
    component: function () {
      return import('../views/TokenAnalytics.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Token Analytics'
    }
  },
  {
    path: '/active-devices',
    name: 'ActiveDevices',
    component: function () {
      return import('../views/ActiveDevices.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Active Devices'
    }
  },
  {
    path: '/quiz-progress',
    name: 'QuizProgress',
    component: function () {
      return import('../views/QuizProgress.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Quiz Progress'
    }
  },
  {
    path: '/rfid-management/:tab?',
    name: 'RfidManagement',
    component: function () {
      return import('../views/RfidManagement.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'RFID Management'
    }
  },
  {
    path: '/bulk-import',
    name: 'BulkImport',
    component: function () {
      return import('../views/BulkImport.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'RFID Bulk Import'
    }
  },
  {
    path: '/kid-profiles',
    name: 'KidProfiles',
    component: function () {
      return import('../views/KidProfiles.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Kid Profiles'
    }
  },
  {
    path: '/operate',
    name: 'Operate',
    component: function () {
      return import('../views/Operate.vue')
    },
    meta: {
      requiresAuth: true,
      superAdminOnly: true,
      title: 'Fleet & Ops'
    }
  },
  {
    path: '/all-devices',
    name: 'AllDevices',
    component: function () {
      return import('../views/AllDevices.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Device Management'
    }
  },
  {
    path: '/content-library',
    name: 'ContentLibrary',
    component: function () {
      return import('../views/ContentLibrary.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Content Library'
    }
  },
  {
    path: '/email-reports',
    name: 'EmailReportSettings',
    component: function () {
      return import('../views/EmailReportSettings.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Email Report Settings'
    }
  },
  {
    path: '/runtime-providers',
    name: 'RuntimeProviders',
    component: function () {
      return import('../views/RuntimeProviders.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Runtime Providers'
    }
  },
  {
    path: '/engagement',
    name: 'Engagement',
    component: function () {
      return import('../views/Engagement.vue')
    },
    meta: {
      requiresAuth: true,
      superAdminOnly: true,
      title: 'Engagement'
    }
  },
  {
    path: '/conversations',
    name: 'Conversations',
    component: function () {
      return import('../views/Conversations.vue')
    },
    meta: {
      requiresAuth: true,
      superAdminOnly: true,
      title: 'Conversations'
    }
  },
  {
    path: '/game-analytics',
    name: 'GameAnalytics',
    component: function () {
      return import('../views/GameAnalytics.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Game Analytics'
    }
  },
]

const routes = [
  {
    path: '/',
    name: 'welcome',
    component: function () {
      return import('../views/login.vue')
    }
  },
  {
    path: '/login',
    name: 'login',
    component: function () {
      return import('../views/login.vue')
    }
  },
  {
    path: '/register',
    name: 'Register',
    component: function () {
      return import('../views/register.vue')
    }
  },
  {
    path: '/retrieve-password',
    name: 'RetrievePassword',
    component: function () {
      return import('../views/retrievePassword.vue')
    }
  },
  {
    path: '/',
    component: function () {
      // Lazy on purpose: a static import here pulls AdminLayout (and the API
      // modules its dialogs import) into the ES-module graph before the store,
      // which makes apis/api.js snapshot `user: undefined` mid import-cycle
      // and breaks every Api.user call (captcha, pub-config).
      return import('@/layouts/AdminLayout.vue')
    },
    meta: { requiresAuth: true },
    children: adminRoutes
  },
]

const router = new VueRouter({
  base: process.env.VUE_APP_PUBLIC_PATH || '/',
  routes
})

// Global handling of duplicate navigation: ignore silently instead of reloading the app
const originalPush = VueRouter.prototype.push
VueRouter.prototype.push = function push(location) {
  return originalPush.call(this, location).catch(err => {
    if (err.name !== 'NavigationDuplicated') {
      throw err
    }
  })
}

// Route guard: every AdminLayout child requires a token; superAdminOnly
// routes bounce non-admins to /home (same flag the backend enforces)
router.beforeEach((to, from, next) => {
  if (to.matched.some(record => record.meta.requiresAuth)) {
    const token = localStorage.getItem('token')
    if (!token) {
      next({ name: 'login', query: { redirect: to.fullPath } })
      return
    }
    if (to.matched.some(record => record.meta.superAdminOnly) &&
        localStorage.getItem('isSuperAdmin') !== 'true') {
      next('/home')
      return
    }
  }
  next()
})

router.afterEach((to) => {
  const title = to.meta && to.meta.title
  document.title = title ? `${title} · Cheeko` : 'Cheeko Admin'
})

export default router
