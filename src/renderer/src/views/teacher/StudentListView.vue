<template>
  <div class="student-list">
    <header class="header">
      <h2 class="title">学生列表</h2>
      <div class="actions">
        <label class="toggle">
          <input type="checkbox" v-model="includeArchived" />
          <span>包含已归档</span>
        </label>
        <input
          v-model="searchInput"
          class="search"
          type="text"
          placeholder="按姓名搜索"
        />
        <button class="btn-primary" @click="goCreate">新建学生</button>
      </div>
    </header>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <table v-if="!loading" class="table">
      <thead>
        <tr>
          <th>姓名</th>
          <th>性别</th>
          <th>状态</th>
          <th>创建时间</th>
          <th class="col-action">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="items.length === 0">
          <td colspan="5" class="empty">暂无学生</td>
        </tr>
        <tr v-for="row in items" :key="row.studentId">
          <td>{{ row.studentName }}</td>
          <td>{{ formatGender(row.gender) }}</td>
          <td>
            <span :class="['tag', row.status === 'ACTIVE' ? 'tag-active' : 'tag-archived']">
              {{ row.status === 'ACTIVE' ? '在册' : '已归档' }}
            </span>
          </td>
          <td>{{ formatTime(row.createdAt) }}</td>
          <td class="col-action">
            <RouterLink :to="`/teacher/students/${row.studentId}`" class="link">查看 / 编辑</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="loading">加载中…</p>

    <footer v-if="!loading && items.length > 0" class="pagination">
      <button class="btn-page" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
      <span class="page-indicator">第 {{ page }} 页</span>
      <button
        class="btn-page"
        :disabled="items.length < 20"
        @click="goPage(page + 1)"
      >下一页</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type { StudentSummary } from '@shared/types/student'

const router = useRouter()
const auth = useAuthStore()

const items = ref<StudentSummary[]>([])
const loading = ref(false)
const errorMsg = ref('')
const searchInput = ref('')
const search = ref('')             // 实际触发查询的值（防抖后）
const includeArchived = ref(false)
const page = ref(1)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function fetchList(): Promise<void> {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await window.api.student.list({
      callerUserId: auth.userId,
      callerRole: auth.role,
      search: search.value || undefined,
      includeArchived: includeArchived.value,
      page: page.value
    })
    if (!res.success) {
      errorMsg.value = res.errorCode === 'FORBIDDEN' ? '无权限' : '加载失败'
      items.value = []
      return
    }
    items.value = res.items
  } catch {
    errorMsg.value = '系统异常'
    items.value = []
  } finally {
    loading.value = false
  }
}

function goCreate(): void {
  void router.push('/teacher/students/new')
}

function goPage(n: number): void {
  if (n < 1) return
  page.value = n
  void fetchList()
}

function formatGender(g: StudentSummary['gender']): string {
  return g === 'MALE' ? '男' : g === 'FEMALE' ? '女' : g === 'OTHER' ? '其他' : '未知'
}

function formatTime(iso: string): string {
  // SQLite datetime('now') 格式为 'YYYY-MM-DD HH:MM:SS'，截取前 16 位 + 替换 T
  return iso.replace('T', ' ').slice(0, 16)
}

// 搜索输入防抖 300ms
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    search.value = val.trim()
    page.value = 1
    void fetchList()
  }, 300)
})

// 切换包含归档 → 重新拉取第 1 页
watch(includeArchived, () => {
  page.value = 1
  void fetchList()
})

onMounted(() => {
  void fetchList()
})
</script>

<style scoped>
.student-list {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  gap: 16px;
  flex-wrap: wrap;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #555;
  cursor: pointer;
}
.search {
  padding: 8px 12px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  width: 220px;
}
.search:focus {
  border-color: #3b82f6;
}
.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
}
.btn-primary:hover {
  background: #2563eb;
}
.table {
  width: 100%;
  border-collapse: collapse;
}
.table th,
.table td {
  padding: 12px 8px;
  text-align: left;
  font-size: 14px;
  color: #374151;
  border-bottom: 1px solid #e5e7eb;
}
.table th {
  font-weight: 600;
  background: #f9fafb;
  color: #6b7280;
}
.col-action {
  width: 160px;
}
.empty {
  text-align: center;
  color: #9ca3af;
  padding: 32px 0;
}
.tag {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.tag-active {
  background: #dcfce7;
  color: #166534;
}
.tag-archived {
  background: #e5e7eb;
  color: #4b5563;
}
.link {
  color: #3b82f6;
  text-decoration: none;
  font-size: 13px;
}
.link:hover {
  text-decoration: underline;
}
.loading {
  text-align: center;
  color: #9ca3af;
  padding: 32px 0;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 20px;
}
.btn-page {
  padding: 6px 14px;
  background: #fff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.btn-page:hover:not(:disabled) {
  background: #f3f4f6;
}
.btn-page:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.page-indicator {
  font-size: 14px;
  color: #374151;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  margin-bottom: 12px;
}
</style>
