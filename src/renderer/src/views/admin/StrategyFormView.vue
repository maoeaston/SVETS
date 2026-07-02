<template>
  <div class="strategy-form">
    <header class="header">
      <div class="title-group">
        <RouterLink :to="backHref" class="back-link">← 返回</RouterLink>
        <h2 class="title">{{ modeTitle }}</h2>
      </div>
    </header>

    <p v-if="loadError" class="error-msg" role="alert">{{ loadError }}</p>
    <p v-if="missingLevelRules" class="warn-msg" role="alert">
      该版本 scoring_policy_json 缺 level_rules（历史 seed 遗留），保存前请补全下方「评分等级规则」。
    </p>
    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <form v-if="!loadError" @submit.prevent="submit">
      <fieldset class="block">
        <legend>基础</legend>
        <div class="grid">
          <label class="field">
            <span>策略 ID <span class="required">*</span></span>
            <input
              v-model="form.strategyId"
              type="text"
              required
              maxlength="64"
              :readonly="!isCreate"
              placeholder="如 baseline-assessment-v1"
            />
            <small v-if="!isCreate" class="hint">新建族后不可改</small>
          </label>
          <label class="field">
            <span>策略类型 <span class="required">*</span></span>
            <select v-model="form.strategyType" :disabled="!isCreate">
              <option value="BASELINE_ASSESSMENT">能力测评</option>
              <option value="MOCK_EXAM">模拟考试</option>
              <option value="TRAINING_PRACTICE">训练</option>
            </select>
          </label>
          <label class="field">
            <span>岗位代码 <span class="required">*</span></span>
            <input
              v-model="form.jobCode"
              type="text"
              required
              maxlength="64"
              :readonly="!isCreate"
              placeholder="如 SUPERMARKET_SHELVER"
            />
          </label>
          <label class="field">
            <span>策略名 <span class="required">*</span></span>
            <input v-model="form.strategyName" type="text" required maxlength="100" />
          </label>
          <label class="field">
            <span>版本</span>
            <input :value="`v${form.version}`" type="text" readonly />
            <small class="hint">{{ versionHint }}</small>
          </label>
          <label class="field field-toggle">
            <span>启用状态</span>
            <label class="toggle">
              <input v-model="form.isActive" type="checkbox" />
              <span>{{ form.isActive ? '启用' : '停用' }}</span>
            </label>
          </label>
        </div>
      </fieldset>

      <fieldset class="block">
        <legend>题量与满分</legend>
        <div class="grid grid-3">
          <label class="field">
            <span>线上题量 <span class="required">*</span></span>
            <input v-model.number="form.onlineQuestionCount" type="number" min="0" required />
          </label>
          <label class="field">
            <span>线下题量 <span class="required">*</span></span>
            <input v-model.number="form.offlineQuestionCount" type="number" min="0" required />
          </label>
          <label class="field">
            <span>满分 <span class="required">*</span></span>
            <input v-model.number="form.maxScore" type="number" min="1" required />
          </label>
        </div>
      </fieldset>

      <fieldset class="block">
        <legend>阈值</legend>
        <div class="grid grid-4">
          <label class="field">
            <span>达标阈值 <span class="required">*</span></span>
            <input v-model.number="form.competentThreshold" type="number" min="0" required />
          </label>
          <label class="field">
            <span>条件通过阈值 <span class="required">*</span></span>
            <input v-model.number="form.conditionalThreshold" type="number" min="0" required />
          </label>
          <label class="field">
            <span>模块否决阈值</span>
            <input v-model.number="form.moduleVetoThreshold" type="number" min="0" max="1" step="0.1" />
          </label>
          <label class="field">
            <span>情绪崩溃阈值</span>
            <input v-model.number="form.emotionCollapseThreshold" type="number" min="0" step="1" />
          </label>
        </div>
        <p class="hint">
          修改「达标/条件通过阈值」会自动同步下方评分等级规则中对应等级首条的 min；
          后端会再次校验，不同步会被 <code>INVALID_SCORING_POLICY</code> 拒绝。
        </p>
      </fieldset>

      <fieldset class="block">
        <legend>题量策略（question_policy_json）</legend>
        <div class="grid">
          <label class="field">
            <span>模块范围</span>
            <select v-model="form.questionPolicy.module_scope">
              <option value="CROSS_MODULE">跨模块（CROSS_MODULE）</option>
              <option value="SINGLE_MODULE">单模块（SINGLE_MODULE）</option>
            </select>
          </label>
        </div>
        <div class="ratio-group">
          <span class="ratio-label">题型数量配比（之和应 = 线上+线下 = {{ totalRatioTarget }}）<span class="required">*</span></span>
          <div class="grid grid-4">
            <label class="field">
              <span>判断题</span>
              <input v-model.number="form.questionPolicy.question_ratio.TRUE_FALSE" type="number" min="0" />
            </label>
            <label class="field">
              <span>单选题</span>
              <input v-model.number="form.questionPolicy.question_ratio.SINGLE_CHOICE" type="number" min="0" />
            </label>
            <label class="field">
              <span>拖拽题</span>
              <input v-model.number="form.questionPolicy.question_ratio.DRAG" type="number" min="0" />
            </label>
            <label class="field">
              <span>线下操作题</span>
              <input v-model.number="form.questionPolicy.question_ratio.OFFLINE_OPERATION" type="number" min="0" />
            </label>
          </div>
          <small :class="ratioSumOk ? 'hint' : 'hint hint-warn'">
            当前合计 {{ ratioSum }} / 目标 {{ totalRatioTarget }}
          </small>
        </div>
        <div class="field">
          <span>必含模块（多选）</span>
          <div class="checkbox-row">
            <label v-for="tag in ABILITY_TAGS" :key="tag" class="checkbox">
              <input
                :checked="form.questionPolicy.required_modules.includes(tag)"
                type="checkbox"
                @change="toggleRequiredModule(tag)"
              />
              <span>{{ tag }}</span>
            </label>
          </div>
        </div>
        <label class="field field-full">
          <span>难度分布（可选，原始 JSON；留空则省略该键）</span>
          <textarea
            v-model="form.questionPolicy.difficulty_distribution_input"
            rows="2"
            placeholder='{"EASY":0.5,"MEDIUM":0.3,"HARD":0.2}'
          />
        </label>
      </fieldset>

      <fieldset class="block">
        <legend>评分策略（scoring_policy_json）</legend>
        <div class="grid grid-3">
          <div class="field">
            <span>评分值</span>
            <input value="0 / 1 / 2（固定）" type="text" readonly />
          </div>
          <div class="field">
            <span>归一化公式</span>
            <input value="raw_score/max_score*100" type="text" readonly />
          </div>
          <div class="field field-toggle">
            <span>安全覆盖</span>
            <label class="toggle">
              <input v-model="form.scoringPolicy.safety_override_enabled" type="checkbox" />
              <span>{{ form.scoringPolicy.safety_override_enabled ? '启用' : '关闭' }}</span>
            </label>
          </div>
        </div>
        <div class="level-rules">
          <div class="level-rules-header">
            <span class="ratio-label">评分等级规则（level_rules）<span class="required">*</span></span>
            <button type="button" class="btn-small" @click="addLevelRule">添加等级</button>
          </div>
          <div v-for="(rule, idx) in form.scoringPolicy.level_rules" :key="idx" class="level-rule-row">
            <label class="field">
              <span>min</span>
              <input v-model.number="rule.min" type="number" min="0" :max="form.maxScore" />
            </label>
            <label class="field">
              <span>max</span>
              <input v-model.number="rule.max" type="number" min="0" :max="form.maxScore" />
            </label>
            <label class="field">
              <span>等级</span>
              <select v-model="rule.level">
                <option value="LEVEL_COMPETENT">达标</option>
                <option value="LEVEL_CONDITIONAL">条件通过</option>
                <option value="LEVEL_NOT_COMPETENT">未达标</option>
              </select>
            </label>
            <button type="button" class="btn-small btn-danger-small" @click="removeLevelRule(idx)">删除</button>
          </div>
        </div>
      </fieldset>

      <fieldset class="block">
        <legend>行为开关</legend>
        <div class="grid grid-3">
          <div class="field field-toggle">
            <span>支持红线中止</span>
            <label class="toggle">
              <input v-model="form.supportsRedlineHalt" type="checkbox" />
              <span>{{ form.supportsRedlineHalt ? '是' : '否' }}</span>
            </label>
          </div>
          <div class="field field-toggle">
            <span>允许情绪中断</span>
            <label class="toggle">
              <input v-model="form.allowsEmotionInterrupt" type="checkbox" />
              <span>{{ form.allowsEmotionInterrupt ? '是' : '否' }}</span>
            </label>
          </div>
          <div class="field field-toggle">
            <span>需线下评分</span>
            <label class="toggle">
              <input v-model="form.requiresOfflineScoring" type="checkbox" />
              <span>{{ form.requiresOfflineScoring ? '是' : '否' }}</span>
            </label>
          </div>
        </div>
      </fieldset>

      <div class="form-actions">
        <button type="submit" class="btn-primary" :disabled="submitting">
          {{ submitting ? '保存中…' : submitLabel }}
        </button>
        <RouterLink :to="backHref" class="btn-cancel">取消</RouterLink>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import type {
  StrategyType,
  StrategyInput,
  StrategyDetail,
  UpdateStrategyParams
} from '@shared/types/strategy'
import type { QuestionPolicyJson, ScoringPolicyJson, AbilityTag, LevelRule } from '@shared/types/json-schemas'

type FormMode = 'create' | 'newVersion' | 'edit'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const ABILITY_TAGS: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

// --- 模式判定（按 route 形状）---
// /admin/strategies/new                  → create
// /admin/strategies/:strategyId/new-version → newVersion
// /admin/strategies/:strategyId/v/:version  → edit
const strategyIdParam = computed(() => {
  const v = route.params.strategyId
  return typeof v === 'string' ? v : ''
})
const versionParam = computed(() => {
  const v = route.params.version
  return typeof v === 'string' ? Number(v) : NaN
})
const mode = computed<FormMode>(() => {
  if (!strategyIdParam.value) return 'create'
  if (route.path.endsWith('/new-version')) return 'newVersion'
  return 'edit'
})
const isCreate = computed(() => mode.value === 'create')

const modeTitle = computed(() => {
  if (mode.value === 'create') return '新建策略族（v1）'
  if (mode.value === 'newVersion') return `策略 ${strategyIdParam.value} · 新增版本`
  return `策略 ${strategyIdParam.value} · v${versionParam.value} 编辑`
})
const submitLabel = computed(() => {
  if (mode.value === 'edit') return '保存修改'
  return '创建策略'
})
const versionHint = computed(() => {
  if (mode.value === 'create') return '新建族固定 v1'
  if (mode.value === 'newVersion') return '自动取最新版本 +1'
  return '编辑模式下不可改'
})
const backHref = computed(() => {
  if (mode.value === 'create') return '/admin/strategies'
  return `/admin/strategies/${strategyIdParam.value}`
})

// --- 表单状态 ---
const submitting = ref(false)
const errorMsg = ref('')
const loadError = ref('')
const missingLevelRules = ref(false)
// edit 模式 dirty 追踪：handler 把任一白名单字段存在视为变更（不深比较），
// 对 referenced 版本会触发 REFERENCED_IMMUTABLE；故只发送真正改了的字段。
const initialSnapshot = ref<StrategyDetail | null>(null)

interface StrategyFormState {
  strategyId: string
  strategyType: StrategyType
  jobCode: string
  strategyName: string
  version: number
  isActive: boolean
  onlineQuestionCount: number
  offlineQuestionCount: number
  maxScore: number
  competentThreshold: number
  conditionalThreshold: number
  moduleVetoThreshold: number
  emotionCollapseThreshold: number
  supportsRedlineHalt: boolean
  allowsEmotionInterrupt: boolean
  requiresOfflineScoring: boolean
  questionPolicy: {
    module_scope: 'SINGLE_MODULE' | 'CROSS_MODULE'
    question_ratio: { TRUE_FALSE: number; SINGLE_CHOICE: number; DRAG: number; OFFLINE_OPERATION: number }
    required_modules: AbilityTag[]
    difficulty_distribution_input: string
  }
  scoringPolicy: {
    safety_override_enabled: boolean
    level_rules: LevelRule[]
  }
}

function defaultForm(): StrategyFormState {
  return {
    strategyId: '',
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: '',
    strategyName: '',
    version: 1,
    isActive: true,
    onlineQuestionCount: 42,
    offlineQuestionCount: 8,
    maxScore: 100,
    competentThreshold: 80,
    conditionalThreshold: 60,
    moduleVetoThreshold: 0.5,
    emotionCollapseThreshold: 3,
    supportsRedlineHalt: true,
    allowsEmotionInterrupt: true,
    requiresOfflineScoring: true,
    questionPolicy: {
      module_scope: 'CROSS_MODULE',
      question_ratio: { TRUE_FALSE: 14, SINGLE_CHOICE: 14, DRAG: 14, OFFLINE_OPERATION: 8 },
      required_modules: [],
      difficulty_distribution_input: ''
    },
    scoringPolicy: {
      safety_override_enabled: true,
      level_rules: [
        { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
        { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
        { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
      ]
    }
  }
}

const form = reactive<StrategyFormState>(defaultForm())

const totalRatioTarget = computed(() => form.onlineQuestionCount + form.offlineQuestionCount)
const ratioSum = computed(() => {
  const r = form.questionPolicy.question_ratio
  return (r.TRUE_FALSE || 0) + (r.SINGLE_CHOICE || 0) + (r.DRAG || 0) + (r.OFFLINE_OPERATION || 0)
})
const ratioSumOk = computed(() => ratioSum.value === totalRatioTarget.value)

function toggleRequiredModule(tag: AbilityTag): void {
  const arr = form.questionPolicy.required_modules
  const idx = arr.indexOf(tag)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(tag)
}

function addLevelRule(): void {
  form.scoringPolicy.level_rules.push({ min: 0, max: 0, level: 'LEVEL_NOT_COMPETENT' })
}

function removeLevelRule(idx: number): void {
  form.scoringPolicy.level_rules.splice(idx, 1)
}

// --- level_rules 自动同步（v0.1.8 单源）：改表列阈值 → 同步对应等级首条 min ---
// 减少用户手动同步出错；后端 validateScoringPolicy 是兜底。
watch(
  () => form.competentThreshold,
  (val) => {
    const idx = form.scoringPolicy.level_rules.findIndex((r) => r.level === 'LEVEL_COMPETENT')
    if (idx >= 0) form.scoringPolicy.level_rules[idx].min = val
  }
)
watch(
  () => form.conditionalThreshold,
  (val) => {
    const idx = form.scoringPolicy.level_rules.findIndex((r) => r.level === 'LEVEL_CONDITIONAL')
    if (idx >= 0) form.scoringPolicy.level_rules[idx].min = val
  }
)

// --- 加载（newVersion / edit 模式）---
function applyDetailToForm(d: StrategyDetail, versionOverride?: number): void {
  form.strategyId = d.strategyId
  form.strategyType = d.strategyType
  form.jobCode = d.jobCode
  form.strategyName = d.strategyName
  form.version = versionOverride ?? d.version
  form.isActive = d.isActive
  form.onlineQuestionCount = d.onlineQuestionCount
  form.offlineQuestionCount = d.offlineQuestionCount
  form.maxScore = d.maxScore
  form.competentThreshold = d.competentThreshold
  form.conditionalThreshold = d.conditionalThreshold
  form.moduleVetoThreshold = d.moduleVetoThreshold
  form.emotionCollapseThreshold = d.emotionCollapseThreshold
  form.supportsRedlineHalt = d.supportsRedlineHalt
  form.allowsEmotionInterrupt = d.allowsEmotionInterrupt
  form.requiresOfflineScoring = d.requiresOfflineScoring
  form.questionPolicy.module_scope = d.questionPolicy.module_scope
  form.questionPolicy.question_ratio = {
    TRUE_FALSE: d.questionPolicy.question_ratio.TRUE_FALSE ?? 0,
    SINGLE_CHOICE: d.questionPolicy.question_ratio.SINGLE_CHOICE ?? 0,
    DRAG: d.questionPolicy.question_ratio.DRAG ?? 0,
    OFFLINE_OPERATION: d.questionPolicy.question_ratio.OFFLINE_OPERATION ?? 0
  }
  form.questionPolicy.required_modules = [...(d.questionPolicy.required_modules ?? [])]
  form.questionPolicy.difficulty_distribution_input = d.questionPolicy.difficulty_distribution
    ? JSON.stringify(d.questionPolicy.difficulty_distribution)
    : ''
  form.scoringPolicy.safety_override_enabled = d.scoringPolicy.safety_override_enabled
  const rules = d.scoringPolicy.level_rules
  if (!rules || rules.length === 0) {
    missingLevelRules.value = true
    form.scoringPolicy.level_rules = [
      { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
      { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
      { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
    ]
  } else {
    missingLevelRules.value = false
    form.scoringPolicy.level_rules = rules.map((r) => ({ ...r }))
  }
}

async function loadForNewVersion(sid: string): Promise<void> {
  if (!auth.userId || !auth.role) {
    loadError.value = '未登录'
    return
  }
  try {
    const res = await window.api.strategy.listVersions({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyId: sid
    })
    if (!res.success) {
      loadError.value = mapError(res.errorCode)
      return
    }
    if (res.items.length === 0) {
      loadError.value = '策略族无版本，无法新增版本'
      return
    }
    // listVersions 返回 DESC，items[0] 是最新
    const latestSummary = res.items[0]
    // 需完整 Detail（含 JSON），再调 get
    const detailRes = await window.api.strategy.get({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyId: sid,
      version: latestSummary.version
    })
    if (!detailRes.success) {
      loadError.value = mapError(detailRes.errorCode)
      return
    }
    applyDetailToForm(detailRes.strategy, latestSummary.version + 1)
  } catch {
    loadError.value = '加载失败'
  }
}

async function loadForEdit(sid: string, version: number): Promise<void> {
  if (!auth.userId || !auth.role) {
    loadError.value = '未登录'
    return
  }
  try {
    const res = await window.api.strategy.get({
      callerUserId: auth.userId,
      callerRole: auth.role,
      strategyId: sid,
      version
    })
    if (!res.success) {
      loadError.value = mapError(res.errorCode)
      return
    }
    applyDetailToForm(res.strategy)
    initialSnapshot.value = res.strategy
  } catch {
    loadError.value = '加载失败'
  }
}

// --- 构造提交负载 ---
function buildQuestionPolicyJson(): QuestionPolicyJson {
  const qp: QuestionPolicyJson = {
    module_scope: form.questionPolicy.module_scope,
    question_ratio: { ...form.questionPolicy.question_ratio }
  }
  // required_modules 可选——validator 要求「存在则必须非空」，故空数组时省略键
  // （否则未选模块的创建/编辑会被 INVALID_QUESTION_POLICY 拒绝，E2E 发现）
  if (form.questionPolicy.required_modules.length > 0) {
    qp.required_modules = [...form.questionPolicy.required_modules]
  }
  const raw = form.questionPolicy.difficulty_distribution_input.trim()
  if (raw) {
    qp.difficulty_distribution = JSON.parse(raw) as Record<string, number>
  }
  return qp
}

function buildScoringPolicyJson(): ScoringPolicyJson {
  return {
    score_values: [0, 1, 2],
    normalization: 'raw_score/max_score*100',
    safety_override_enabled: form.scoringPolicy.safety_override_enabled,
    level_rules: form.scoringPolicy.level_rules.map((r) => ({ ...r }))
  }
}

function buildStrategyInput(): StrategyInput {
  return {
    strategyId: form.strategyId,
    strategyType: form.strategyType,
    jobCode: form.jobCode,
    strategyName: form.strategyName,
    onlineQuestionCount: form.onlineQuestionCount,
    offlineQuestionCount: form.offlineQuestionCount,
    maxScore: form.maxScore,
    competentThreshold: form.competentThreshold,
    conditionalThreshold: form.conditionalThreshold,
    moduleVetoThreshold: form.moduleVetoThreshold,
    emotionCollapseThreshold: form.emotionCollapseThreshold,
    questionPolicy: buildQuestionPolicyJson(),
    scoringPolicy: buildScoringPolicyJson(),
    supportsRedlineHalt: form.supportsRedlineHalt,
    allowsEmotionInterrupt: form.allowsEmotionInterrupt,
    requiresOfflineScoring: form.requiresOfflineScoring,
    version: form.version,
    isActive: form.isActive
  }
}

// edit 模式：只发送与 initial 快照真正不同的白名单字段（handler 把任一存在视为变更）。
function buildPatch(): UpdateStrategyParams['patch'] {
  const patch: UpdateStrategyParams['patch'] = {}
  const init = initialSnapshot.value
  if (!init) return patch

  if (form.strategyName !== init.strategyName) patch.strategyName = form.strategyName
  if (form.onlineQuestionCount !== init.onlineQuestionCount) patch.onlineQuestionCount = form.onlineQuestionCount
  if (form.offlineQuestionCount !== init.offlineQuestionCount) patch.offlineQuestionCount = form.offlineQuestionCount
  if (form.maxScore !== init.maxScore) patch.maxScore = form.maxScore
  if (form.competentThreshold !== init.competentThreshold) patch.competentThreshold = form.competentThreshold
  if (form.conditionalThreshold !== init.conditionalThreshold) patch.conditionalThreshold = form.conditionalThreshold
  if (form.moduleVetoThreshold !== init.moduleVetoThreshold) patch.moduleVetoThreshold = form.moduleVetoThreshold
  if (form.emotionCollapseThreshold !== init.emotionCollapseThreshold) patch.emotionCollapseThreshold = form.emotionCollapseThreshold
  if (form.supportsRedlineHalt !== init.supportsRedlineHalt) patch.supportsRedlineHalt = form.supportsRedlineHalt
  if (form.allowsEmotionInterrupt !== init.allowsEmotionInterrupt) patch.allowsEmotionInterrupt = form.allowsEmotionInterrupt
  if (form.requiresOfflineScoring !== init.requiresOfflineScoring) patch.requiresOfflineScoring = form.requiresOfflineScoring

  const newQp = buildQuestionPolicyJson()
  if (JSON.stringify(newQp) !== JSON.stringify(init.questionPolicy)) {
    patch.questionPolicy = newQp
  }
  const newSp = buildScoringPolicyJson()
  if (JSON.stringify(newSp) !== JSON.stringify(init.scoringPolicy)) {
    patch.scoringPolicy = newSp
  }
  return patch
}

function mapError(code: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: '无权限',
    DUPLICATE_STRATEGY_ID: '策略 ID 已被占用',
    DUPLICATE_JOB_STRATEGY: '该岗位 + 类型下已有策略族',
    DUPLICATE_VERSION: '版本号已存在',
    STRATEGY_TYPE_MISMATCH: '策略类型与族不一致',
    JOB_CODE_MISMATCH: '岗位代码与族不一致',
    QUESTION_RATIO_MISMATCH: '题型数量之和不等于 online + offline',
    INVALID_QUESTION_POLICY: '题量策略 JSON 结构错误（详见控制台）',
    INVALID_SCORING_POLICY: '评分策略 JSON 结构错误（详见控制台；常见：阈值未同步 level_rules）',
    REFERENCED_IMMUTABLE: '该版本已被测评/训练引用，不可修改语义字段',
    NOT_FOUND: '策略或版本不存在',
    VALIDATION_ERROR: '字段校验失败',
    SYSTEM_ERROR: '系统异常，请重试'
  }
  return map[code] ?? '操作失败'
}

async function submit(): Promise<void> {
  if (!auth.userId || !auth.role) {
    errorMsg.value = '未登录'
    return
  }
  errorMsg.value = ''

  if (!ratioSumOk.value) {
    errorMsg.value = `题型数量合计 ${ratioSum.value} ≠ 线上+线下 ${totalRatioTarget.value}`
    return
  }

  submitting.value = true
  try {
    if (mode.value === 'edit') {
      const patch = buildPatch()
      if (Object.keys(patch).length === 0) {
        errorMsg.value = '无字段变更'
        return
      }
      const res = await window.api.strategy.update({
        callerUserId: auth.userId,
        callerRole: auth.role,
        strategyId: strategyIdParam.value,
        version: versionParam.value,
        patch
      })
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return
      }
      await router.push(`/admin/strategies/${strategyIdParam.value}`)
    } else {
      // create / newVersion 共用 createVersion（reactive proxy 必须展开为普通对象）
      const strategy = buildStrategyInput()
      const res = await window.api.strategy.createVersion({
        callerUserId: auth.userId,
        callerRole: auth.role,
        strategy
      })
      if (!res.success) {
        errorMsg.value = mapError(res.errorCode)
        return
      }
      await router.push(`/admin/strategies/${strategy.strategyId}`)
    }
  } catch {
    errorMsg.value = '系统异常'
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (mode.value === 'newVersion') {
    void loadForNewVersion(strategyIdParam.value)
  } else if (mode.value === 'edit') {
    if (!Number.isFinite(versionParam.value)) {
      loadError.value = '路由缺少 version'
      return
    }
    void loadForEdit(strategyIdParam.value, versionParam.value)
  }
})
</script>

<style scoped>
.strategy-form {
  background: #fff;
  border-radius: 8px;
  padding: 24px 32px 32px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  max-width: 920px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;
}
.title-group {
  display: flex;
  align-items: center;
  gap: 16px;
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
.grid-3 {
  grid-template-columns: repeat(3, 1fr);
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
.field input[readonly],
.field input:read-only {
  background: #f3f4f6;
  color: #6b7280;
}
.field textarea {
  resize: vertical;
}
.field-toggle {
  justify-content: flex-end;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #374151;
  cursor: pointer;
}
.hint {
  font-size: 12px;
  color: #6b7280;
  margin: 4px 0 12px;
}
.hint code {
  background: #f3f4f6;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}
.hint-warn {
  color: #d97706;
  font-weight: 500;
}
.ratio-group {
  margin: 8px 0 12px;
}
.ratio-label {
  display: block;
  font-size: 13px;
  color: #555;
  margin-bottom: 8px;
}
.checkbox-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
}
.level-rules {
  margin-top: 12px;
}
.level-rules-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.level-rule-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.5fr auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 8px;
}
.btn-small {
  padding: 6px 12px;
  background: #fff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.btn-small:hover {
  background: #f3f4f6;
}
.btn-danger-small {
  color: #dc2626;
  border-color: #fecaca;
}
.btn-danger-small:hover {
  background: #fef2f2;
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
.btn-cancel {
  padding: 10px 20px;
  color: #6b7280;
  text-decoration: none;
  font-size: 14px;
}
.btn-cancel:hover {
  color: #374151;
}
.error-msg {
  color: #dc2626;
  font-size: 14px;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #fef2f2;
  border-radius: 6px;
}
.warn-msg {
  color: #92400e;
  font-size: 14px;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 6px;
}
</style>
