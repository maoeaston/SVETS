<template>
  <div class="report-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">历史记录</p>
        <h1>任务报告</h1>
        <p>查看历史报告并处理待生成的报告。</p>
      </div>
      <button class="secondary-button" type="button" :disabled="store.loadingList" @click="reload">刷新</button>
    </header>

    <form class="filter-bar" @submit.prevent="reload">
      <label>
        <span>学生编号</span>
        <input v-model.trim="store.filters.studentId" autocomplete="off" placeholder="可留空" />
      </label>
      <label>
        <span>报告范围</span>
        <select v-model="store.filters.reportScope">
          <option value="">全部</option>
          <option value="BASE_ABILITY">基础能力</option>
          <option value="JOB_SKILL">岗位技能</option>
          <option value="SAFETY">安全终止</option>
        </select>
      </label>
      <label>
        <span>状态</span>
        <select v-model="store.filters.status">
          <option value="">全部</option>
          <option value="GENERATED">已生成</option>
          <option value="EXPORTED">已导出</option>
          <option value="LOCKED">已锁定</option>
          <option value="SUPERSEDED">{{ REPORT_STATUS_LABELS.SUPERSEDED }}</option>
          <option value="ARCHIVED">已归档</option>
          <option value="FAILED">生成失败</option>
        </select>
      </label>
      <div class="filter-actions">
        <button type="submit" class="primary-button">应用筛选</button>
        <button type="button" class="secondary-button" @click="clearFilters">清空</button>
      </div>
    </form>

    <PageState
      v-if="store.loadingList"
      kind="loading"
      title="正在同步报告"
      description="正在读取报告列表和待处理事项。"
    />
    <PageState
      v-else-if="store.listError"
      v-bind="errorState"
      @action="reload"
    />
    <template v-else>
      <PageState
        v-if="store.operationError"
        v-bind="operationErrorState"
        compact
        @action="reload"
      />
      <PageState
        v-if="store.operationMessage"
        kind="success"
        :title="store.operationMessage"
        description="报告状态已更新。"
        compact
      />

      <section class="list-panel">
        <header>
          <h2>已生成报告</h2>
          <span>{{ store.total }} 份</span>
        </header>
        <PageState
          v-if="store.items.length === 0"
          v-bind="emptyState"
          @action="clearFilters"
        />
        <div v-else class="report-list">
          <RouterLink
            v-for="item in store.items"
            :key="item.reportId"
            :to="`/teacher/reports/${item.reportId}`"
            class="report-row"
          >
            <span class="scope-chip">{{ REPORT_SCOPE_LABELS[item.reportScope] }}</span>
            <span class="report-copy">
              <strong>{{ reportTitleLabel(item.reportTitle) }}</strong>
              <small>{{ stableReportSummary(item) }}</small>
              <small>学生：{{ item.studentDisplayName || item.studentId }} · 生成：{{ formatDate(item.generatedAt) }}</small>
            </span>
            <span :class="['status-pill', item.status.toLowerCase()]">{{ REPORT_STATUS_LABELS[item.status] }}</span>
          </RouterLink>
        </div>
      </section>

      <section class="list-panel">
        <header>
          <h2>待处理候选</h2>
          <span>{{ store.candidateTotal }} 项</span>
        </header>
        <PageState
          v-if="store.candidates.length === 0"
          kind="empty"
          title="当前没有待处理候选"
          description="报告不会自动生成，请先确认需要处理的事项。"
          compact
        />
        <div v-else class="candidate-list">
          <article v-for="candidate in store.candidates" :key="candidateKey(candidate)" class="candidate-card">
            <div>
              <strong>{{ candidateTitle(candidate) }}</strong>
              <p>{{ candidateDescription(candidate) }}</p>
            </div>
            <button
              v-if="candidate.kind !== 'SAFETY_WAITING_CONFIRMATION'"
              type="button"
              class="primary-button"
              :disabled="store.operationKey === `generate:${candidateKey(candidate)}` || store.operationKey.startsWith('closure:')"
              @click="generate(candidate)"
            >
              {{ candidateActionLabel(candidate) }}
            </button>
            <RouterLink
              v-else
              class="secondary-link"
              :to="`/teacher/safety/${candidate.incidentId}`"
            >
              {{ candidateActionLabel(candidate) }}
            </RouterLink>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import PageState from '../../components/PageState.vue'
import {
  REPORT_SCOPE_LABELS,
  REPORT_STATUS_LABELS,
  candidateActionLabel,
  candidateDescription,
  candidateTitle,
  errorMessage,
  hasActiveFilters,
  listEmptyMessage,
  stableReportSummary
} from '../../components/report/report-page-state'
import { reportTitleLabel } from '../../../../shared/report-presentation'
import { candidateKey, useReportStore } from '../../stores/report'
import type { ReportGenerationCandidate } from '@shared/types/report'

const store = useReportStore()
const router = useRouter()

const errorState = computed(() => store.listError ? errorMessage(store.listError) : errorMessage('REPORT_SYSTEM_ERROR'))
const operationErrorState = computed(() => store.operationError ? errorMessage(store.operationError) : errorMessage('REPORT_SYSTEM_ERROR'))
const emptyState = computed(() => listEmptyMessage(hasActiveFilters(store.filters), store.candidates.length))

async function reload(): Promise<void> {
  await store.loadList()
}

async function clearFilters(): Promise<void> {
  store.resetFilters()
  await reload()
}

async function generate(candidate: ReportGenerationCandidate): Promise<void> {
  if (!window.confirm(`${candidateActionLabel(candidate)}：${candidateTitle(candidate)}？`)) return
  const reportId = await store.generateFromCandidate(candidate)
  if (reportId) await router.push(`/teacher/reports/${reportId}`)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => { void reload() })
</script>

<style scoped>
.report-page { display: grid; gap: 18px; max-width: 1120px; margin: 0 auto; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.eyebrow { margin: 0 0 4px; color: var(--color-accent-dark); font-size: 12px; font-weight: 800; }
h1 { margin: 0; color: var(--color-text); font-size: 30px; line-height: 1.2; }
.page-header p:last-child { margin: 7px 0 0; color: var(--color-text-muted); font-size: 14px; }
.filter-bar { display: grid; grid-template-columns: minmax(180px, 1fr) 160px 150px auto; gap: 12px; align-items: end; padding: 14px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); }
label { display: grid; gap: 5px; min-width: 0; }
label span { color: var(--color-text-muted); font-size: 12px; font-weight: 700; }
input, select { width: 100%; min-height: 40px; padding: 7px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: white; color: var(--color-text); }
.filter-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.primary-button, .secondary-button, .secondary-link { min-height: 40px; padding: 8px 13px; border-radius: var(--radius-sm); font-size: 14px; font-weight: 750; text-decoration: none; cursor: pointer; }
.primary-button { border: 0; background: var(--color-accent); color: var(--color-accent-ink); }
.secondary-button, .secondary-link { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); }
.primary-button:disabled, .secondary-button:disabled { opacity: .55; cursor: not-allowed; }
.list-panel { overflow: hidden; border-radius: var(--radius-sm); background: var(--color-surface); box-shadow: var(--shadow-surface); }
.list-panel > header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--color-border-subtle); }
.list-panel h2 { margin: 0; font-size: 17px; }
.list-panel header span { color: var(--color-text-muted); font-size: 12px; }
.report-list, .candidate-list { display: grid; }
.report-row { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 82px; padding: 14px 16px; border-bottom: 1px solid var(--color-border-subtle); color: inherit; text-decoration: none; }
.report-row:last-child, .candidate-card:last-child { border-bottom: 0; }
.report-copy { display: grid; gap: 2px; min-width: 0; }
.report-copy strong, .candidate-card strong { color: var(--color-text); font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.report-copy small, .candidate-card p { color: var(--color-text-muted); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.scope-chip, .status-pill { justify-self: start; padding: 5px 9px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 750; white-space: nowrap; }
.scope-chip { background: var(--color-surface-muted); color: var(--color-text-muted); }
.status-pill { background: var(--color-success-soft); color: var(--color-success); }
.status-pill.superseded, .status-pill.archived, .status-pill.failed { background: var(--color-warning-soft); color: var(--color-warning); }
.candidate-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--color-border-subtle); }
@media (hover: hover) {
  .report-row:hover { background: var(--color-surface-muted); }
}
@media (max-width: 760px) {
  .page-header { align-items: flex-start; flex-direction: column; }
  .filter-bar { grid-template-columns: 1fr; }
  .report-row { grid-template-columns: 1fr; gap: 8px; }
  .candidate-card { grid-template-columns: 1fr; }
}
</style>
