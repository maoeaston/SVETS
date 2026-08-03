<template>
  <div class="report-detail-page">
    <header class="detail-header">
      <div>
        <RouterLink to="/teacher/reports" class="back-link">返回报告列表</RouterLink>
        <p class="eyebrow">报告详情</p>
        <h1>{{ reportTitleLabel(store.detail?.reportTitle) }}</h1>
        <p v-if="store.detail">{{ REPORT_SCOPE_LABELS[store.detail.reportScope] }} · {{ REPORT_TYPE_LABELS[store.detail.reportType] }} · 学生 {{ store.detail.studentId }}</p>
      </div>
      <button class="secondary-button" type="button" :disabled="store.loadingDetail" @click="reload">刷新</button>
    </header>

    <PageState
      v-if="store.loadingDetail"
      kind="loading"
      title="正在读取报告记录"
      description="详情只读取已保存的报告，不会重新生成或计算。"
    />
    <PageState
      v-else-if="store.detailError"
      v-bind="detailErrorState"
      @action="reload"
    />
    <template v-else-if="store.detail">
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
        description="页面已重新读取报告生命周期。"
        compact
      />

      <section class="meta-panel">
        <div>
          <span>状态</span>
          <strong>{{ REPORT_STATUS_LABELS[store.detail.lifecycle.status] }}</strong>
        </div>
        <div>
          <span>内容状态</span>
          <strong>{{ REPORT_CONTENT_STATUS_LABELS[store.detail.lifecycle.contractValidationStatus] }}</strong>
        </div>
        <div>
          <span>报告版本</span>
          <strong>{{ reportRevisionLabel(store.detail.lifecycle.reportRevision) }}</strong>
        </div>
        <div>
          <span>最后导出</span>
          <strong>{{ store.detail.lifecycle.lastExportedAt ? formatDate(store.detail.lifecycle.lastExportedAt) : '未导出' }}</strong>
        </div>
      </section>

      <PageState
        v-if="actionInfo.readonlyReason"
        kind="blocked"
        :title="actionInfo.readonlyReason"
        description="历史、归档、失败或内容检查未通过的报告不会开放生命周期操作。"
        compact
      />

      <section class="action-panel">
        <button
          type="button"
          class="primary-button"
          :disabled="!actionInfo.canConfirmPlacementReview || store.operationKey === `review:${store.detail.reportId}`"
          @click="confirmReview"
        >
          复核安置建议
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="!actionInfo.canLock || store.operationKey === `lock:${store.detail.reportId}`"
          @click="lockCurrentReport"
        >
          锁定报告
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="!actionInfo.canExport || store.operationKey === `export:${store.detail.reportId}`"
          @click="exportCurrentReport"
        >
          导出脱敏 HTML
        </button>
        <RouterLink
          v-if="store.detail.reportScope === 'JOB_SKILL'"
          to="/teacher/trainings"
          class="secondary-link"
        >
          查看训练入口
        </RouterLink>
      </section>

      <PageState
        v-if="store.detail.presentation === null"
        kind="blocked"
        title="报告内容暂时无法展示"
        :description="contractErrorText"
      />
      <ReportSectionList
        v-else
        :sections="store.detail.presentation.sections"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PageState from '../../components/PageState.vue'
import ReportSectionList from '../../components/report/ReportSectionList.vue'
import {
  REPORT_CONTENT_STATUS_LABELS,
  REPORT_SCOPE_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  actionState,
  errorMessage
} from '../../components/report/report-page-state'
import { useReportStore } from '../../stores/report'
import { reportRevisionLabel, reportTitleLabel } from '../../../../shared/report-presentation'

const route = useRoute()
const store = useReportStore()

const reportId = computed(() => String(route.params.reportId ?? ''))
const detailErrorState = computed(() => store.detailError ? errorMessage(store.detailError) : errorMessage('REPORT_SYSTEM_ERROR'))
const operationErrorState = computed(() => store.operationError ? errorMessage(store.operationError) : errorMessage('REPORT_SYSTEM_ERROR'))
const actionInfo = computed(() => {
  if (!store.detail) {
    return actionState('FAILED', 'REPAIR_REQUIRED', {
      canConfirmPlacementReview: false,
      canLock: false,
      canExport: false,
      placementAdviceEnabled: false
    })
  }
  return actionState(
    store.detail.lifecycle.status,
    store.detail.lifecycle.contractValidationStatus,
    store.detail.lifecycle.capabilities
  )
})
const contractErrorText = computed(() => {
  const errors = store.detail?.contractErrors ?? []
  if (errors.length === 0) return '这份报告的内容检查未通过，页面不会猜测渲染。'
  return '这份报告的内容检查未通过，页面不会猜测渲染。请重新加载或联系管理员。'
})

async function reload(): Promise<void> {
  await store.loadDetail(reportId.value)
}

async function confirmReview(): Promise<void> {
  if (window.confirm('确认已经复核该报告中的安置建议？')) {
    await store.confirmPlacementReview(reportId.value)
  }
}

async function lockCurrentReport(): Promise<void> {
  if (window.confirm('锁定后报告内容和生命周期状态将进入只读追溯。确认锁定？')) {
    await store.lockReport(reportId.value)
  }
}

async function exportCurrentReport(): Promise<void> {
  await store.exportReport(reportId.value)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

watch(reportId, () => { void reload() })
onMounted(() => { void reload() })
</script>

<style scoped>
.report-detail-page { display: grid; gap: 16px; max-width: 1040px; margin: 0 auto; }
.detail-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.back-link { display: inline-block; margin-bottom: 8px; color: var(--color-accent-dark); font-size: 13px; font-weight: 750; text-decoration: none; }
.eyebrow { margin: 0 0 4px; color: var(--color-accent-dark); font-size: 12px; font-weight: 800; }
h1 { margin: 0; color: var(--color-text); font-size: 30px; line-height: 1.2; overflow-wrap: anywhere; }
.detail-header p:last-child { margin: 7px 0 0; color: var(--color-text-muted); font-size: 14px; }
.meta-panel { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; border-radius: var(--radius-sm); background: var(--color-ink); color: white; box-shadow: var(--shadow-surface); }
.meta-panel div { display: grid; gap: 2px; padding: 14px 16px; border-right: 1px solid oklch(1 0 0 / .12); min-width: 0; }
.meta-panel div:last-child { border-right: 0; }
.meta-panel span { color: var(--color-sidebar-muted); font-size: 11px; }
.meta-panel strong { font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.action-panel { display: flex; flex-wrap: wrap; gap: 9px; padding: 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface); }
.primary-button, .secondary-button, .secondary-link { min-height: 40px; padding: 8px 13px; border-radius: var(--radius-sm); font-size: 14px; font-weight: 750; text-decoration: none; cursor: pointer; }
.primary-button { border: 0; background: var(--color-accent); color: var(--color-accent-ink); }
.secondary-button, .secondary-link { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); }
.primary-button:disabled, .secondary-button:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 760px) {
  .detail-header { align-items: flex-start; flex-direction: column; }
  .meta-panel { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .meta-panel div:nth-child(2) { border-right: 0; }
  .meta-panel div:nth-child(-n + 2) { border-bottom: 1px solid oklch(1 0 0 / .12); }
}
</style>
