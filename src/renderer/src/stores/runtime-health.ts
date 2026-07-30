import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type RuntimeHealthSnapshot = Awaited<ReturnType<typeof window.api.runtime.getHealth>>

export function formatRuntimeReadOnlyMessage(health: RuntimeHealthSnapshot): string {
  return health.blockingCode
    ? `写入操作已暂停（${health.blockingCode}）。`
    : '写入操作已暂停。'
}

export const useRuntimeHealthStore = defineStore('runtime-health', () => {
  const snapshot = ref<RuntimeHealthSnapshot | null>(null)
  const loading = ref(false)
  const unavailable = ref(false)

  const isReadOnly = computed(() => snapshot.value?.state === 'CORRUPTION_READ_ONLY')

  async function refresh(): Promise<void> {
    loading.value = true
    unavailable.value = false
    try {
      snapshot.value = await window.api.runtime.getHealth()
    } catch (error) {
      console.error('[RuntimeHealthStore] health query failed:', error)
      unavailable.value = true
    } finally {
      loading.value = false
    }
  }

  return { snapshot, loading, unavailable, isReadOnly, refresh }
})
