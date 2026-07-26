import { describe, expect, it } from 'vitest'
import { REPORT_HTML_CSP, renderReportHtml } from '../report-html'
import type { ReportPresentationDocument } from '@shared/types/report'

describe('report HTML export renderer', () => {
  it('renders self-contained HTML with the approved CSP and no executable template nodes', () => {
    const document: ReportPresentationDocument = {
      documentId: 'report-1',
      reportScope: 'SAFETY',
      reportType: 'SAFETY_TERMINATION_REPORT',
      generatedAt: '2026-07-26T00:00:00.000Z',
      sections: [
        {
          sectionId: 'summary',
          title: '总览<script>alert(1)</script>',
          fields: [
            {
              fieldId: 'summary.student_display_name',
              label: '学生显示名',
              value: '学生-1234',
              sensitivity: 'PUBLIC',
              exportPolicy: 'EXPORT_ALLOWED'
            },
            {
              fieldId: 'summary.scope',
              label: '报告范围',
              value: '<script>alert(1)</script><img src=x onerror=alert(1)>',
              sensitivity: 'PUBLIC',
              exportPolicy: 'EXPORT_ALLOWED'
            }
          ]
        }
      ]
    }

    const html = renderReportHtml(document, {
      reportId: 'report-1',
      exportedAt: '2026-07-26T00:01:00.000Z',
      contentHash: 'a'.repeat(64)
    })

    expect(html).toContain(`Content-Security-Policy" content="${REPORT_HTML_CSP}`)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('does not create links or external resource references from dynamic text', () => {
    const document: ReportPresentationDocument = {
      documentId: 'report-2',
      reportScope: 'JOB_SKILL',
      reportType: 'FULL_REPORT',
      generatedAt: null,
      sections: [
        {
          sectionId: 'summary',
          title: '总览',
          fields: [
            {
              fieldId: 'summary.scope',
              label: 'javascript:alert(1)',
              value: 'https://example.invalid/x.css',
              sensitivity: 'PUBLIC',
              exportPolicy: 'EXPORT_ALLOWED'
            }
          ]
        }
      ]
    }

    const html = renderReportHtml(document, {
      reportId: 'report-2',
      exportedAt: '2026-07-26T00:01:00.000Z',
      contentHash: 'b'.repeat(64)
    })

    expect(html).not.toMatch(/\s(?:href|src)=/i)
    expect(html).not.toContain('@import')
    expect(html).not.toContain('url(')
  })
})
