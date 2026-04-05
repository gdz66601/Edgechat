<script setup>
defineProps({
  tone: {
    type: String,
    default: 'default'
  }
});
</script>

<template>
  <section class="ui-surface" :class="`ui-surface--${tone}`">
    <slot />
  </section>
</template>
