<template>
  <div class="assessment-create">
    <header class="header">
      <h2 class="title">
        发起测评
      </h2>
      <RouterLink
        to="/teacher/assessments"
        class="back-link"
      >
        ← 返回列表
      </RouterLink>
    </header>

    <p
      v-if="errorMsg"
      class="error-msg"
      role="alert"
    >
      {{ errorMsg }}
    </p>

    <form @submit.prevent="submit">
      <!-- 测评类型 -->
      <fieldset class="block">
        <legend>测评类型</legend>
        <div class="type-radio-group">
          <label class="type-radio-label">
            <input
              v-model="assessmentType"
              type="radio"
              value="BASELINE_ASSESSMENT"
            >
            能力测评（基础认知）
          </label>
          <label class="type-radio-label">
            <input
              v-model="assessmentType"
              type="radio"
              value="JOB_SKILL_ASSESSMENT"
            >
            专业岗位测评
          </label>
        </div>
      </fieldset>

      <!-- 学生选择 -->
      <fieldset class="block">
        <legend>学生</legend>
        <div class="grid">
          <label class="field">
            <span>搜索学生 <span class="required">*</span></span>
            <input
              v-model="searchInput"
              type="text"
              placeholder="按姓名搜索"
            >
          </label>
          <label class="field">
            <span>选择学生 <span class="required">*</span></span>
            <select
              v-model="form.studentId"
              required
            >
              <option value="">— 请选择 —</option>
              <option
                v-for="s in studentOptions"
                :key="s.studentId"
                :value="s.studentId"
              >{{ s.studentName }}（{{ s.studentId.slice(0, 8) }}）</option>
            </select>
          </label>
        </div>
        <p
          v-if="studentOptions.length === 0 && searchInput"
          class="hint"
        >
          无匹配学生
        </p>
      </fieldset>

      <!-- 策略 + 版本 -->
      <fieldset class="block">
        <legend>策略与版本</legend>
        <div class="grid">
          <label class="field">
            <span>策略 <span class="required">*</span></span>
            <select
              v-model="form.strategyId"
              required
              @change="onStrategyChange"
            >
              <option value="">— 请选择 —</option>
              <option
                v-for="s in strategyOptions"
                :key="s.strategyId"
                :value="s.strategyId"
              >{{ s.strategyName }}（{{ formatType(s.strategyType) }}）</option>
            </select>
          </label>
          <label class="field">
            <span>版本 <span class="required">*</span></span>
            <select
              v-model.number="form.strategyVersion"
              required
            >
              <option :value="0">— 请选择 —</option>
              <option
                v-for="v in versionOptions"
                :key="v.version"
                :value="v.version"
              >v{{ v.version }} {{ v.isActive ? '（启用）' : '' }}</option>
            </select>
          </label>
        </div>
      </fieldset>

      <!-- 岗位 + 任务（MVP 固定） -->
      <fieldset class="block">
        <legend>岗位与任务</legend>
        <div class="grid">
          <label class="field">
            <span>岗位</span>
            <input
              :value="form.jobCode"
              type="text"
              readonly
            >
          </label>
          <label class="field">
            <span>任务</span>
            <input
              :value="computedTaskCode"
              type="text"
              readonly
            >
          </label>
        </div>
        <p class="hint">
          MVP 范围：单一岗位（超市理货员），策略类型决定任务代码
        </p>
      </fieldset>

      <div
        v-if="createdSessionId"
        class="success-box"
      >
        测评创建成功！sessionId：<code>{{ createdSessionId }}</code>
        <RouterLink
          :to="`/teacher/assessments`"
          class="link"
        >
          前往列表查看
        </RouterLink>
      </div>

      <div class="form-actions">
        <button
          type="submit"
          class="btn-primary"
          :disabled="submitting"
        >
          {{ submitting ? '创建中…' : '发起测评' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useAssessmentStore } from '../../stores/assessment'
import type { StudentSummary } from '@shared/types/student'
import type { StrategySummary, StrategyType, StrategyVersionSummary } from '@shared/types/strategy'

const auth = useAuthStore()
const store = useAssessmentStore()

const submitting = ref(false)
const errorMsg = ref('')
const createdSessionId = ref('')

const assessmentType = ref<StrategyType>('BASELINE_ASSESSMENT')
const computedTaskCode = computed(() =>
  assessmentType.value === 'JOB_SKILL_ASSESSMENT' ? 'JOB_SKILL_DEMO_M1M6' : 'UNBOXING_AND_SHELVING'
)

const searchInput = ref('')
const searchQuery = ref('') // 防抖后的实际查询值

const studentOptions = ref<StudentSummary[]>([])
const strategyOptions = ref<StrategySummary[]>([])
const versionOptions = ref<StrategyVersionSummary[]>([])

const form = reactive({
  studentId: '',
  strategyId: '',
  strategyVersion: 0,
  jobCode: 'SUPERMARKET_SHELVER'
})

let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function fetchStudents(): Promise<void> {
  if (!auth.userId || !auth.role) return
  if (!searchQuery.value) {
    studentOptions.value = []
    return
  }
  try {
    const res = await window.api.student.list({
      callerUserId: auth.userId,
      callerRole: auth.role,
      search: searchQuery.value,
      includeArchived: false,
      page: 1
    })
    if (!res.success) {
      studentOptions.value = []
      return
    }
    studentOptions.value = res.items
  } catch {
    studentOptions.value = []
  }
}

async function fetchStrategies(): Promise<void> {
  if (!auth.userId || !auth.role) return
  try {
    const res = await window.api.strategy.list({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyType: assessmentType.value,
      jobCode: form.jobCode,
      includeInactive: false,
      page: 1
    })
    if (!res.success) {
      strategyOptions.value = []
      return
    }
    strategyOptions.value = res.items
  } catch {
    strategyOptions.value = []
  }
}

async function onStrategyChange(): Promise<void> {
  form.strategyVersion = 0
  versionOptions.value = []
  if (!form.strategyId || !auth.userId || !auth.role) return
  try {
    const res = await window.api.strategy.listVersions({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyId: form.strategyId
    })
    if (!res.success) {
      versionOptions.value = []
      return
    }
    versionOptions.value = res.items
  } catch {
    versionOptions.value = []
  }
}

function formatType(t: StrategyType): string {
  return t === 'BASELINE_ASSESSMENT'
    ? '能力测评'
    : t === 'MOCK_EXAM'
      ? '模拟考试'
      : t === 'TRAINING_PRACTICE'
        ? '训练'
        : t === 'JOB_SKILL_ASSESSMENT'
          ? '专业岗位测评'
          : '未知'
}

function mapError(code: string): string {
  return store.mapError(code)
}

async function submit(): Promise<void> {
  errorMsg.value = ''
  createdSessionId.value = ''
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  if (!form.studentId) {
    errorMsg.value = '请选择学生'
    return
  }
  if (!form.strategyId || form.strategyVersion <= 0) {
    errorMsg.value = '请选择策略和版本'
    return
  }

  submitting.value = true
  const result = await store.createSession({
    callerUserId: auth.userId,
    callerRole: auth.role,
    studentId: form.studentId,
    strategyId: form.strategyId,
    strategyVersion: form.strategyVersion,
    taskCode: computedTaskCode.value
  })
  submitting.value = false

  if (!result.success) {
    errorMsg.value = mapError(result.errorCode)
    return
  }
  createdSessionId.value = result.sessionId
}

// 测评类型切换：重置策略选择并重新拉取策略列表
watch(assessmentType, () => {
  form.strategyId = ''
  form.strategyVersion = 0
  strategyOptions.value = []
  versionOptions.value = []
  void fetchStrategies()
})

// 学生搜索防抖 300ms
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    searchQuery.value = val.trim()
    void fetchStudents()
  }, 300)
})

onMounted(() => {
  void fetchStrategies()
})
</script>

<style scoped>
.assessment-create {
  background: #fff;
  border-radius: 8px;
  padding: 24px 32px 32px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  max-width: 820px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}
.back-link {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}
.back-link:hover {
  text-decoration: underline;
}
.block {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px 20px 8px;
  margin-bottom: 20px;
}
.block legend {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  padding: 0 8px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.field span {
  font-size: 13px;
  color: #555;
}
.required {
  color: #dc2626;
}
.field input,
.field select {
  padding: 8px 12px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.field input:focus,
.field select:focus {
  border-color: #3b82f6;
}
.field input[readonly] {
  background: #f9fafb;
  color: #6b7280;
}
.hint {
  font-size: 12px;
  color: #6b7280;
  margin: 4px 0 12px;
}
.form-actions {
  margin-top: 24px;
}
.btn-primary {
  padding: 10px 24px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #fef2f2;
  border-radius: 6px;
}
.success-box {
  margin-top: 16px;
  padding: 12px 16px;
  background: #dcfce7;
  border: 1px solid #86efac;
  border-radius: 6px;
  font-size: 14px;
  color: #166534;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.success-box code {
  background: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
}
.link {
  color: #2563eb;
  text-decoration: none;
  font-size: 13px;
}
.link:hover {
  text-decoration: underline;
}
.type-radio-group {
  display: flex;
  gap: 24px;
  padding: 4px 0 12px;
}
.type-radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
}
</style>
