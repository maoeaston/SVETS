<template>
  <div class="strategy-list">
    <header class="header">
      <h2 class="title">策略配置</h2>
      <div class="actions">
        <label class="field-label">
          类型
          <select v-model="filterType" class="select">
            <option value="">全部</option>
            <option value="BASELINE_ASSESSMENT">能力测评</option>
            <option value="MOCK_EXAM">模拟考试</option>
            <option value="TRAINING_PRACTICE">训练</option>
          </select>
        </label>
        <input
          v-model="filterJobCodeInput"
          class="search"
          type="text"
          placeholder="按岗位代码搜索"
        />
        <label class="toggle">
          <input type="checkbox" v-model="includeInactive" />
          <span>包含停用</span>
        </label>
        <button v-if="auth.role === 'ADMIN'" class="btn-primary" @click="goCreate">
          新建策略
        </button>
      </div>
    </header>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <table v-if="!loading" class="table">
      <thead>
        <tr>
          <th>策略名</th>
          <th>类型</th>
          <th>岗位代码</th>
          <th>最新版本</th>
          <th>启用 / 总版本</th>
          <th class="col-action">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="groups.length === 0">
          <td colspan="6" class="empty">暂无策略</td>
        </tr>
        <tr v-for="g in groups" :key="g.strategyId">
          <td>{{ g.strategyName }}</td>
          <td>{{ formatType(g.strategyType) }}</td>
          <td>{{ g.jobCode }}</td>
          <td>v{{ g.latestVersion }}</td>
          <td>{{ g.activeCount }} / {{ g.totalVersions }}</td>
          <td class="col-action">
            <RouterLink :to="`/admin/strategies/${g.strategyId}`" class="link">
              查看版本
            </RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="loading">加载中…</p>

    <footer v-if="!loading && items.length > 0" class="pagination">
      <button class="btn-page" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
      <span class="page-indicator">第 {{ page }} 页</span>
      <button class="btn-page" :disabled="items.length < 20" @click="goPage(page + 1)">
        下一页
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type { StrategySummary, StrategyType } from '@shared/types/strategy'

const router = useRouter()
const auth = useAuthStore()

const items = ref<StrategySummary[]>([])
const loading = ref(false)
const errorMsg = ref('')

// 过滤栏
const filterType = ref<StrategyType | ''>('')
const filterJobCodeInput = ref('')
const filterJobCode = ref('')        // 防抖后实际触发查询的值
const includeInactive = ref(true)    // 默认含停用：管理员通常要看全量
const page = ref(1)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

// 按 strategyId 分组（族级视图）。同一族内 type/jobCode 语义上一致（handler
// createVersion 在 version>=2 时强制 type/job 匹配），取最新版本的 strategyName 展示。
interface StrategyFamilyGroup {
  strategyId: string
  strategyType: StrategyType
  jobCode: string
  strategyName: string
  latestVersion: number
  activeCount: number
  totalVersions: number
}

const groups = computed<StrategyFamilyGroup[]>(() => {
  const map = new Map<string, StrategyFamilyGroup>()
  for (const item of items.value) {
    const existing = map.get(item.strategyId)
    if (existing) {
      if (item.version > existing.latestVersion) {
        existing.latestVersion = item.version
        existing.strategyName = item.strategyName
      }
      existing.totalVersions += 1
      if (item.isActive) existing.activeCount += 1
    } else {
      map.set(item.strategyId, {
        strategyId: item.strategyId,
        strategyType: item.strategyType,
        jobCode: item.jobCode,
        strategyName: item.strategyName,
        latestVersion: item.version,
        activeCount: item.isActive ? 1 : 0,
        totalVersions: 1
      })
    }
  }
  return Array.from(map.values())
})

async function fetchList(): Promise<void> {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await window.api.strategy.list({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyType: filterType.value === '' ? undefined : filterType.value,
      jobCode: filterJobCode.value.trim() || undefined,
      includeInactive: includeInactive.value,
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
  // 路由在 Step 6 注册；当前点击会落到无匹配路由（预期）。
  void router.push('/admin/strategies/new')
}

function goPage(n: number): void {
  if (n < 1) return
  page.value = n
  void fetchList()
}

function formatType(t: StrategyType): string {
  return t === 'BASELINE_ASSESSMENT'
    ? '能力测评'
    : t === 'MOCK_EXAM'
      ? '模拟考试'
      : t === 'TRAINING_PRACTICE'
        ? '训练'
        : '未知'
}

// 岗位代码输入防抖 300ms
watch(filterJobCodeInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    filterJobCode.value = val.trim()
    page.value = 1
    void fetchList()
  }, 300)
})

watch(filterType, () => {
  page.value = 1
  void fetchList()
})

watch(includeInactive, () => {
  page.value = 1
  void fetchList()
})

onMounted(() => {
  void fetchList()
})
</script>

<style scoped>
.strategy-list {
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
.field-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #555;
}
.select {
  padding: 7px 10px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  background: #fff;
}
.select:focus {
  border-color: #3b82f6;
}
.search {
  padding: 8px 12px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  width: 200px;
}
.search:focus {
  border-color: #3b82f6;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #555;
  cursor: pointer;
}
.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
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
  width: 120px;
}
.empty {
  text-align: center;
  color: #9ca3af;
  padding: 32px 0;
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
