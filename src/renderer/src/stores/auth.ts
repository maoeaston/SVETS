import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AuthSessionSnapshot } from '@shared/types/auth'

export const useAuthStore = defineStore('auth', () => {
  const authSessionId = ref<string | null>(null)
  const userId = ref<string | null>(null)
  const role = ref<'STUDENT' | 'TEACHER' | 'ADMIN' | null>(null)
  const displayName = ref<string | null>(null)
  const expiresAt = ref<string | null>(null)
  const initialized = ref(false)

  const isLoggedIn = computed(() => userId.value !== null)

  function setUser(data: AuthSessionSnapshot): void {
    authSessionId.value = data.authSessionId
    userId.value = data.userId
    role.value = data.role
    displayName.value = data.displayName
    expiresAt.value = data.expiresAt
    initialized.value = true
  }

  function markInitialized(): void {
    initialized.value = true
  }

  function clear(): void {
    authSessionId.value = null
    userId.value = null
    role.value = null
    displayName.value = null
    expiresAt.value = null
    initialized.value = true
  }

  return {
    authSessionId,
    userId,
    role,
    displayName,
    expiresAt,
    initialized,
    isLoggedIn,
    setUser,
    markInitialized,
    clear
  }
})
