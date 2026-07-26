<template>
  <WorkspaceShell role-label="教师工作台" home-to="/teacher" :nav-items="navItems" />
</template>

<script setup lang="ts">
import WorkspaceShell from '../../components/WorkspaceShell.vue'

const navItems = [
  { index: '01', label: '工作概览', to: '/teacher' },
  { index: '02', label: '学生档案', to: '/teacher/students' },
  { index: '03', label: '测评任务', to: '/teacher/assessments' },
  { index: '04', label: '训练任务', to: '/teacher/trainings' },
  { index: '05', label: '任务报告', to: '/teacher/reports' },
  { index: '06', label: '安全事件', to: '/teacher/safety' },
  { index: '07', label: '教学异常', to: '/teacher/exceptions' }
]
</script>
