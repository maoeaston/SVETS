<template>
  <div class="student-form">
    <header class="header">
      <h2 class="title">{{ isEdit ? '编辑学生档案' : '新建学生档案' }}</h2>
      <RouterLink to="/teacher/students" class="back-link">← 返回列表</RouterLink>
    </header>

    <p v-if="loadError" class="error-msg" role="alert">{{ loadError }}</p>
    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <form v-if="!loadError" @submit.prevent="submit">
      <fieldset v-if="!isEdit" class="block">
        <legend>登录账号</legend>
        <div class="grid">
          <label class="field">
            <span>用户名 <span class="required">*</span></span>
            <input v-model="form.username" type="text" required maxlength="32" />
          </label>
          <label class="field">
            <span>初始密码 <span class="required">*</span></span>
            <input v-model="form.password" type="password" required minlength="6" />
          </label>
          <label class="field">
            <span>确认密码 <span class="required">*</span></span>
            <input v-model="form.confirmPassword" type="password" required minlength="6" />
          </label>
        </div>
        <p v-if="isEdit" class="hint">编辑模式下用户名 / 密码不可修改</p>
      </fieldset>

      <fieldset class="block">
        <legend>基本信息</legend>
        <div class="grid">
          <label class="field">
            <span>姓名 <span class="required">*</span></span>
            <input v-model="form.studentName" type="text" required maxlength="50" />
          </label>
          <label class="field">
            <span>性别</span>
            <select v-model="form.gender">
              <option value="">未选择</option>
              <option value="MALE">男</option>
              <option value="FEMALE">女</option>
              <option value="OTHER">其他</option>
              <option value="UNKNOWN">未知</option>
            </select>
          </label>
          <label class="field">
            <span>出生日期</span>
            <input v-model="form.birthDate" type="date" />
          </label>
          <label class="field">
            <span>监护人联系方式</span>
            <input v-model="form.guardianContact" type="text" maxlength="32" />
          </label>
        </div>
      </fieldset>

      <fieldset class="block">
        <legend>感官画像（可选）</legend>
        <div class="grid grid-4">
          <label class="field">
            <span>噪音敏感度</span>
            <select v-model="form.sp.noise">
              <option value="">未评估</option>
              <option value="LOW">低</option>
              <option value="MEDIUM">中</option>
              <option value="HIGH">高</option>
            </select>
          </label>
          <label class="field">
            <span>光线敏感度</span>
            <select v-model="form.sp.light">
              <option value="">未评估</option>
              <option value="LOW">低</option>
              <option value="MEDIUM">中</option>
              <option value="HIGH">高</option>
            </select>
          </label>
          <label class="field">
            <span>触觉敏感度</span>
            <select v-model="form.sp.tactile">
              <option value="">未评估</option>
              <option value="LOW">低</option>
              <option value="MEDIUM">中</option>
              <option value="HIGH">高</option>
            </select>
          </label>
          <label class="field">
            <span>人群密度敏感度</span>
            <select v-model="form.sp.crowd">
              <option value="">未评估</option>
              <option value="LOW">低</option>
              <option value="MEDIUM">中</option>
              <option value="HIGH">高</option>
            </select>
          </label>
        </div>
        <label class="field field-full">
          <span>回避标签（逗号分隔，如：NOISY_SUPERMARKET, BRIGHT_LIGHT）</span>
          <input v-model="form.sp.avoidTagsInput" type="text" placeholder="NOISY_SUPERMARKET, BRIGHT_LIGHT" />
        </label>
        <label class="field field-full">
          <span>备注</span>
          <textarea v-model="form.sp.notes" rows="3" maxlength="500" />
        </label>
      </fieldset>

      <div class="form-actions">
        <button type="submit" class="btn-primary" :disabled="submitting">
          {{ submitting ? '保存中…' : isEdit ? '保存修改' : '创建档案' }}
        </button>
        <button
          v-if="isEdit"
          type="button"
          class="btn-danger"
          :disabled="submitting"
          @click="handleArchive"
        >归档学生</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type {
  StudentGender,
  CreateStudentParams,
  UpdateStudentParams
} from '@shared/types/student'

type Sensitivity = '' | 'LOW' | 'MEDIUM' | 'HIGH'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const isEdit = computed(() => !!route.params.id)
const submitting = ref(false)
const errorMsg = ref('')
const loadError = ref('')

// reactive proxy 不能直接经 IPC 序列化——提交时必须展开为普通对象
const form = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  studentName: '',
  gender: '' as '' | StudentGender,
  birthDate: '',
  guardianContact: '',
  sp: {
    noise: '' as Sensitivity,
    light: '' as Sensitivity,
    tactile: '' as Sensitivity,
    crowd: '' as Sensitivity,
    avoidTagsInput: '',
    notes: ''
  }
})

function parseAvoidTags(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function buildSensoryPayload():
  | Record<string, unknown>
  | null {
  const { noise, light, tactile, crowd, avoidTagsInput, notes } = form.sp
  const avoidTags = parseAvoidTags(avoidTagsInput)
  // 全空 → null（不发 {}）
  if (!noise && !light && !tactile && !crowd && avoidTags.length === 0 && !notes) {
    return null
  }
  return {
    noise_sensitivity: noise || null,
    light_sensitivity: light || null,
    tactile_sensitivity: tactile || null,
    crowd_density_sensitivity: crowd || null,
    avoid_tags: avoidTags,
    notes: notes || undefined
  }
}

function mapError(code: string): string {
  return (
    {
      USERNAME_TAKEN: '用户名已被占用',
      VALIDATION_ERROR: '请检查必填字段或日期',
      INVALID_SENSORY_PROFILE: '感官画像数据非法',
      ARCHIVED: '已归档档案不可编辑',
      FORBIDDEN: '无权限',
      NOT_FOUND: '档案不存在',
      SYSTEM_ERROR: '系统异常，请重试'
    } as Record<string, string>
  )[code] ?? '操作失败'
}

async function loadForEdit(studentId: string): Promise<void> {
  if (!auth.userId || !auth.role) {
    loadError.value = '未登录'
    return
  }
  try {
    const res = await window.api.student.get({
      callerUserId: auth.userId,
      callerRole: auth.role,
      studentId
    })
    if (!res.success) {
      loadError.value = mapError(res.errorCode)
      return
    }
    const s = res.student
    form.studentName = s.studentName
    form.gender = (s.gender ?? '') as '' | StudentGender
    form.birthDate = s.birthDate ?? ''
    form.guardianContact = s.guardianContact ?? ''
    if (s.sensoryProfile) {
      form.sp.noise = (s.sensoryProfile.noise_sensitivity ?? '') as Sensitivity
      form.sp.light = (s.sensoryProfile.light_sensitivity ?? '') as Sensitivity
      form.sp.tactile = (s.sensoryProfile.tactile_sensitivity ?? '') as Sensitivity
      form.sp.crowd = (s.sensoryProfile.crowd_density_sensitivity ?? '') as Sensitivity
      form.sp.avoidTagsInput = (s.sensoryProfile.avoid_tags ?? []).join(', ')
      form.sp.notes = s.sensoryProfile.notes ?? ''
    }
  } catch {
    loadError.value = '加载失败'
  }
}

async function submit(): Promise<void> {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  errorMsg.value = ''

  // 新建模式校验两次密码一致
  if (!isEdit.value && form.password !== form.confirmPassword) {
    errorMsg.value = '两次密码不一致'
    return
  }

  const sensoryPayload = buildSensoryPayload()
  // 构造普通对象（reactive proxy 经 IPC 序列化会失败 / 丢字段）
  const base = {
    studentName: form.studentName,
    gender: form.gender || undefined,
    birthDate: form.birthDate || undefined,
    guardianContact: form.guardianContact || undefined,
    sensoryProfile: sensoryPayload
  }

  submitting.value = true
  try {
    if (isEdit.value) {
      const studentId = route.params.id as string
      const params: UpdateStudentParams = {
        callerUserId: auth.userId,
        callerRole: auth.role,
        studentId,
        patch: { ...base }
      }
      const res = await window.api.student.update(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return
      }
    } else {
      const params: CreateStudentParams = {
        callerUserId: auth.userId,
        callerRole: auth.role,
        username: form.username,
        password: form.password,
        ...base
      }
      const res = await window.api.student.create(params)
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return
      }
    }
    await router.push('/teacher/students')
  } catch {
    errorMsg.value = '系统异常'
  } finally {
    submitting.value = false
  }
}

async function handleArchive(): Promise<void> {
  if (!isEdit.value) return
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  const studentId = route.params.id as string
  // MVP 用原生 confirm；后续可替换为 modal 组件
  if (!window.confirm(`确认归档学生「${form.studentName}」？归档后该学生将无法登录。`)) {
    return
  }
  submitting.value = true
  try {
    const res = await window.api.student.archive({
      callerUserId: auth.userId,
      callerRole: auth.role,
      studentId
    })
    if (!res.success) {
      errorMsg.value = mapError(res.errorCode)
      return
    }
    await router.push('/teacher/students')
  } catch {
    errorMsg.value = '系统异常'
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (isEdit.value) {
    void loadForEdit(route.params.id as string)
  }
})
</script>

<style scoped>
.student-form {
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
.grid-4 {
  grid-template-columns: repeat(4, 1fr);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.field-full {
  width: 100%;
}
.field span {
  font-size: 13px;
  color: #555;
}
.required {
  color: #dc2626;
}
.field input,
.field select,
.field textarea {
  padding: 8px 12px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: #3b82f6;
}
.field textarea {
  resize: vertical;
}
.hint {
  font-size: 12px;
  color: #6b7280;
  margin: 4px 0 12px;
}
.form-actions {
  display: flex;
  gap: 12px;
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
.btn-danger {
  padding: 10px 24px;
  background: #fff;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
.btn-danger:hover:not(:disabled) {
  background: #fef2f2;
}
.btn-danger:disabled {
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
</style>
