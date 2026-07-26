import type { ReportPresentationDocument, ReportPresentationField } from '@shared/types/report'

export const REPORT_HTML_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"

export interface ReportHtmlMetadata {
  reportId: string
  exportedAt: string
  contentHash: string
}

export function renderReportHtml(document: ReportPresentationDocument, metadata: ReportHtmlMetadata): string {
  const title = `${scopeLabel(document.reportScope)}报告`
  const sections = document.sections.map((section) => `
    <section class="section">
      <h2>${escapeHtml(section.title)}</h2>
      <dl>
        ${section.fields.map(renderField).join('')}
      </dl>
    </section>`).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(REPORT_HTML_CSP)}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #20242a; }
    main { max-width: 960px; margin: 0 auto; padding: 32px 24px 48px; }
    h1 { margin: 0 0 8px; font-size: 28px; font-weight: 700; }
    h2 { margin: 0 0 16px; font-size: 18px; }
    .meta { margin: 0 0 24px; color: #5f6874; font-size: 13px; line-height: 1.7; }
    .section { background: #fff; border: 1px solid #d8dde6; border-radius: 6px; padding: 20px; margin: 16px 0; }
    dl { display: grid; grid-template-columns: minmax(140px, 32%) 1fr; gap: 10px 18px; margin: 0; }
    dt { color: #66717f; font-weight: 600; }
    dd { margin: 0; color: #171b20; overflow-wrap: anywhere; }
    @media (max-width: 640px) {
      main { padding: 24px 16px 36px; }
      dl { grid-template-columns: 1fr; gap: 4px 0; }
      dd { margin-bottom: 10px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">报告 ID：${escapeHtml(metadata.reportId)}<br>导出时间：${escapeHtml(metadata.exportedAt)}<br>内容 Hash：${escapeHtml(metadata.contentHash)}</p>
    ${sections}
  </main>
</body>
</html>`
}

function renderField(field: ReportPresentationField): string {
  return `
          <dt>${escapeHtml(field.label)}</dt>
          <dd>${escapeHtml(formatFieldValue(field.value))}</dd>`
}

function formatFieldValue(value: ReportPresentationField['value']): string {
  if (value === null) return '无'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function scopeLabel(scope: ReportPresentationDocument['reportScope']): string {
  if (scope === 'BASE_ABILITY') return '基础能力'
  if (scope === 'JOB_SKILL') return '岗位技能'
  return '安全终止'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
