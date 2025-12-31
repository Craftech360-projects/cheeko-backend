<template>
  <div id="app">
    <router-view />
    <cache-viewer v-if="isCDNEnabled" :visible.sync="showCacheViewer" />
  </div>
</template>

<style lang="scss">
@import './styles/theme.scss';

#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: $text-dark;
}

nav {
  padding: 30px;

  a {
    font-weight: bold;
    color: $text-dark;

    &.router-link-exact-active {
      color: $primary;
    }
  }
}

.copyright {
  text-align: center;
  color: $text-dark;
  font-size: 12px;
  font-weight: 400;
  margin-top: auto;
  padding: 30px 0 20px;
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
}

.el-message {
  top: 70px !important;
}
</style>
<script>
import CacheViewer from '@/components/CacheViewer.vue';
import { logCacheStatus } from '@/utils/cacheViewer';

export default {
  components: {
    CacheViewer
  },
  data() {
    return {
      showCacheViewer: false,
      isCDNEnabled: process.env.VUE_APP_USE_CDN === 'true'
    };
  },
  mounted() {
    // Only add CDN-related events and features when CDN is enabled
    if (this.isCDNEnabled) {
      // Add global shortcut Alt+C to show cache viewer
      document.addEventListener('keydown', this.handleKeyDown);

      // Add cache check method to global object for debugging
      window.checkCDNCacheStatus = () => {
        this.showCacheViewer = true;
      };

      // Output info to console
      console.info(
        '%c[Cheeko Service] CDN cache check tool loaded',
        'color: #409EFF; font-weight: bold;'
      );
      console.info(
        'Press Alt+C or run checkCDNCacheStatus() in console to view CDN cache status'
      );

      // Check Service Worker status
      this.checkServiceWorkerStatus();
    } else {
      console.info(
        '%c[Cheeko Service] CDN mode disabled, using local bundled resources',
        'color: #67C23A; font-weight: bold;'
      );
    }
  },
  beforeDestroy() {
    // Only remove event listener when CDN is enabled
    if (this.isCDNEnabled) {
      document.removeEventListener('keydown', this.handleKeyDown);
    }
  },
  methods: {
    handleKeyDown(e) {
      // Alt+C shortcut
      if (e.altKey && e.key === 'c') {
        this.showCacheViewer = true;
      }
    },
    async checkServiceWorkerStatus() {
      // Check if Service Worker is registered
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          if (registrations.length > 0) {
            console.info(
              '%c[Cheeko Service] Service Worker registered',
              'color: #67C23A; font-weight: bold;'
            );

            // Output cache status to console
            setTimeout(async () => {
              const hasCaches = await logCacheStatus();
              if (!hasCaches) {
                console.info(
                  '%c[Cheeko Service] No cache detected yet, please refresh the page or wait for cache to build',
                  'color: #E6A23C; font-weight: bold;'
                );

                // Provide additional tips in development environment
                if (process.env.NODE_ENV === 'development') {
                  console.info(
                    '%c[Cheeko Service] In development environment, Service Worker may not initialize cache properly',
                    'color: #E6A23C; font-weight: bold;'
                  );
                  console.info('Try the following methods to check if Service Worker is working:');
                  console.info('1. Check Service Worker status in DevTools Application tab');
                  console.info('2. Check cache contents in DevTools Application/Cache/Cache Storage');
                  console.info('3. Use production build (npm run build) and access via HTTP server to test full functionality');
                }
              }
            }, 2000);
          } else {
            console.info(
              '%c[Cheeko Service] Service Worker not registered, CDN resources may not be cached',
              'color: #F56C6C; font-weight: bold;'
            );

            if (process.env.NODE_ENV === 'development') {
              console.info(
                '%c[Cheeko Service] In development environment, this is normal',
                'color: #E6A23C; font-weight: bold;'
              );
              console.info('Service Worker usually only works in production environment');
              console.info('To test Service Worker functionality:');
              console.info('1. Run npm run build to build production version');
              console.info('2. Access the built page via HTTP server');
            }
          }
        } catch (error) {
          console.error('Failed to check Service Worker status:', error);
        }
      } else {
        console.warn('Current browser does not support Service Worker, CDN resource caching is unavailable');
      }
    }
  }
};
</script>