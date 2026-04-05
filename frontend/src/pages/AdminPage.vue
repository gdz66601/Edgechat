<script setup>
import { computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';

const route = useRoute();
const router = useRouter();

const navItems = [
  {
    label: '用户管理',
    description: '创建、禁用、删除和重置用户',
    to: '/admin/users'
  },
  {
    label: '消息查看',
    description: '搜索消息并查看群组、私信会话',
    to: '/admin/messages'
  },
  {
    label: '网站设置',
    description: '查看站点概况并管理后台级配置',
    to: '/admin/site'
  }
];

const currentTitle = computed(
  () => navItems.find((item) => route.path.startsWith(item.to))?.label || '管理后台'
);
</script>

<template>
  <div class="page-shell">
    <div class="page-card admin-shell">
      <aside class="admin-shell__sidebar">
        <div class="admin-shell__brand">
          <div>
            <div class="title" style="font-size: 28px; margin-bottom: 4px">管理后台</div>
            <div class="muted">拆分为用户管理、消息查看、网站设置三个子页面。</div>
          </div>
        </div>

        <nav class="admin-shell__nav">
          <button
            v-for="item in navItems"
            :key="item.to"
            class="admin-shell__nav-item"
            :class="{ 'admin-shell__nav-item--active': route.path.startsWith(item.to) }"
            @click="router.push(item.to)"
          >
            <strong>{{ item.label }}</strong>
            <span>{{ item.description }}</span>
          </button>
        </nav>

        <UiSurface tone="soft" class="admin-shell__sidebar-card">
          <strong>{{ currentTitle }}</strong>
          <p>这里保留后台管理操作，聊天会话页只负责即时沟通。</p>
          <div class="inline-actions">
            <UiButton variant="secondary" size="sm" @click="router.push('/')">返回聊天</UiButton>
            <UiButton variant="ghost" size="sm" @click="router.push('/settings')">个人设置</UiButton>
          </div>
        </UiSurface>
      </aside>

      <main class="admin-shell__content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
