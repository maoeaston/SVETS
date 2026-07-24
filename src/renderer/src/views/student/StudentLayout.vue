<template>
  <WorkspaceShell role-label="学生任务台" home-to="/student" :nav-items="navItems" />
</template>

<script setup lang="ts">
import WorkspaceShell from '../../components/WorkspaceShell.vue'

const navItems = [
  { index: '01', label: '今天的任务', to: '/student' }
]
</script>
