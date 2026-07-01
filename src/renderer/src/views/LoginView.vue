<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">职途向导系统</h1>
      <form class="login-form" @submit.prevent="handleLogin">
        <div class="field">
          <label for="username">用户名</label>
          <input id="username" v-model="form.username" type="text" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>
        <p v-if="error" class="error-msg" role="alert">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router    = useRouter()
const authStore = useAuthStore()

const form    = ref({ username: '', password: '' })
const loading = ref(false)
const error   = ref('')

async function handleLogin(): Promise<void> {
  loading.value = true
  error.value   = ''
  try {
    const result = await window.api.auth.login(form.value)

    if (!result.success) {
      error.value =
        result.errorCode === 'ACCOUNT_DISABLED'
          ? '账号已停用，请联系管理员'
          : '用户名或密码错误'
      return
    }

    authStore.setUser(result)

    if (result.role === 'STUDENT') {
      await router.push('/student')
    } else {
      // TEACHER 和 ADMIN 均进入教师端
      await router.push('/teacher')
    }
  } catch {
    error.value = '系统异常，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: #f0f4f8;
}
.login-card {
  background: #fff;
  border-radius: 12px;
  padding: 48px 40px;
  width: 360px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}
.login-title {
  font-size: 22px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 32px;
  color: #1a1a1a;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 14px;
  color: #555;
}
.field input {
  padding: 10px 14px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.15s;
}
.field input:focus {
  border-color: #3b82f6;
}
.btn-primary {
  padding: 12px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  text-align: center;
}
</style>
