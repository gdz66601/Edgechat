import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import store from './store.js';
import './styles.css';

store.initialize().finally(() => {
  const app = createApp(App);
  app.use(router);
  app.mount('#app');
});
