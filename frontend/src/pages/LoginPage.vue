<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import store from '../store.js';

const router = useRouter();
const loading = ref(false);
const error = ref('');
const form = reactive({
  username: '',
  password: ''
});

async function submit() {
  loading.value = true;
  error.value = '';
  try {
    await store.login(form);
    router.push('/');
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page-shell login-shell">
    <div class="page-card login-card">
      <p class="tag">Cloudflare Workers + Vue</p>
      <h1 class="title">CF Chat</h1>
      <p class="subtitle">
        管理员创建账号后即可登录。前端保持轻量，后端按频道与私信分房间处理实时消息。
      </p>

      <form @submit.prevent="submit">
        <label class="field">
          <span>用户名</span>
          <input v-model.trim="form.username" autocomplete="username" />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
          />
        </label>

        <button class="button" :disabled="loading" type="submit">
          {{ loading ? '登录中...' : '登录' }}
        </button>
        <p v-if="error" class="error-text">{{ error }}</p>
      </form>
    </div>
  </div>
</template>
