<template>
  <div class="training-create-view">
    <div class="view-header">
      <button @click="$router.back()">← 返回</button>
      <h2>新建训练</h2>
    </div>

    <form class="create-form" @submit.prevent="submit">
      <div class="form-group">
        <label>学生</label>
        <select v-model="form.studentId" required>
          <option value="">请选择学生</option>
          <option v-for="s in students" :key="s.studentId" :value="s.studentId">
            {{ s.studentName }} ({{ s.studentId.slice(0, 8) }})
          </option>
        </select>
      </div>

      <div class="form-group">
        <label>训练模块</label>
        <select v-model="form.moduleType" required>
          <option value="">请选择模块</option>
          <option value="FINE_MOTOR">精细动作 (FINE_MOTOR)</option>
          <option value="COGNITION">认知能力 (COGNITION)</option>
          <option value="RULE_EXECUTION">规则执行 (RULE_EXECUTION)</option>
          <option value="EMOTION_REGULATION">情绪调节 (EMOTION_REGULATION)</option>
          <option value="BASIC_SOCIAL">基本社交 (BASIC_SOCIAL)</option>
          <option value="SAFETY_OPERATION">安全操作 (SAFETY_OPERATION)</option>
        </select>
      </div>

      <div class="form-group">
        <label>策略</label>
        <select v-model="selectedStrategyKey" required>
          <option value="">请选择策略</option>
          <option
            v-for="s in trainingStrategies"
            :key="`${s.strategyId}:${s.version}`"
            :value="`${s.strategyId}:${s.version}`"
          >
            {{ s.strategyName }} v{{ s.version }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label>任务代码</label>
        <input v-model="form.taskCode" placeholder="例：SHELVE_TASK" required />
      </div>

      <div v-if="errorMsg" class="error">{{ errorMsg }}</div>

      <div class="form-actions">
        <button type="submit" class="btn-primary" :disabled="submitting">
          {{ submitting ? '创建中…' : '创建训练' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

interface StudentItem { studentId: string; studentName: string }
interface StrategyItem { strategyId: string; version: number; strategyName: string }

const students = ref<StudentItem[]>([])
const trainingStrategies = ref<StrategyItem[]>([])
const submitting = ref(false)
const errorMsg = ref('')
const selectedStrategyKey = ref('')

const form = ref({
  studentId: '',
  moduleType: '',
  taskCode: 'SHELVE_TASK'
})

const selectedStrategy = computed(() => {
  if (!selectedStrategyKey.value) return null
  const [id, ver] = selectedStrategyKey.value.split(':')
  return trainingStrategies.value.find(s => s.strategyId === id && String(s.version) === ver) ?? null
})

async function loadStudents() {
  const result = await window.api.student.list({
    callerUserId: authStore.userId!,
    callerRole: authStore.role!,
    limit: 200,
    offset: 0
  })
  if (result.success) students.value = result.students as StudentItem[]
}

async function loadStrategies() {
  const result = await window.api.strategy.list({
    callerUserId: authStore.userId!,
    callerRole: authStore.role!,
    strategyType: 'TRAINING_PRACTICE' as never,
    limit: 50,
    offset: 0
  })
  if (result.success) trainingStrategies.value = result.strategies as StrategyItem[]
}

async function submit() {
  if (!selectedStrategy.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    const result = await window.api.training.createSession({
      callerUserId: authStore.userId!,
      callerRole: authStore.role!,
      studentId: form.value.studentId,
      strategyId: selectedStrategy.value.strategyId,
      strategyVersion: selectedStrategy.value.version,
      moduleType: form.value.moduleType as never,
      taskCode: form.value.taskCode
    })
    if (result.success) {
      router.push('/teacher/trainings')
    } else {
      const msgs: Record<string, string> = {
        DUPLICATE_TRAINING_SESSION: '该学生此任务已有开放的训练会话',
        BLOCKED_BY_SAFETY_INCIDENT: '该学生存在未解决的安全事件，无法创建训练',
        FORBIDDEN: '权限不足',
        NOT_FOUND: '学生或策略不存在',
        VALIDATION_ERROR: '参数校验失败'
      }
      errorMsg.value = msgs[result.errorCode] ?? result.errorCode
    }
  } catch (e) {
    console.error('[TrainingCreateView] submit failed:', e)
    errorMsg.value = String(e)
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadStudents()
  loadStrategies()
})
</script>

<style scoped>
.training-create-view { padding: 20px; max-width: 500px; }
.view-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.create-form { display: flex; flex-direction: column; gap: 16px; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-weight: 600; font-size: 14px; }
.form-group input, .form-group select { padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
.form-actions { display: flex; justify-content: flex-end; }
.btn-primary { background: #1a6fb5; color: #fff; border: none; padding: 10px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; }
.btn-primary:disabled { background: #aaa; cursor: not-allowed; }
.error { color: red; font-size: 13px; padding: 8px; background: #fff0f0; border-radius: 4px; }
</style>
