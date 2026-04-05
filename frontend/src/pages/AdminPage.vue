<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';

const router = useRouter();
const loading = ref(false);
const error = ref('');
const users = ref([]);
const channels = ref([]);
const dms = ref([]);
const searchResults = ref([]);

const createUserForm = reactive({
  username: '',
  displayName: '',
  password: ''
});

const createChannelForm = reactive({
  name: '',
  description: ''
});

const searchForm = reactive({
  keyword: '',
  kind: '',
  userId: '',
  channelId: ''
});

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    const [userPayload, channelPayload, dmPayload] = await Promise.all([
      api.adminUsers(),
      api.adminChannels(),
      api.adminDms()
    ]);
    users.value = userPayload.users;
    channels.value = channelPayload.channels;
    dms.value = dmPayload.dms;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

async function submitUser() {
  await api.createUser(createUserForm);
  createUserForm.username = '';
  createUserForm.displayName = '';
  createUserForm.password = '';
  await loadAll();
}

async function toggleUser(user) {
  await api.updateUser(user.id, {
    isDisabled: !user.isDisabled,
    displayName: user.displayName
  });
  await loadAll();
}

async function resetPassword(user) {
  const password = window.prompt(`为 ${user.displayName} 设置新密码`);
  if (!password) {
    return;
  }
  await api.resetPassword(user.id, password);
}

async function removeUser(user) {
  if (!window.confirm(`确认删除用户 ${user.displayName} 吗？`)) {
    return;
  }
  await api.deleteUser(user.id);
  await loadAll();
}

async function submitChannel() {
  await api.createChannel(createChannelForm);
  createChannelForm.name = '';
  createChannelForm.description = '';
  await loadAll();
}

async function removeChannel(channel) {
  if (!window.confirm(`确认删除频道 #${channel.name} 吗？`)) {
    return;
  }
  await api.deleteChannel(channel.id);
  await loadAll();
}

async function searchMessages() {
  const payload = await api.searchMessages(searchForm);
  searchResults.value = payload.messages;
}

function openRoom(kind, roomId, title) {
  router.push({
    name: 'admin-room',
    params: { kind, roomId },
    query: { title }
  });
}

onMounted(loadAll);
</script>

<template>
  <div class="page-shell">
    <div class="page-card">
      <header class="admin-header">
        <div>
          <div class="title" style="font-size: 28px; margin-bottom: 4px">管理后台</div>
          <div class="muted">用户、频道、私信和消息搜索集中在这里。</div>
        </div>
        <div class="inline-actions">
          <button class="button secondary" @click="router.push('/')">返回聊天</button>
        </div>
      </header>

      <div style="padding: 24px" class="stack">
        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="loading" class="muted">后台数据加载中...</p>

        <section class="grid-two">
          <div class="panel">
            <h3 style="margin-top: 0">创建用户</h3>
            <label class="field">
              <span>用户名</span>
              <input v-model.trim="createUserForm.username" />
            </label>
            <label class="field">
              <span>显示名称</span>
              <input v-model.trim="createUserForm.displayName" />
            </label>
            <label class="field">
              <span>初始密码</span>
              <input v-model="createUserForm.password" type="password" />
            </label>
            <button class="button" @click="submitUser">创建用户</button>
          </div>

          <div class="panel">
            <h3 style="margin-top: 0">创建频道</h3>
            <label class="field">
              <span>频道名称</span>
              <input v-model.trim="createChannelForm.name" />
            </label>
            <label class="field">
              <span>描述</span>
              <textarea v-model.trim="createChannelForm.description" />
            </label>
            <button class="button" @click="submitChannel">创建频道</button>
          </div>
        </section>

        <section class="panel">
          <h3 style="margin-top: 0">消息搜索</h3>
          <div class="search-grid">
            <label class="field">
              <span>关键词</span>
              <input v-model.trim="searchForm.keyword" />
            </label>
            <label class="field">
              <span>会话类型</span>
              <select v-model="searchForm.kind">
                <option value="">全部</option>
                <option value="public">公开频道</option>
                <option value="dm">私信</option>
              </select>
            </label>
            <label class="field">
              <span>用户</span>
              <select v-model="searchForm.userId">
                <option value="">全部</option>
                <option v-for="user in users" :key="user.id" :value="user.id">
                  {{ user.displayName }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>频道</span>
              <select v-model="searchForm.channelId">
                <option value="">全部</option>
                <option v-for="channel in channels" :key="channel.id" :value="channel.id">
                  {{ channel.name }}
                </option>
              </select>
            </label>
          </div>
          <div class="inline-actions">
            <button class="button" @click="searchMessages">开始搜索</button>
          </div>
          <table v-if="searchResults.length" class="list-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>发送者</th>
                <th>会话</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in searchResults" :key="item.id">
                <td>{{ new Date(item.createdAt).toLocaleString() }}</td>
                <td>{{ item.sender.displayName }}</td>
                <td>{{ item.room.kind === 'public' ? '#' : 'DM' }} {{ item.room.name }}</td>
                <td>{{ item.content || item.attachmentName }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="grid-two">
          <div class="panel">
            <h3 style="margin-top: 0">用户列表</h3>
            <table class="list-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in users" :key="user.id">
                  <td>
                    <strong>{{ user.displayName }}</strong>
                    <div class="muted">@{{ user.username }}</div>
                  </td>
                  <td>{{ user.isDisabled ? '已禁用' : '正常' }}</td>
                  <td>
                    <div class="inline-actions">
                      <button class="button secondary" @click="toggleUser(user)">
                        {{ user.isDisabled ? '启用' : '禁用' }}
                      </button>
                      <button class="button secondary" @click="resetPassword(user)">重置密码</button>
                      <button class="button danger" @click="removeUser(user)">删除</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="panel">
            <h3 style="margin-top: 0">频道列表</h3>
            <table class="list-table">
              <thead>
                <tr>
                  <th>频道</th>
                  <th>统计</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="channel in channels" :key="channel.id">
                  <td>
                    <strong># {{ channel.name }}</strong>
                    <div class="muted">
                      {{ channel.kind === 'private' ? '私有群组' : '公开群组' }} · 群主 {{ channel.ownerDisplayName }}
                    </div>
                    <div class="muted">{{ channel.description || '无描述' }}</div>
                  </td>
                  <td>{{ channel.memberCount }} 人 / {{ channel.messageCount }} 条</td>
                  <td>
                    <div class="inline-actions">
                      <button
                        class="button secondary"
                        @click="openRoom('public', channel.id, `# ${channel.name}`)"
                      >
                        打开对话
                      </button>
                      <button class="button danger" @click="removeChannel(channel)">删除</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <h3 style="margin-top: 0">私信列表</h3>
          <table class="list-table">
            <thead>
              <tr>
                <th>参与者</th>
                <th>DM Key</th>
                <th>消息数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="dm in dms" :key="dm.id">
                <td><strong>{{ dm.participants }}</strong></td>
                <td class="muted">{{ dm.name }}</td>
                <td>{{ dm.messageCount }}</td>
                <td>
                  <button class="button secondary" @click="openRoom('dm', dm.id, dm.participants)">
                    打开对话
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </div>
</template>
