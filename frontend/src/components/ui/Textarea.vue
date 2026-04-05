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
  <textarea
    class="ui-textarea"
    :value="modelValue"
    @input="emit('update:modelValue', $event.target.value)"
  ></textarea>
</template>
