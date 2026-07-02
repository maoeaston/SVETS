<template>
  <div class="teacher-shell">
    <aside class="sidebar">
      <div class="brand">职途向导 · 教师端</div>
      <nav class="nav">
        <RouterLink to="/teacher/students" class="nav-item">学生列表</RouterLink>
        <RouterLink to="/teacher/students/new" class="nav-item">新建学生</RouterLink>
        <RouterLink v-if="auth.role === 'ADMIN'" to="/admin/strategies" class="nav-item">策略配置</RouterLink>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-spacer" />
        <div class="user-info">
          <span>{{ auth.displayName ?? '未登录' }}</span>
          <button class="btn-logout" @click="handleLogout">退出</button>
        </div>
      </header>
      <section class="content">
        <RouterView />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const auth = useAuthStore()

function handleLogout(): void {
  auth.clear()
  void router.push('/login')
}
</script>

<style scoped>
.teacher-shell {
  display: flex;
  height: 100%;
}
.sidebar {
  width: 200px;
  background: #1f2937;
  color: #d1d5db;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
}
.brand {
  padding: 0 20px 20px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  border-bottom: 1px solid #374151;
}
.nav {
  display: flex;
  flex-direction: column;
  padding-top: 12px;
}
.nav-item {
  padding: 10px 20px;
  color: #d1d5db;
  text-decoration: none;
  font-size: 14px;
  transition: background 0.15s;
}
.nav-item:hover {
  background: #374151;
}
.nav-item.router-link-active {
  background: #3b82f6;
  color: #fff;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  padding: 0 24px;
}
.topbar-spacer {
  flex: 1;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: #374151;
}
.btn-logout {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-logout:hover {
  background: #f3f4f6;
}
.content {
  flex: 1;
  padding: 24px;
  background: #f9fafb;
  overflow-y: auto;
}
</style>
