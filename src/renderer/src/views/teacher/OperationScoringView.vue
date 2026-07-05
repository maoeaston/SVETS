<template>
  <div class="operation-scoring">
    <header class="header">
      <RouterLink
        to="/teacher/assessments"
        class="back-link"
      >
        ← 返回测评列表
      </RouterLink>
      <h2 class="title">
        实操评分
      </h2>
      <p class="subtitle muted">
        会话 ID：{{ sessionId.slice(0, 8) }}…
      </p>
    </header>

    <p
      v-if="errorMsg"
      class="error-msg"
      role="alert"
    >
      {{ errorMsg }}
    </p>

    <div
      v-if="loading"
      class="loading"
    >
      加载中…
    </div>

    <!-- 只读模式：已评分 -->
    <div
      v-else-if="isReadOnly"
      class="result-card"
    >
      <h3>评分结果（只读）</h3>
      <p>
        得分：<strong>{{ existingResult.normalizedScore }}</strong> 分
      </p>
      <p>
        等级：<strong>{{ formatLevel(existingResult.levelResult) }}</strong>
      </p>
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>评分项</th>
            <th>得分</th>
            <th>观察备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, idx) in existingItems"
            :key="item.taskOperationCode"
          >
            <td>{{ idx + 1 }}</td>
            <td>{{ rubricName(item.taskOperationCode) }}</td>
            <td>{{ item.score }} / 2</td>
            <td class="muted">
              {{ item.observationNote ?? '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 评分表单 -->
    <form
      v-else
      class="scoring-form"
      @submit.prevent="handleSubmit"
    >
      <!-- 教具清单确认 -->
      <div class="checklist-row">
        <label class="checklist-label">
          <input
            v-model="toolChecklistConfirmed"
            type="checkbox"
          >
          教具清单已确认（所有教具就位，符合实操要求）
        </label>
      </div>

      <!-- 9 项评分表 -->
      <table class="table scoring-table">
        <thead>
          <tr>
            <th>#</th>
            <th>评分项</th>
            <th>评分标准</th>
            <th>得分</th>
            <th>观察备注（可选）</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(rubric, idx) in OPERATION_RUBRICS"
            :key="rubric.code"
          >
            <td>{{ idx + 1 }}</td>
            <td class="item-name">
              {{ rubric.name }}
            </td>
            <td class="rubric-desc">
              <div
                v-for="level in rubric.rubric"
                :key="level.score"
                class="rubric-level"
              >
                <span class="score-badge">{{ level.score }}</span>
                {{ level.description }}
              </div>
            </td>
            <td class="score-select">
              <label
                v-for="s in [0, 1, 2]"
                :key="s"
                class="radio-label"
              >
                <input
                  v-model.number="scores[rubric.code]"
                  type="radio"
                  :name="rubric.code"
                  :value="s"
                >
                {{ s }}
              </label>
            </td>
            <td>
              <input
                v-model="notes[rubric.code]"
                type="text"
                class="note-input"
                placeholder="备注…"
              >
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 进度摘要 -->
      <div class="summary-row">
        已评：{{ scoredCount }} / 9 项
        <span
          v-if="scoredCount === 9"
          class="muted"
        >
          · 预计得分 {{ previewScore }} 分（{{ previewLevel }}）
        </span>
      </div>

      <div class="form-actions">
        <button
          type="submit"
          class="btn-primary"
          :disabled="!canSubmit || submitting"
        >
          {{ submitting ? '提交中…' : '提交评分' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import {
  OPERATION_RUBRICS,
  TASK_OPERATION_CODES
} from '@shared/types/operation-scoring'
import type { TaskOperationCode, OperationScoreItem } from '@shared/types/operation-scoring'

const route = useRoute()
const auth = useAuthStore()

const sessionId = route.params.sessionId as string

// 页面状态
const loading = ref(true)
const errorMsg = ref('')
const submitting = ref(false)

// 只读模式数据
const isReadOnly = ref(false)
const existingItems = ref<OperationScoreItem[]>([])
const existingResult = ref<{ normalizedScore?: number; levelResult?: string }>({})

// 表单状态
const toolChecklistConfirmed = ref(false)
const scores = reactive<Record<string, number | null>>(
  Object.fromEntries(TASK_OPERATION_CODES.map((c) => [c, null]))
)
const notes = reactive<Record<string, string>>(
  Object.fromEntries(TASK_OPERATION_CODES.map((c) => [c, '']))
)

// 计算辅助
const scoredCount = computed(
  () => TASK_OPERATION_CODES.filter((c) => scores[c] !== null).length
)

const canSubmit = computed(
  () => toolChecklistConfirmed.value && scoredCount.value === 9 && !submitting.value
)

const previewScore = computed(() => {
  const raw = TASK_OPERATION_CODES.reduce((sum, c) => sum + (scores[c] ?? 0), 0)
  return Math.round((raw / 18) * 100)
})

const previewLevel = computed(() => formatLevel(levelFromScore(previewScore.value)))

function levelFromScore(score: number): string {
  // 默认阈值（无法在前端读 strategy_config，显示仅供参考）
  if (score >= 80) return 'LEVEL_COMPETENT'
  if (score >= 60) return 'LEVEL_CONDITIONAL'
  return 'LEVEL_NOT_COMPETENT'
}

function formatLevel(level: string | undefined): string {
  switch (level) {
    case 'LEVEL_COMPETENT': return '合格'
    case 'LEVEL_CONDITIONAL': return '有条件合格'
    case 'LEVEL_NOT_COMPETENT': return '不合格'
    default: return level ?? '—'
  }
}

function rubricName(code: string): string {
  return OPERATION_RUBRICS.find((r) => r.code === code)?.name ?? code
}

// 初始化：检查是否已评分
onMounted(async () => {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    loading.value = false
    return
  }
  try {
    const res = await window.api.assessment.getOperationScores({
      callerUserId: auth.userId,
      callerRole: auth.role,
      sessionId
    })
    if (!res.success) {
      errorMsg.value = `加载失败：${res.errorCode}`
    } else if (res.items.length > 0) {
      isReadOnly.value = true
      existingItems.value = res.items
      existingResult.value = {
        normalizedScore: res.normalizedScore,
        levelResult: res.levelResult
      }
    }
  } catch (err) {
    errorMsg.value = '加载失败，请重试'
  } finally {
    loading.value = false
  }
})

// 提交
async function handleSubmit(): Promise<void> {
  if (!canSubmit.value || !auth.userId || !auth.role) return

  submitting.value = true
  errorMsg.value = ''

  try {
    const scoreItems = TASK_OPERATION_CODES.map((code) => ({
      taskOperationCode: code as TaskOperationCode,
      score: (scores[code] ?? 0) as 0 | 1 | 2,
      observationNote: notes[code] || undefined
    }))

    const res = await window.api.assessment.submitOperationScores({
      callerUserId: auth.userId,
      callerRole: auth.role,
      sessionId,
      toolChecklistConfirmed: toolChecklistConfirmed.value,
      scores: scoreItems
    })

    if (!res.success) {
      const msgMap: Record<string, string> = {
        FORBIDDEN: '无权限',
        NOT_FOUND: '会话不存在',
        SESSION_NOT_OFFLINE_PENDING: '该会话不在"待线下评分"状态',
        ALREADY_SCORED: '该会话已完成实操评分',
        TOOL_CHECKLIST_NOT_CONFIRMED: '请先确认教具清单',
        BLOCKED_BY_SAFETY_INCIDENT: '存在未解决的安全事件，无法评分',
        VALIDATION_ERROR: '数据校验失败，请检查评分项',
        ASSESSMENT_SYSTEM_ERROR: '系统错误，请重试'
      }
      errorMsg.value = msgMap[res.errorCode] ?? res.errorCode
    } else {
      // 提交成功 → 切换只读模式
      isReadOnly.value = true
      existingResult.value = {
        normalizedScore: res.normalizedScore,
        levelResult: res.levelResult
      }
      // 重新拉取评分详情
      const detail = await window.api.assessment.getOperationScores({
        callerUserId: auth.userId!,
        callerRole: auth.role!,
        sessionId
      })
      if (detail.success) {
        existingItems.value = detail.items
      }
    }
  } catch (err) {
    errorMsg.value = '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.operation-scoring {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.header {
  margin-bottom: 24px;
}

.back-link {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--color-primary, #4f46e5);
  text-decoration: none;
  font-size: 14px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 4px;
}

.subtitle {
  margin: 0;
  font-size: 13px;
}

.muted {
  color: #6b7280;
  font-size: 13px;
}

.error-msg {
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #b91c1c;
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.loading {
  color: #6b7280;
  padding: 24px 0;
}

/* 结果卡 */
.result-card {
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 8px;
  padding: 20px;
}

.result-card h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: #166534;
}

/* 表格 */
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.table th,
.table td {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  vertical-align: top;
}

.table th {
  background: #f9fafb;
  font-weight: 600;
  text-align: left;
}

/* 评分表单 */
.checklist-row {
  margin-bottom: 20px;
  padding: 12px 16px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 6px;
}

.checklist-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.scoring-table .item-name {
  font-weight: 500;
  white-space: nowrap;
  min-width: 100px;
}

.rubric-desc {
  min-width: 260px;
}

.rubric-level {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
  color: #374151;
  line-height: 1.4;
}

.score-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: #e5e7eb;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.score-select {
  white-space: nowrap;
}

.radio-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 8px;
  font-size: 14px;
  cursor: pointer;
}

.note-input {
  width: 120px;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
}

.summary-row {
  margin: 16px 0;
  font-size: 14px;
  color: #374151;
}

.form-actions {
  margin-top: 20px;
}

.btn-primary {
  padding: 10px 24px;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
