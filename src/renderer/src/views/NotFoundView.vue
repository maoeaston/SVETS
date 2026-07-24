<template>
  <main class="not-found">
    <span>404</span>
    <h1>这个页面不存在</h1>
    <p>链接可能已经变化。返回当前账号的首页继续。</p>
    <RouterLink :to="homePath">返回首页</RouterLink>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const homePath = computed(() => auth.role === 'STUDENT' ? '/student' : auth.role === 'ADMIN' ? '/admin' : auth.role === 'TEACHER' ? '/teacher' : '/login')
</script>

<style scoped>
.not-found { display: grid; place-content: center; min-height: 100%; padding: 28px; background: var(--color-canvas); text-align: center; }
.not-found > span { color: var(--color-accent-dark); font-size: 13px; font-weight: 850; }
h1 { margin: 5px 0; font-size: clamp(28px, 5vw, 44px); }
p { margin: 0; color: var(--color-text-muted); }
a { justify-self: center; margin-top: 18px; padding: 9px 16px; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-accent-ink); font-weight: 800; text-decoration: none; }
a:active { transform: scale(.96); }
</style>
