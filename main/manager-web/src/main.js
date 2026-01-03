import ElementUI from 'element-ui';
import locale from 'element-ui/lib/locale/lang/en'; // Import English locale
import 'element-ui/lib/theme-chalk/index.css';
import 'normalize.css/normalize.css'; // A modern alternative to CSS resets
import Vue from 'vue';
import App from './App.vue';
import router from './router';
import store from './store';
import './styles/global.scss';
import { register as registerServiceWorker } from './registerServiceWorker';

Vue.use(ElementUI, { locale }); // Configure Element UI with English locale

Vue.config.productionTip = false

// Register Service Worker
registerServiceWorker();

// Create Vue instance
new Vue({
  router,
  store,
  render: function (h) { return h(App) }
}).$mount('#app')
