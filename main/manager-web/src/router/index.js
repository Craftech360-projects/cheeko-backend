import Vue from 'vue'
import VueRouter from 'vue-router'

Vue.use(VueRouter)

const routes = [
  {
    path: '/',
    name: 'welcome',
    component: function () {
      return import('../views/login.vue')
    }
  },
  {
    path: '/role-config',
    name: 'RoleConfig',
    component: function () {
      return import('../views/roleConfig.vue')
    }
  },
   {
    path: '/voice-print',
    name: 'VoicePrint',
    component: function () {
      return import('../views/VoicePrint.vue')
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
    path: '/home',
    name: 'home',
    component: function () {
      return import('../views/home.vue')
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
  // Device Management page route
  {
    path: '/device-management',
    name: 'DeviceManagement',
    component: function () {
      return import('../views/DeviceManagement.vue')
    }
  },
  // Add user management route
  {
    path: '/user-management',
    name: 'UserManagement',
    component: function () {
      return import('../views/UserManagement.vue')
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
    }
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
    path: '/rfid-management',
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
  {
    path: '/quota-settings',
    name: 'QuotaSettings',
    component: function () {
      return import('../views/QuotaSettings.vue')
    },
    meta: {
      requiresAuth: true,
      title: 'Quota Settings'
    }
  },
]
const router = new VueRouter({
  base: process.env.VUE_APP_PUBLIC_PATH || '/',
  routes
})

// Global handling of duplicate navigation, refresh page instead
const originalPush = VueRouter.prototype.push
VueRouter.prototype.push = function push(location) {
  return originalPush.call(this, location).catch(err => {
    if (err.name === 'NavigationDuplicated') {
      // If duplicate navigation, refresh page
      window.location.reload()
    } else {
      // Throw other errors normally
      throw err
    }
  })
}

// Routes that require login to access
const protectedRoutes = ['home', 'RoleConfig', 'DeviceManagement', 'UserManagement', 'TokenAnalytics', 'RfidManagement', 'KidProfiles', 'AllDevices', 'TemplateManagement', 'ContentLibrary', 'EmailReportSettings', 'GameAnalytics', 'QuotaSettings']

// Route guard
router.beforeEach((to, from, next) => {
  // Check if it's a protected route
  if (protectedRoutes.includes(to.name)) {
    // Get token from localStorage
    const token = localStorage.getItem('token')
    if (!token) {
      // Not logged in, redirect to login page
      next({ name: 'login', query: { redirect: to.fullPath } })
      return
    }
  }
  next()
})

export default router
