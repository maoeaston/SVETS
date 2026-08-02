import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ActivationOperationResult,
  ActivationSnapshot
} from '@shared/types/activation'

export const useActivationStore = defineStore('activation', () => {
  const snapshot = ref<ActivationSnapshot | null>(null)
  const initialized = ref(false)
  const loading = ref(false)
  const transportError = ref(false)

  const activated = computed(() => snapshot.value?.activated === true)

  async function refresh(): Promise<ActivationSnapshot | null> {
    loading.value = true
    transportError.value = false
    try {
      snapshot.value = await window.api.activation.getStatus()
      return snapshot.value
    } catch (error) {
      console.error('[ActivationStore] status failed:', error)
      transportError.value = true
      snapshot.value = null
      return null
    } finally {
      initialized.value = true
      loading.value = false
    }
  }

  async function apply(operation: () => Promise<ActivationOperationResult>): Promise<ActivationOperationResult> {
    loading.value = true
    transportError.value = false
    try {
      const result = await operation()
      snapshot.value = result.snapshot
      return result
    } catch (error) {
      console.error('[ActivationStore] operation failed:', error)
      transportError.value = true
      throw error
    } finally {
      initialized.value = true
      loading.value = false
    }
  }

  function configureServer(serverUrl: string): Promise<ActivationOperationResult> {
    return apply(() => window.api.activation.configureServer({ serverUrl }))
  }

  function activate(licenseKey: string): Promise<ActivationOperationResult> {
    return apply(() => window.api.activation.activate({ licenseKey }))
  }

  function validate(): Promise<ActivationOperationResult> {
    return apply(() => window.api.activation.validate())
  }

  return {
    snapshot,
    initialized,
    loading,
    transportError,
    activated,
    refresh,
    configureServer,
    activate,
    validate
  }
})
