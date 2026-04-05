import { createRouter, createWebHistory } from 'vue-router';
import store from './store.js';
import LoginPage from './pages/LoginPage.vue';
import ChatPage from './pages/ChatPage.vue';
import AdminPage from './pages/AdminPage.vue';
import AdminRoomPage from './pages/AdminRoomPage.vue';
import SettingsPage from './pages/SettingsPage.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginPage,
      meta: { public: true }
    },
    {
      path: '/',
      name: 'chat',
      component: ChatPage
    },
    {
      path: '/admin',
      name: 'admin',
      component: AdminPage,
      meta: { admin: true }
    },
    {
      path: '/admin/rooms/:kind/:roomId',
      name: 'admin-room',
      component: AdminRoomPage,
      meta: { admin: true }
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsPage
    }
  ]
});

router.beforeEach(async (to) => {
  if (!store.ready) {
    await store.initialize();
  }

  if (to.meta.public) {
    if (store.session && to.path === '/login') {
      return '/';
    }
    return true;
  }

  if (!store.session) {
    return '/login';
  }

  if (to.meta.admin && !store.session.isAdmin) {
    return '/';
  }

  return true;
});

export default router;
