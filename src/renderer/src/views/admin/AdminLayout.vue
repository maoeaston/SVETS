<template>
  <WorkspaceShell role-label="管理员维护台" home-to="/admin" :nav-items="navItems" />
</template>

<script setup lang="ts">
import WorkspaceShell from '../../components/WorkspaceShell.vue'

const navItems = [
  { index: '01', label: '维护概览', to: '/admin' },
  { index: '02', label: '账号管理', to: '/admin/accounts' },
  { index: '03', label: '策略配置', to: '/admin/strategies' },
  { index: '04', label: '岗位题库', to: '/admin/question-bank' },
  { index: '05', label: '安全复盘', to: '/admin/safety' },
  { index: '06', label: '异常中心', to: '/admin/exceptions' },
  { index: '07', label: '资源与恢复', to: '/admin/readiness' }
]
</script>
