<script setup>
defineProps({
  modelValue: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <input
    class="ui-input"
    :value="modelValue"
    @input="emit('update:modelValue', $event.target.value)"
  />
</template>
