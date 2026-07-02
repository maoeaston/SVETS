<template>
  <div class="version-list">
    <header class="header">
      <div class="title-group">
        <RouterLink to="/admin/strategies" class="back-link">← 返回列表</RouterLink>
        <h2 class="title">策略族版本</h2>
      </div>
      <div v-if="familyLoaded" class="family-meta">
        <span class="meta-tag">{{ formatType(familyStrategyType) }}</span>
        <span class="meta-job">{{ familyJobCode }}</span>
      </div>
      <div class="actions">
        <button v-if="isAdmin" class="btn-primary" @click="goNewVersion">新增版本</button>
      </div>
    </header>

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
    <p v-if="toggleMsg" class="info-msg" role="status">{{ toggleMsg }}</p>

    <table v-if="!loading" class="table">
      <thead>
        <tr>
          <th>版本</th>
          <th>策略名</th>
          <th>状态</th>
          <th>阈值</th>
          <th>更新时间</th>
          <th class="col-action">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="items.length === 0">
          <td colspan="6" class="empty">暂无版本</td>
        </tr>
        <tr v-for="row in items" :key="`${row.strategyId}:${row.version}`">
          <td>v{{ row.version }}</td>
          <td>{{ row.strategyName }}</td>
          <td>
            <span :class="['tag', row.isActive ? 'tag-active' : 'tag-inactive']">
              {{ row.isActive ? '启用' : '停用' }}
            </span>
          </td>
          <td>
            <span class="threshold">达标 {{ row.competentThreshold }}</span>
            <span class="threshold">条件 {{ row.conditionalThreshold }}</span>
          </td>
          <td>{{ formatTime(row.updatedAt) }}</td>
          <td class="col-action">
            <template v-if="isAdmin">
              <RouterLink :to="`/admin/strategies/${row.strategyId}/v/${row.version}`" class="link">
                编辑
              </RouterLink>
              <button
                class="btn-toggle"
                :disabled="togglingVersion === row.version"
                @click="toggleActive(row)"
              >
                {{ row.isActive ? '停用' : '启用' }}
              </button>
            </template>
            <span v-else class="readonly-hint">只读</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="loading">加载中…</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type { StrategySummary, StrategyType } from '@shared/types/strategy'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const strategyId = computed(() => String(route.params.strategyId ?? ''))

const items = ref<StrategySummary[]>([])
const loading = ref(false)
const errorMsg = ref('')
const toggleMsg = ref('')
const togglingVersion = ref<number | null>(null)

const familyLoaded = ref(false)
const familyStrategyType = ref<StrategyType>('BASELINE_ASSESSMENT')
const familyJobCode = ref('')

const isAdmin = computed(() => auth.role === 'ADMIN')

async function fetchVersions(): Promise<void> {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  if (!strategyId.value) {
    errorMsg.value = '缺少 strategyId'
    return
  }
  loading.value = true
  errorMsg.value = ''
  toggleMsg.value = ''
  try {
    const res = await window.api.strategy.listVersions({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyId: strategyId.value
    })
    if (!res.success) {
      errorMsg.value =
        res.errorCode === 'FORBIDDEN'
          ? '无权限'
          : res.errorCode === 'NOT_FOUND'
            ? '策略族不存在'
            : '加载失败'
      items.value = []
      familyLoaded.value = false
      return
    }
    items.value = res.items
    familyStrategyType.value = res.familyStrategyType
    familyJobCode.value = res.familyJobCode
    familyLoaded.value = true
  } catch {
    errorMsg.value = '系统异常'
    items.value = []
    familyLoaded.value = false
  } finally {
    loading.value = false
  }
}

async function toggleActive(row: StrategySummary): Promise<void> {
  if (!auth.userId || !auth.role) return
  togglingVersion.value = row.version
  toggleMsg.value = ''
  try {
    const res = await window.api.strategy.setActive({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyId: row.strategyId,
      version: row.version,
      isActive: !row.isActive
    })
    if (!res.success) {
      toggleMsg.value =
        res.errorCode === 'NOT_FOUND'
          ? '版本不存在'
          : res.errorCode === 'FORBIDDEN'
            ? '无权限'
            : '操作失败'
      return
    }
    // 先 refetch（fetchVersions 会清 toggleMsg），再赋值——否则成功提示被立即清空
    const verb = row.isActive ? '停用' : '启用'
    await fetchVersions()
    toggleMsg.value = `v${row.version} 已${verb}`
  } catch {
    toggleMsg.value = '系统异常'
  } finally {
    togglingVersion.value = null
  }
}

function goNewVersion(): void {
  // 路由在 Step 6 注册；当前点击会落到无匹配路由（预期）。
  void router.push(`/admin/strategies/${strategyId.value}/new-version`)
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

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

onMounted(() => {
  void fetchVersions()
})
</script>

<style scoped>
.version-list {
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
.title-group {
  display: flex;
  align-items: center;
  gap: 16px;
}
.back-link {
  color: #6b7280;
  text-decoration: none;
  font-size: 13px;
}
.back-link:hover {
  color: #3b82f6;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}
.family-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.meta-tag {
  padding: 2px 10px;
  background: #e0e7ff;
  color: #3730a3;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.meta-job {
  font-size: 13px;
  color: #6b7280;
  font-family: monospace;
}
.actions {
  display: flex;
  gap: 8px;
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
  width: 160px;
  display: flex;
  gap: 12px;
  align-items: center;
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
.tag-inactive {
  background: #e5e7eb;
  color: #4b5563;
}
.threshold {
  display: inline-block;
  margin-right: 8px;
  font-size: 12px;
  color: #6b7280;
}
.link {
  color: #3b82f6;
  text-decoration: none;
  font-size: 13px;
}
.link:hover {
  text-decoration: underline;
}
.btn-toggle {
  padding: 4px 10px;
  background: #fff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.btn-toggle:hover:not(:disabled) {
  background: #f3f4f6;
}
.btn-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.readonly-hint {
  font-size: 12px;
  color: #9ca3af;
}
.loading {
  text-align: center;
  color: #9ca3af;
  padding: 32px 0;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  margin-bottom: 12px;
}
.info-msg {
  color: #2563eb;
  font-size: 13px;
  margin-bottom: 12px;
}
</style>
