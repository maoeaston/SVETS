<template>
  <div class="training-list-view">
    <div class="view-header">
      <h2>训练管理</h2>
      <button class="btn-primary" @click="$router.push('/teacher/trainings/create')">新建训练</button>
    </div>

    <div class="filter-bar">
      <input v-model="filterStudentId" placeholder="按学生 ID 筛选" style="width:200px" />
      <select v-model="filterStatus">
        <option value="">全部状态</option>
        <option value="INIT">INIT</option>
        <option value="ACTIVE">ACTIVE</option>
        <option value="COMPLETED">COMPLETED</option>
        <option value="REDLINE_HALTED">REDLINE_HALTED</option>
      </select>
      <button @click="load">查询</button>
    </div>

    <div v-if="loading">加载中…</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>学生 ID</th>
          <th>模块</th>
          <th>状态</th>
          <th>完成率</th>
          <th>开始时间</th>
          <th>完成时间</th>
          <th>创建者</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in sessions" :key="s.trainingSessionId">
          <td>{{ s.studentId }}</td>
          <td>{{ s.moduleType ?? '-' }}</td>
          <td>
            <span :class="['badge', `badge-${s.status.toLowerCase()}`]">{{ s.status }}</span>
          </td>
          <td>{{ s.completionRate != null ? s.completionRate.toFixed(1) + '%' : '-' }}</td>
          <td>{{ s.startedAt ? s.startedAt.slice(0, 16) : '-' }}</td>
          <td>{{ s.completedAt ? s.completedAt.slice(0, 16) : '-' }}</td>
          <td>{{ s.createdBy }}</td>
        </tr>
        <tr v-if="sessions.length === 0">
          <td colspan="7" style="text-align:center;color:#888">暂无训练记录</td>
        </tr>
      </tbody>
    </table>
    <div v-if="!loading && !error" class="pagination-info">共 {{ total }} 条</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../../stores/auth'
import type { TrainingSessionListItem, TrainingSessionStatus } from '@shared/types/training'

const authStore = useAuthStore()
const sessions = ref<TrainingSessionListItem[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const filterStudentId = ref('')
const filterStatus = ref<TrainingSessionStatus | ''>('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.training.listSessions({
      callerUserId: authStore.userId!,
      callerRole: authStore.role!,
      studentId: filterStudentId.value || undefined,
      status: (filterStatus.value || undefined) as TrainingSessionStatus | undefined,
      limit: 50,
      offset: 0
    })
    if (result.success) {
      sessions.value = result.sessions
      total.value = result.total
    } else {
      error.value = `加载失败：${result.errorCode}`
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.training-list-view { padding: 20px; }
.view-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.filter-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
.data-table th { background: #f5f5f5; }
.badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.badge-init { background: #e0f0ff; color: #1a6fb5; }
.badge-active { background: #d4edda; color: #155724; }
.badge-completed { background: #c3e6cb; color: #155724; }
.badge-redline_halted { background: #f8d7da; color: #721c24; }
.badge-aborted { background: #f0f0f0; color: #666; }
.error { color: red; margin: 12px 0; }
.btn-primary { background: #1a6fb5; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
.pagination-info { margin-top: 8px; color: #888; font-size: 13px; }
</style>
