<template>
  <RuntimeHealthBanner :health="runtimeHealth.snapshot" />
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import RuntimeHealthBanner from './components/runtime-health-banner.vue'
import { useRuntimeHealthStore } from './stores/runtime-health'

const runtimeHealth = useRuntimeHealthStore()

onMounted(() => {
  void runtimeHealth.refresh()
})
</script>
