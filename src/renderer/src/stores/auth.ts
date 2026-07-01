import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const userId      = ref<string | null>(null)
  const role        = ref<'STUDENT' | 'TEACHER' | 'ADMIN' | null>(null)
  const displayName = ref<string | null>(null)

  const isLoggedIn = computed(() => userId.value !== null)

  function setUser(data: {
    userId: string
    role: 'STUDENT' | 'TEACHER' | 'ADMIN'
    displayName: string
  }): void {
    userId.value      = data.userId
    role.value        = data.role
    displayName.value = data.displayName
  }

  function clear(): void {
    userId.value      = null
    role.value        = null
    displayName.value = null
  }

  return { userId, role, displayName, isLoggedIn, setUser, clear }
})
