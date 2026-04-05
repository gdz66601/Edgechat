<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import { connectRoomSocket } from '../ws.js';
import UiAvatar from '../components/ui/Avatar.vue';
import UiBadge from '../components/ui/Badge.vue';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';
import UiTextarea from '../components/ui/Textarea.vue';

const router = useRouter();
const channels = ref([]);
const dms = ref([]);
const users = ref([]);
const groupMembers = ref([]);
const messages = ref([]);
const activeRoom = ref(null);
const loading = ref(false);
const sidebarLoading = ref(false);
const memberLoading = ref(false);
const error = ref('');
const wsStatus = ref('closed');
const composerText = ref('');
const pendingAttachment = ref(null);
const sending = ref(false);
const groupSubmitting = ref(false);
const inviteSubmitting = ref(false);
const messagesEl = ref(null);
const fileInputEl = ref(null);
const inviteUserId = ref('');
let roomSocket = null;

const createGroupForm = reactive({
  name: '',
  description: '',
  kind: 'public',
  memberUserIds: []
});

const session = computed(() => store.session);
const publicChannels = computed(() => channels.value.filter((channel) => channel.kind === 'public'));
const privateChannels = computed(() => channels.value.filter((channel) => channel.kind === 'private'));
const canManageActiveRoom = computed(
  () => activeRoom.value && activeRoom.value.kind !== 'dm' && activeRoom.value.canManage
);
const availableInviteUsers = computed(() => {
  const memberIds = new Set(groupMembers.value.map((member) => Number(member.id)));
  return users.value.filter((user) => !memberIds.has(Number(user.id)));
});

const activeRoomSubtitle = computed(() => {
  if (!activeRoom.value) {
    return '选择一个公开群组、私有群组或私信开始聊天。';
  }

  if (activeRoom.value.kind === 'dm') {
    return `与 @${activeRoom.value.otherUser?.username || activeRoom.value.name} 的一对一私信`;
  }

  const visibility = activeRoom.value.kind === 'private' ? '私有群组' : '公开群组';
  const memberCount = activeRoom.value.memberCount ? ` · ${activeRoom.value.memberCount} 位成员` : '';
  return `${visibility}${memberCount}${activeRoom.value.canManage ? ' · 你是群主' : ''}`;
});

function roomLabel(room) {
  if (!room) {
    return '未选择会话';
  }

  if (room.kind === 'dm') {
    return room.otherUser?.displayName || room.name;
  }

  return `${room.kind === 'private' ? '[私有]' : '[公开]'} ${room.name}`;
}

function formatTime(value) {
  return new Date(value).toLocaleString();
}

function isOwnMessage(message) {
  return Number(message.sender.id) === Number(session.value?.userId);
}

function previousMessage(index) {
  return index > 0 ? messages.value[index - 1] : null;
}

function nextMessage(index) {
  return index < messages.value.length - 1 ? messages.value[index + 1] : null;
}

function isSameSender(a, b) {
  return a && b && Number(a.sender.id) === Number(b.sender.id);
}

function bubbleRowClass(message, index) {
  return {
    'chat-bubble-row--own': isOwnMessage(message),
    'chat-bubble-row--stacked': isSameSender(previousMessage(index), message)
  };
}

function bubbleClass(message, index) {
  return {
    'chat-bubble--own': isOwnMessage(message),
    'chat-bubble--continued': isSameSender(previousMessage(index), message),
    'chat-bubble--tail-hidden': isSameSender(nextMessage(index), message)
  };
}

async function refreshSidebar() {
  sidebarLoading.value = true;
  try {
    const [channelPayload, dmPayload, userPayload] = await Promise.all([
      api.getChannels(),
      api.listDms(),
      api.getUsers()
    ]);
    channels.value = channelPayload.channels || [];
    dms.value = dmPayload.dms || [];
    users.value = userPayload.users || [];
  } finally {
    sidebarLoading.value = false;
  }
}

function applyActiveChannel(channel) {
  activeRoom.value = {
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    description: channel.description,
    canManage: Boolean(channel.canManage),
    myRole: channel.myRole || '',
    memberCount: Number(channel.memberCount || 0)
  };
}

async function selectChannel(channel) {
  if (channel.kind === 'public' && !channel.isMember) {
    await api.joinChannel(channel.id);
    channel.isMember = true;
    channel.memberCount = Number(channel.memberCount || 0) + 1;
  }

  applyActiveChannel(channel);
}

async function selectDm(dm) {
  activeRoom.value = {
    id: dm.id,
    kind: 'dm',
    name: dm.name,
    otherUser: dm.otherUser
  };
}

async function openDmWithUser(user) {
  const payload = await api.openDm(user.id);
  await refreshSidebar();
  await selectDm(payload.dm);
}

async function loadMessages(before = null, append = false) {
  if (!activeRoom.value) {
    return;
  }

  loading.value = true;
  error.value = '';
  try {
    const payload = await api.getMessages(activeRoom.value.kind, activeRoom.value.id, before);
    messages.value = append ? [...payload.messages, ...messages.value] : payload.messages;
    await nextTick();
    if (!append) {
      scrollToBottom();
    }
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

async function loadMembers() {
  if (!activeRoom.value || activeRoom.value.kind === 'dm') {
    groupMembers.value = [];
    return;
  }

  memberLoading.value = true;
  try {
    const payload = await api.getChannelMembers(activeRoom.value.id);
    groupMembers.value = payload.members;
    activeRoom.value = {
      ...activeRoom.value,
      canManage: payload.room.canManage,
      myRole: payload.room.myRole,
      memberCount: payload.members.length
    };
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    memberLoading.value = false;
  }
}

function disconnectSocket() {
  if (roomSocket) {
    roomSocket.close();
    roomSocket = null;
  }
  wsStatus.value = 'closed';
}

function connectSocket() {
  if (!activeRoom.value) {
    return;
  }

  disconnectSocket();
  roomSocket = connectRoomSocket({
    kind: activeRoom.value.kind,
    roomId: activeRoom.value.id,
    onStatus(status) {
      wsStatus.value = status;
    },
    onMessage(payload) {
      if (payload.type === 'message' && payload.message) {
        if (messages.value.some((item) => item.id === payload.message.id)) {
          return;
        }
        messages.value = [...messages.value, payload.message];
        nextTick().then(scrollToBottom);
      }
      if (payload.type === 'error') {
        error.value = payload.error;
      }
    }
  });
}

function scrollToBottom() {
  const element = messagesEl.value;
  if (element) {
    element.scrollTop = element.scrollHeight;
  }
}

async function sendMessage() {
  if (!roomSocket || roomSocket.readyState !== WebSocket.OPEN) {
    error.value = '实时连接尚未建立，请稍后重试';
    return;
  }

  if (!composerText.value.trim() && !pendingAttachment.value) {
    return;
  }

  sending.value = true;
  error.value = '';
  try {
    roomSocket.send(
      JSON.stringify({
        type: 'send',
        content: composerText.value,
        attachment: pendingAttachment.value
      })
    );
    composerText.value = '';
    pendingAttachment.value = null;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    sending.value = false;
  }
}

function handleComposerKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function openFilePicker() {
  fileInputEl.value?.click();
}

async function uploadAttachment(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const payload = await api.uploadFile(file);
    pendingAttachment.value = payload.file;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    event.target.value = '';
  }
}

function clearAttachment() {
  pendingAttachment.value = null;
}

async function loadOlder() {
  const firstMessage = messages.value[0];
  if (!firstMessage) {
    return;
  }
  await loadMessages(firstMessage.id, true);
}

async function createGroup() {
  if (!createGroupForm.name.trim()) {
    error.value = '请填写群组名称';
    return;
  }

  groupSubmitting.value = true;
  error.value = '';
  try {
    const payload = await api.createGroup(createGroupForm);
    createGroupForm.name = '';
    createGroupForm.description = '';
    createGroupForm.kind = 'public';
    createGroupForm.memberUserIds = [];
    await refreshSidebar();
    await selectChannel(payload.channel);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    groupSubmitting.value = false;
  }
}

async function inviteMember() {
  if (!activeRoom.value || activeRoom.value.kind === 'dm' || !inviteUserId.value) {
    return;
  }

  inviteSubmitting.value = true;
  error.value = '';
  try {
    const payload = await api.inviteChannelMembers(activeRoom.value.id, [Number(inviteUserId.value)]);
    groupMembers.value = payload.members;
    activeRoom.value = {
      ...activeRoom.value,
      memberCount: payload.members.length
    };
    inviteUserId.value = '';
    await refreshSidebar();
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    inviteSubmitting.value = false;
  }
}

async function removeMember(member) {
  if (!activeRoom.value || activeRoom.value.kind === 'dm') {
    return;
  }

  if (!window.confirm(`确认将 ${member.displayName} 移出群组吗？`)) {
    return;
  }

  try {
    const payload = await api.removeChannelMember(activeRoom.value.id, member.id);
    groupMembers.value = payload.members;
    activeRoom.value = {
      ...activeRoom.value,
      memberCount: payload.members.length
    };
    await refreshSidebar();
  } catch (currentError) {
    error.value = currentError.message;
  }
}

async function deleteGroup() {
  if (!activeRoom.value || activeRoom.value.kind === 'dm') {
    return;
  }

  if (!window.confirm(`确认删除群组 ${activeRoom.value.name} 吗？`)) {
    return;
  }

  try {
    await api.deleteOwnedChannel(activeRoom.value.id);
    activeRoom.value = null;
    messages.value = [];
    groupMembers.value = [];
    await refreshSidebar();
  } catch (currentError) {
    error.value = currentError.message;
  }
}

async function bootstrap() {
  sidebarLoading.value = true;
  error.value = '';
  try {
    await refreshSidebar();
    const preferredRoom =
      channels.value.find((channel) => channel.isMember) ||
      dms.value[0] ||
      publicChannels.value[0] ||
      privateChannels.value[0] ||
      null;

    if (preferredRoom) {
      if (preferredRoom.kind === 'dm') {
        await selectDm(preferredRoom);
      } else {
        await selectChannel(preferredRoom);
      }
    }
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    sidebarLoading.value = false;
  }
}

async function logout() {
  await store.logout();
  router.push('/login');
}

watch(
  () => [activeRoom.value?.kind, activeRoom.value?.id],
  async ([kind, id]) => {
    if (!kind || !id) {
      return;
    }

    await loadMessages();
    await loadMembers();
    connectSocket();
  }
);

onMounted(bootstrap);
onBeforeUnmount(disconnectSocket);
</script>

<template>
  <div class="page-shell chat-shell">
    <div class="chat-app">
      <aside class="chat-sidebar">
        <div class="chat-sidebar__header">
          <UiBadge>CF Chat</UiBadge>
          <div class="chat-sidebar__identity">
            <UiAvatar
              :src="session?.avatarUrl"
              :fallback="session?.displayName || session?.username || 'U'"
            />
            <div class="chat-sidebar__identity-text">
              <strong>{{ session?.displayName || session?.username }}</strong>
              <span>{{ session?.isAdmin ? '管理员账号' : '团队成员' }}</span>
            </div>
          </div>
        </div>

        <div class="chat-sidebar__body">
          <UiSurface tone="soft">
            <div class="chat-sidebar__section-title">
              <span>公开群组</span>
              <UiBadge variant="secondary">{{ publicChannels.length }}</UiBadge>
            </div>
            <div v-if="sidebarLoading" class="chat-sidebar__hint">正在同步群组...</div>
            <div v-else class="chat-sidebar__list">
              <button
                v-for="channel in publicChannels"
                :key="channel.id"
                class="chat-room-item"
                :class="{ 'chat-room-item--active': activeRoom?.kind === channel.kind && activeRoom?.id === channel.id }"
                @click="selectChannel(channel)"
              >
                <strong>{{ channel.name }}</strong>
                <span>{{ channel.isMember ? `${channel.memberCount} 位成员` : '点击加入' }}</span>
              </button>
            </div>
          </UiSurface>

          <UiSurface tone="soft">
            <div class="chat-sidebar__section-title">
              <span>私有群组</span>
              <UiBadge variant="secondary">{{ privateChannels.length }}</UiBadge>
            </div>
            <div class="chat-sidebar__list">
              <button
                v-for="channel in privateChannels"
                :key="channel.id"
                class="chat-room-item"
                :class="{ 'chat-room-item--active': activeRoom?.kind === channel.kind && activeRoom?.id === channel.id }"
                @click="selectChannel(channel)"
              >
                <strong>{{ channel.name }}</strong>
                <span>{{ channel.memberCount }} 位成员{{ channel.canManage ? ' · 群主' : '' }}</span>
              </button>
            </div>
          </UiSurface>

          <UiSurface tone="soft">
            <div class="chat-sidebar__section-title">
              <span>私信</span>
              <UiBadge variant="secondary">{{ dms.length }}</UiBadge>
            </div>
            <div class="chat-sidebar__list">
              <button
                v-for="dm in dms"
                :key="dm.id"
                class="chat-room-item"
                :class="{ 'chat-room-item--active': activeRoom?.kind === 'dm' && activeRoom?.id === dm.id }"
                @click="selectDm(dm)"
              >
                <strong>{{ dm.otherUser.displayName }}</strong>
                <span>@{{ dm.otherUser.username }}</span>
              </button>
            </div>
          </UiSurface>

          <UiSurface tone="soft">
            <div class="chat-sidebar__section-title">
              <span>发起私信</span>
              <UiBadge variant="secondary">{{ users.length }}</UiBadge>
            </div>
            <div class="chat-sidebar__list">
              <button
                v-for="user in users"
                :key="user.id"
                class="chat-room-item chat-room-item--ghost"
                @click="openDmWithUser(user)"
              >
                <strong>{{ user.displayName }}</strong>
                <span>@{{ user.username }}</span>
              </button>
            </div>
          </UiSurface>

          <UiSurface tone="soft" class="chat-sidebar__create">
            <div class="chat-sidebar__section-title">
              <span>创建群组</span>
              <UiBadge variant="secondary">{{ createGroupForm.kind === 'private' ? '私有' : '公开' }}</UiBadge>
            </div>
            <label class="field">
              <span>群组名称</span>
              <input v-model.trim="createGroupForm.name" placeholder="例如：产品讨论组" />
            </label>
            <label class="field">
              <span>描述</span>
              <textarea v-model.trim="createGroupForm.description" placeholder="简单介绍这个群组的用途" />
            </label>
            <label class="field">
              <span>可见性</span>
              <select v-model="createGroupForm.kind">
                <option value="public">公开群组</option>
                <option value="private">私有群组</option>
              </select>
            </label>
            <label class="field">
              <span>初始成员</span>
            </label>
            <div class="member-picker-list">
              <label v-for="user in users" :key="`create-${user.id}`" class="member-picker-item">
                <input v-model="createGroupForm.memberUserIds" type="checkbox" :value="user.id" />
                <span>{{ user.displayName }}</span>
                <small>@{{ user.username }}</small>
              </label>
            </div>
            <UiButton :disabled="groupSubmitting" block @click="createGroup">
              {{ groupSubmitting ? '创建中...' : '创建群组' }}
            </UiButton>
          </UiSurface>
        </div>

        <div class="chat-sidebar__footer">
          <UiSurface tone="soft">
            <div class="chat-settings-card">
              <div>
                <strong>个人设置</strong>
                <p>账号、后台和退出入口都收在侧栏底部。</p>
              </div>
              <div class="chat-settings-card__actions">
                <UiButton variant="secondary" @click="router.push('/settings')">设置</UiButton>
                <UiButton v-if="session?.isAdmin" variant="secondary" @click="router.push('/admin')">
                  后台
                </UiButton>
                <UiButton variant="ghost" @click="logout">退出</UiButton>
              </div>
            </div>
          </UiSurface>
        </div>
      </aside>

      <main class="chat-stage">
        <header class="chat-stage__header">
          <div>
            <h1>{{ roomLabel(activeRoom) }}</h1>
            <p>{{ activeRoomSubtitle }}</p>
          </div>
          <UiBadge :variant="wsStatus === 'open' ? 'success' : 'secondary'">
            {{ wsStatus === 'open' ? '实时已连接' : '连接中' }}
          </UiBadge>
        </header>

        <section
          v-if="activeRoom && activeRoom.kind !== 'dm'"
          class="chat-room-manage-wrap"
        >
          <UiSurface tone="soft" class="chat-room-manage">
            <div class="chat-room-manage__header">
              <div>
                <strong>群组成员</strong>
                <p>{{ memberLoading ? '同步中...' : `${groupMembers.length} 位成员` }}</p>
              </div>
              <div class="chat-room-manage__actions">
                <UiBadge variant="secondary">{{ activeRoom.myRole || 'member' }}</UiBadge>
                <UiButton
                  v-if="canManageActiveRoom"
                  variant="ghost"
                  size="sm"
                  @click="deleteGroup"
                >
                  删除群组
                </UiButton>
              </div>
            </div>

            <div class="member-chip-list">
              <div v-for="member in groupMembers" :key="member.id" class="member-chip">
                <UiAvatar :src="member.avatarUrl" :fallback="member.displayName" size="sm" />
                <div class="member-chip__text">
                  <strong>{{ member.displayName }}</strong>
                  <span>@{{ member.username }}</span>
                </div>
                <UiBadge :variant="member.role === 'owner' ? 'default' : 'secondary'">
                  {{ member.role === 'owner' ? '群主' : '成员' }}
                </UiBadge>
                <UiButton
                  v-if="canManageActiveRoom && member.role !== 'owner'"
                  variant="ghost"
                  size="sm"
                  @click="removeMember(member)"
                >
                  移除
                </UiButton>
              </div>
            </div>

            <div v-if="canManageActiveRoom" class="chat-room-manage__invite">
              <select v-model="inviteUserId" class="ui-input">
                <option value="">选择要邀请的用户</option>
                <option v-for="user in availableInviteUsers" :key="`invite-${user.id}`" :value="user.id">
                  {{ user.displayName }} @{{ user.username }}
                </option>
              </select>
              <UiButton :disabled="inviteSubmitting || !inviteUserId" @click="inviteMember">
                {{ inviteSubmitting ? '邀请中...' : '邀请加入' }}
              </UiButton>
            </div>
          </UiSurface>
        </section>

        <section ref="messagesEl" class="chat-stream">
          <div class="chat-stream__inner">
            <UiButton
              v-if="messages.length"
              variant="secondary"
              size="sm"
              class="chat-stream__older"
              @click="loadOlder"
            >
              加载更早消息
            </UiButton>

            <UiSurface v-if="!activeRoom" tone="muted" class="chat-empty">
              先从左侧选择一个群组，或者发起私信。
            </UiSurface>
            <UiSurface v-else-if="loading" tone="muted" class="chat-empty">
              正在加载消息...
            </UiSurface>
            <UiSurface v-else-if="!messages.length" tone="muted" class="chat-empty">
              这里还没有消息，发第一条开始吧。
            </UiSurface>

            <article
              v-for="(message, index) in messages"
              :key="message.id"
              class="chat-bubble-row"
              :class="bubbleRowClass(message, index)"
            >
              <UiAvatar
                v-if="!isOwnMessage(message)"
                :src="message.sender.avatarUrl"
                :fallback="message.sender.displayName"
                size="sm"
                class="chat-bubble-row__avatar"
              />
              <div class="chat-bubble" :class="bubbleClass(message, index)">
                <div class="chat-bubble__meta">
                  <strong>{{ isOwnMessage(message) ? '我' : message.sender.displayName }}</strong>
                  <span>{{ formatTime(message.createdAt) }}</span>
                </div>
                <p v-if="message.content">{{ message.content }}</p>
                <a
                  v-if="message.attachment"
                  :href="message.attachment.url"
                  target="_blank"
                  rel="noreferrer"
                  class="chat-bubble__attachment"
                >
                  {{ message.attachment.name }}
                </a>
              </div>
            </article>
          </div>
        </section>

        <footer class="chat-composer-shell">
          <div v-if="pendingAttachment" class="chat-composer__attachment">
            <UiBadge variant="secondary">{{ pendingAttachment.name }}</UiBadge>
            <UiButton variant="ghost" size="sm" @click="clearAttachment">移除</UiButton>
          </div>

          <label v-if="error" class="error-text chat-composer__error">{{ error }}</label>

          <div class="chat-composer">
            <input ref="fileInputEl" type="file" class="chat-composer__file" @change="uploadAttachment" />

            <UiButton variant="ghost" size="icon" :disabled="!activeRoom" @click="openFilePicker">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                />
              </svg>
            </UiButton>

            <UiTextarea
              v-model="composerText"
              class="chat-composer__input"
              rows="1"
              :disabled="!activeRoom"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              @keydown="handleComposerKeydown"
            />

            <UiButton
              variant="default"
              size="icon"
              :disabled="sending || !activeRoom"
              @click="sendMessage"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 12 20 4l-4 16-4.5-6L4 12Z"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                />
              </svg>
            </UiButton>
          </div>
        </footer>
      </main>
    </div>
  </div>
</template>
