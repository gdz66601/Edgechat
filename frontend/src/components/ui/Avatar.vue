<script setup>
import { computed } from 'vue';

const props = defineProps({
  src: {
    type: String,
    default: ''
  },
  alt: {
    type: String,
    default: ''
  },
  fallback: {
    type: String,
    default: '?'
  },
  size: {
    type: String,
    default: 'default'
  }
});

const initials = computed(() => String(props.fallback || '?').slice(0, 2).toUpperCase());
</script>

<template>
  <div class="ui-avatar" :class="`ui-avatar--${size}`">
    <img v-if="src" :src="src" :alt="alt" />
    <span v-else>{{ initials }}</span>
  </div>
</template>
