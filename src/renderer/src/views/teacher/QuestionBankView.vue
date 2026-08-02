<template>
  <div class="question-bank-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">超市理货员 · 拆箱与上架</p>
        <h1>岗位题库</h1>
      </div>
      <div class="catalog-total" aria-live="polite">
        <strong>{{ catalogTotal ?? '—' }}</strong>
        <span>道岗位题</span>
      </div>
    </header>

    <form class="filter-band" role="search" @submit.prevent="applyFilters">
      <label class="search-field">
        <span>关键词</span>
        <input v-model="draftFilters.keyword" type="search" placeholder="题号或题干">
      </label>
      <label>
        <span>模块</span>
        <select v-model="draftFilters.moduleCode">
          <option value="">全部模块</option>
          <option v-for="code in moduleCodes" :key="code" :value="code">{{ code }}</option>
        </select>
      </label>
      <label>
        <span>题型</span>
        <select v-model="draftFilters.questionType">
          <option value="">全部题型</option>
          <option v-for="(label, type) in QUESTION_TYPE_LABELS" :key="type" :value="type">{{ label }}</option>
        </select>
      </label>
      <label>
        <span>状态</span>
        <select v-model="draftFilters.status">
          <option value="">全部状态</option>
          <option v-for="(label, status) in QUESTION_STATUS_LABELS" :key="status" :value="status">{{ label }}</option>
        </select>
      </label>
      <div class="filter-actions">
        <button type="submit" class="button primary" :disabled="loading">查询</button>
        <button type="button" class="button secondary" :disabled="loading" @click="clearFilters">清空</button>
      </div>
    </form>

    <div class="result-bar">
      <span>当前结果 {{ total }} 道</span>
      <span>第 {{ page }} / {{ totalPages }} 页</span>
    </div>

    <PageState v-if="loading" kind="loading" title="正在读取题库" description="题目内容和评分依据正在同步。" />
    <PageState v-else-if="errorKind" :kind="errorKind" :title="errorKind === 'forbidden' ? '当前账号不能查看题库' : '题库没有加载成功'" description="没有修改任何题目，可以原地重试。" action-label="重新加载" @action="loadQuestions" />
    <PageState v-else-if="items.length === 0" kind="empty" title="没有符合条件的题目" description="请调整关键词或筛选条件。" action-label="清空筛选" @action="clearFilters" />

    <section v-else class="question-list" aria-label="题目列表">
      <details v-for="item in items" :key="item.questionId" class="question-item">
        <summary>
          <span class="question-id">{{ item.questionId }}</span>
          <span class="question-prompt">{{ questionPrompt(item) }}</span>
          <span class="question-meta">
            <span>{{ item.moduleCode }}</span>
            <span>{{ QUESTION_TYPE_LABELS[item.questionType] }}</span>
            <span :class="['status', `status-${item.status.toLowerCase()}`]">{{ QUESTION_STATUS_LABELS[item.status] }}</span>
          </span>
        </summary>

        <div class="question-detail">
          <p v-if="item.contentParseError || item.scoringRuleParseError" class="parse-warning" role="alert">
            该题部分结构化数据无法读取，请核对题库源文件。
          </p>
          <dl class="fact-grid">
            <div><dt>考察重点</dt><dd>{{ contentField(item, 'target_construct', 'assessment_point') }}</dd></div>
            <div><dt>呈现方式</dt><dd>{{ contentField(item, 'presentation_way') }}</dd></div>
            <div><dt>标准指令</dt><dd>{{ contentField(item, 'standard_instruction') }}</dd></div>
            <div><dt>材料与工具</dt><dd>{{ contentField(item, 'offline_tool_brief', 'materials') }}</dd></div>
            <div><dt>正确表现</dt><dd>{{ contentField(item, 'correct_response') }}</dd></div>
            <div><dt>允许支持</dt><dd>{{ contentField(item, 'allowed_support') }}</dd></div>
          </dl>

          <section v-if="interactionOptions(item).length" class="detail-section">
            <h2>作答选项</h2>
            <ol class="option-list">
              <li v-for="option in interactionOptions(item)" :key="option.key"><b>{{ option.key }}</b><span>{{ option.text }}</span></li>
            </ol>
          </section>

          <section v-if="interactionItems(item).length" class="detail-section">
            <h2>交互项目</h2>
            <ul class="plain-list">
              <li v-for="entry in interactionItems(item)" :key="entry.key">{{ entry.text }}</li>
            </ul>
          </section>

          <section v-if="rubricCriteria(item).length" class="detail-section">
            <h2>实操评分要点</h2>
            <ol class="plain-list numbered">
              <li v-for="criterion in rubricCriteria(item)" :key="criterion.key">{{ criterion.text }}</li>
            </ol>
          </section>

          <section v-if="scoringEntries(item).length" class="detail-section scoring-section">
            <h2>评分规则</h2>
            <dl>
              <div v-for="entry in scoringEntries(item)" :key="entry.key">
                <dt>{{ entry.key }}</dt><dd>{{ entry.value }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </details>
    </section>

    <nav v-if="!loading && !errorKind && totalPages > 1" class="pagination" aria-label="题库分页">
      <button type="button" class="button secondary" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
      <span>第 {{ page }} 页</span>
      <button type="button" class="button secondary" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type {
  QuestionBankCatalogItem,
  QuestionBankCatalogStatus,
  QuestionBankCatalogType
} from '@shared/types/question-bank-catalog'
import PageState from '../../components/PageState.vue'
import {
  QUESTION_STATUS_LABELS,
  QUESTION_TYPE_LABELS,
  contentField,
  interactionItems,
  interactionOptions,
  questionPrompt,
  rubricCriteria,
  scoringEntries
} from './question-bank-presentation'

type Filters = {
  keyword: string
  moduleCode: string
  questionType: '' | QuestionBankCatalogType
  status: '' | QuestionBankCatalogStatus
}

const pageSize = 24
const moduleCodes = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']
const emptyFilters = (): Filters => ({ keyword: '', moduleCode: '', questionType: '', status: '' })
const draftFilters = reactive<Filters>(emptyFilters())
const filters = ref<Filters>(emptyFilters())
const items = ref<readonly QuestionBankCatalogItem[]>([])
const loading = ref(true)
const errorKind = ref<'' | 'error' | 'forbidden'>('')
const total = ref(0)
const catalogTotal = ref<number | null>(null)
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

async function loadQuestions(): Promise<void> {
  loading.value = true
  errorKind.value = ''
  try {
    const result = await window.api.questionBank.list({
      domain: 'JOB_SPECIFIC',
      keyword: filters.value.keyword || undefined,
      moduleCode: filters.value.moduleCode || undefined,
      questionType: filters.value.questionType || undefined,
      status: filters.value.status || undefined,
      page: page.value,
      pageSize
    })
    if (!result.success) {
      errorKind.value = result.errorCode === 'FORBIDDEN' ? 'forbidden' : 'error'
      items.value = []
      total.value = 0
      return
    }
    items.value = result.items
    total.value = result.total
    if (!filters.value.keyword && !filters.value.moduleCode && !filters.value.questionType && !filters.value.status) {
      catalogTotal.value = result.total
    }
  } catch (error) {
    console.error('[QuestionBankView] load failed:', error)
    errorKind.value = 'error'
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function applyFilters(): void {
  filters.value = {
    keyword: draftFilters.keyword.trim(),
    moduleCode: draftFilters.moduleCode,
    questionType: draftFilters.questionType,
    status: draftFilters.status
  }
  page.value = 1
  void loadQuestions()
}

function clearFilters(): void {
  Object.assign(draftFilters, emptyFilters())
  filters.value = emptyFilters()
  page.value = 1
  void loadQuestions()
}

function goPage(nextPage: number): void {
  if (nextPage < 1 || nextPage > totalPages.value) return
  page.value = nextPage
  void loadQuestions()
}

onMounted(() => { void loadQuestions() })
</script>

<style scoped>
.question-bank-page { display: grid; gap: 16px; max-width: 1120px; margin: 0 auto; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.eyebrow { margin: 0 0 3px; color: var(--color-accent-dark); font-size: 12px; font-weight: 800; }
h1 { font-size: 30px; line-height: 1.2; }
.catalog-total { display: flex; align-items: baseline; gap: 7px; }
.catalog-total strong { font-size: 30px; font-variant-numeric: tabular-nums; }
.catalog-total span { color: var(--color-text-muted); font-size: 13px; }
.filter-band { display: grid; grid-template-columns: minmax(190px, 1.7fr) repeat(3, minmax(120px, 1fr)) auto; align-items: end; gap: 10px; padding: 15px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); }
.filter-band label { display: grid; min-width: 0; gap: 4px; }
.filter-band label > span { color: var(--color-text-muted); font-size: 11px; font-weight: 700; }
.filter-band input, .filter-band select { width: 100%; min-width: 0; min-height: 40px; padding: 7px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: white; color: var(--color-text); }
.filter-actions { display: flex; gap: 7px; }
.button { min-height: 40px; padding: 7px 13px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 700; cursor: pointer; }
.button:disabled { cursor: not-allowed; opacity: .5; }
.button.primary { border: 0; background: var(--color-accent); color: var(--color-accent-ink); }
.button.secondary { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); }
.result-bar { display: flex; justify-content: space-between; gap: 16px; color: var(--color-text-muted); font-size: 12px; }
.question-list { display: grid; gap: 8px; }
.question-item { overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); }
.question-item summary { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 68px; padding: 12px 16px; cursor: pointer; list-style-position: inside; }
.question-item[open] summary { border-bottom: 1px solid var(--color-border-subtle); }
.question-id { overflow-wrap: anywhere; color: var(--color-text-muted); font-size: 12px; font-weight: 800; }
.question-prompt { min-width: 0; font-size: 14px; line-height: 1.55; }
.question-meta { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.question-meta > span { padding: 3px 7px; border-radius: var(--radius-pill); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 11px; white-space: nowrap; }
.question-meta .status-active { background: var(--color-success-soft); color: var(--color-success); }
.question-meta .status-draft { background: var(--color-warning-soft); color: var(--color-warning); }
.question-detail { display: grid; gap: 18px; padding: 18px; }
.parse-warning { padding: 10px 12px; border-left: 3px solid var(--color-danger); background: var(--color-danger-soft); color: var(--color-danger); font-size: 13px; }
.fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.fact-grid div { padding: 10px 0; border-bottom: 1px solid var(--color-border-subtle); }
dt { color: var(--color-text-faint); font-size: 11px; font-weight: 800; }
dd { margin: 3px 0 0; overflow-wrap: anywhere; color: var(--color-text); font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
.detail-section { padding-top: 2px; }
.detail-section h2 { margin-bottom: 8px; font-size: 14px; }
.option-list, .plain-list { display: grid; gap: 6px; padding-left: 0; list-style: none; }
.option-list li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 8px; font-size: 13px; }
.option-list b { color: var(--color-accent-dark); }
.plain-list li { position: relative; padding-left: 17px; font-size: 13px; line-height: 1.65; }
.plain-list li::before { position: absolute; left: 2px; content: '·'; color: var(--color-accent-dark); font-weight: 900; }
.scoring-section dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px; }
.scoring-section dl div { min-width: 0; padding-bottom: 7px; border-bottom: 1px solid var(--color-border-subtle); }
.pagination { display: flex; align-items: center; justify-content: center; gap: 14px; padding-top: 4px; }
.pagination span { color: var(--color-text-muted); font-size: 12px; }
@media (hover: hover) { .question-item summary:hover { background: var(--color-surface-muted); } }
@media (max-width: 860px) {
  .filter-band { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .search-field { grid-column: 1 / -1; }
  .filter-actions { align-self: end; }
  .question-item summary { grid-template-columns: 125px minmax(0, 1fr); }
  .question-meta { grid-column: 1 / -1; justify-content: flex-start; padding-left: 0; }
}
@media (max-width: 560px) {
  .page-header { align-items: flex-start; flex-direction: column; gap: 8px; }
  .filter-band { grid-template-columns: 1fr; }
  .search-field { grid-column: auto; }
  .question-item summary { grid-template-columns: 1fr; gap: 6px; }
  .fact-grid, .scoring-section dl { grid-template-columns: 1fr; }
  .question-detail { padding: 14px; }
}
</style>
