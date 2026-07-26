import { createHash } from 'crypto'
import { existsSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import { buildReportExportPresentation, buildReportPresentation } from '../../shared/report-presentation'
import { parseReportContent } from './report-contract'
import { sha256CanonicalJson } from './report-canonical'
import { renderReportHtml } from './report-html'
import { recordReportExportError } from './report-errors'
import type { ReportCommandCoordinator, ReportCommandKey } from './report-command-coordinator'
import type { ReportExportedV2Payload } from '@shared/types/event-payloads'
import type { ReportLifecycleStatus, ReportPresentationDocument } from '@shared/types/report'
import type { ReportContentJson } from '@shared/types/json-schemas'

type ActiveReportStatus = Extract<ReportLifecycleStatus, 'GENERATED' | 'EXPORTED' | 'LOCKED'>

interface ExportReportRow {
  report_id: string
  report_type: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT'
  student_id: string
  source_aggregate_id: string | null
  report_title: string
  report_content_json: string
  placement_review_by: string | null
  placement_review_at: string | null
  lineage_key: string | null
  content_hash: string | null
  contract_validation_status: 'VALID' | 'REPAIR_REQUIRED'
  status: ReportLifecycleStatus
}

export interface PreparedReportHtmlExport {
  reportId: string
  studentId: string
  status: ActiveReportStatus
  contentHash: string
  presentationHash: string
  reportTitle: string
  suggestedFileName: string
  htmlBytes: Buffer
  fileHash: string
  fileSizeBytes: number
  key: ReportCommandKey
}

export interface CompleteReportHtmlExportParams {
  prepared: PreparedReportHtmlExport
  targetPath: string
  exportedBy: string
  exportedAt: string
}

export interface CompleteReportHtmlExportResult {
  success: true
  reportId: string
  status: ActiveReportStatus
  exportPath: string
  fileAssetId: string
  fileHash: string
  fileSizeBytes: number
}

export class ReportExportError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'VALIDATION_ERROR'
      | 'REPORT_CONTRACT_INVALID'
      | 'REPORT_STATE_CONFLICT'
      | 'REPORT_EXPORT_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'ReportExportError'
  }
}

export function prepareReportHtmlExport(
  db: DBAdapter,
  reportId: string,
  exportedAt: string
): PreparedReportHtmlExport {
  if (!isNonEmptyString(reportId)) throw new ReportExportError('VALIDATION_ERROR', 'reportId is required')
  const row = readReportRow(db, reportId)
  if (!row) throw new ReportExportError('NOT_FOUND', `Report ${reportId} was not found`)
  const content = assertExportableRow(row)
  const pageDocument = buildReportPresentation(content, row.report_id)
  const exportDocument = buildReportExportPresentation(pageDocument, row.student_id)
  const presentationHash = sha256CanonicalJson(exportDocument)
  const html = renderReportHtml(exportDocument, {
    reportId: row.report_id,
    exportedAt,
    contentHash: row.content_hash!
  })
  const htmlBytes = Buffer.from(html, 'utf8')
  return {
    reportId: row.report_id,
    studentId: row.student_id,
    status: row.status as ActiveReportStatus,
    contentHash: row.content_hash!,
    presentationHash,
    reportTitle: row.report_title,
    suggestedFileName: `${safeFileStem(row.report_title || row.report_id)}-${row.report_id.slice(-8)}.html`,
    htmlBytes,
    fileHash: sha256Bytes(htmlBytes),
    fileSizeBytes: htmlBytes.byteLength,
    key: reportKey(db, row, content)
  }
}

export async function completeReportHtmlExport(
  db: DBAdapter,
  coordinator: ReportCommandCoordinator,
  params: CompleteReportHtmlExportParams
): Promise<CompleteReportHtmlExportResult> {
  if (!isNonEmptyString(params.targetPath)) {
    throw new ReportExportError('VALIDATION_ERROR', 'targetPath is required')
  }

  const tempPath = join(
    dirname(params.targetPath),
    `.${basename(params.targetPath)}.${uuidv4()}.tmp`
  )
  let renamedToFinal = false

  try {
    writeFileSync(tempPath, params.prepared.htmlBytes, { flag: 'wx' })
    const written = statSync(tempPath)
    if (written.size !== params.prepared.fileSizeBytes || sha256Bytes(params.prepared.htmlBytes) !== params.prepared.fileHash) {
      throw new ReportExportError('REPORT_EXPORT_FAILED', 'Prepared HTML bytes changed before export completion')
    }

    let payload: ReportExportedV2Payload | null = null
    const result = await coordinator.runSingleEventCommand({
      key: params.prepared.key,
      areas: ['TASK_REPORT'],
      buildIntent: () => {
        const current = readReportRow(db, params.prepared.reportId)
        if (!current) throw new ReportExportError('REPORT_STATE_CONFLICT', 'Report disappeared before export completion')
        const content = assertExportableRow(current)
        const pageDocument = buildReportPresentation(content, current.report_id)
        const exportDocument = buildReportExportPresentation(pageDocument, current.student_id)
        const presentationHash = sha256CanonicalJson(exportDocument)
        if (
          current.status !== params.prepared.status
          || current.content_hash !== params.prepared.contentHash
          || presentationHash !== params.prepared.presentationHash
        ) {
          throw new ReportExportError('REPORT_STATE_CONFLICT', 'Report changed after export preparation')
        }

        renameSync(tempPath, params.targetPath)
        renamedToFinal = true
        const fileAssetId = uuidv4()
        payload = {
          report_id: params.prepared.reportId,
          export_format: 'HTML',
          export_path: params.targetPath,
          exported_at: params.exportedAt,
          exported_by: params.exportedBy,
          file_asset_id: fileAssetId,
          file_hash: params.prepared.fileHash,
          file_size_bytes: params.prepared.fileSizeBytes,
          mime_type: 'text/html',
          content_hash: params.prepared.contentHash,
          status_before: params.prepared.status,
          status_after: params.prepared.status === 'LOCKED' ? 'LOCKED' : 'EXPORTED'
        } as ReportExportedV2Payload
        return {
          aggregateType: 'TASK_REPORT',
          aggregateId: params.prepared.reportId,
          eventType: 'REPORT_EXPORTED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: params.exportedBy,
          actorRole: 'TEACHER'
        }
      },
      mapResult: () => {
        if (!payload) throw new ReportExportError('REPORT_EXPORT_FAILED', 'Export event payload was not produced')
        return {
          success: true as const,
          reportId: params.prepared.reportId,
          status: payload.status_after,
          exportPath: params.targetPath,
          fileAssetId: payload.file_asset_id,
          fileHash: payload.file_hash,
          fileSizeBytes: payload.file_size_bytes
        }
      }
    })
    return result
  } catch (error) {
    if (!renamedToFinal) cleanupTempFile(tempPath)
    if (error instanceof ReportExportError && error.code !== 'REPORT_EXPORT_FAILED') throw error
    recordExportFailure(db, params.prepared.reportId, params.targetPath, error)
    if (error instanceof ReportExportError) throw error
    throw new ReportExportError('REPORT_EXPORT_FAILED', 'Report export failed')
  }
}

export function buildExportDocumentForTest(document: ReportPresentationDocument, studentId: string): ReportPresentationDocument {
  return buildReportExportPresentation(document, studentId)
}

function readReportRow(db: DBAdapter, reportId: string): ExportReportRow | null {
  return db.prepare(
    `SELECT report_id, report_type, student_id, source_aggregate_id, report_title, report_content_json,
            placement_review_by, placement_review_at, lineage_key, content_hash,
            contract_validation_status, status
       FROM task_report
      WHERE report_id = ?`
  ).get(reportId) as ExportReportRow | undefined ?? null
}

function assertExportableRow(row: ExportReportRow): ReportContentJson {
  if (!['GENERATED', 'EXPORTED', 'LOCKED'].includes(row.status)) {
    throw new ReportExportError('REPORT_STATE_CONFLICT', 'Only active reports can be exported')
  }
  if (row.contract_validation_status !== 'VALID' || !row.content_hash) {
    throw new ReportExportError('REPORT_CONTRACT_INVALID', 'Report contract must be valid before export')
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(row.report_content_json) as unknown
  } catch {
    throw new ReportExportError('REPORT_CONTRACT_INVALID', 'Report content is not valid JSON')
  }
  const parsed = parseReportContent(parsedJson)
  if (!parsed.valid || sha256CanonicalJson(parsed.value) !== row.content_hash) {
    throw new ReportExportError('REPORT_CONTRACT_INVALID', 'Report content does not match its contract hash')
  }
  if (parsed.value.placement_advice.enabled && (!row.placement_review_by || !row.placement_review_at)) {
    throw new ReportExportError('REPORT_STATE_CONFLICT', 'Placement review is required before export')
  }
  return parsed.value
}

function reportKey(db: DBAdapter, row: ExportReportRow, content: ReportContentJson): ReportCommandKey {
  const sourceBusinessKey = row.source_aggregate_id ? reportSourceBusinessKey(db, row.source_aggregate_id) : null
  return {
    studentId: row.student_id,
    jobCode: content.report_scope === 'JOB_SKILL'
      ? content.assessment_meta.job_code
      : content.report_scope === 'SAFETY'
        ? content.incident_snapshot.job_code
        : sourceBusinessKey?.job_code ?? '',
    taskCode: content.report_scope === 'SAFETY'
      ? content.incident_snapshot.task_code
      : sourceBusinessKey?.task_code ?? '',
    scope: content.report_scope
  }
}

function reportSourceBusinessKey(db: DBAdapter, sourceAggregateId: string): { job_code: string; task_code: string } | null {
  const assessment = db.prepare('SELECT job_code, task_code FROM assessment_session WHERE session_id = ?').get(sourceAggregateId) as {
    job_code: string
    task_code: string
  } | undefined
  if (assessment) return assessment
  const training = db.prepare('SELECT job_code, task_code FROM training_session WHERE training_session_id = ?').get(sourceAggregateId) as {
    job_code: string
    task_code: string
  } | undefined
  return training ?? null
}

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function cleanupTempFile(path: string): void {
  if (!existsSync(path)) return
  try {
    rmSync(path, { force: true })
  } catch {
    // The export failure is already reported; retained temp files are inert HTML bytes.
  }
}

function recordExportFailure(db: DBAdapter, reportId: string, targetPath: string, error: unknown): void {
  try {
    recordReportExportError(db, {
      relatedAggregateType: 'TASK_REPORT',
      relatedAggregateId: reportId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      context: { reportId, targetPath }
    })
  } catch {
    // Do not mask the original export failure with an audit-write failure.
  }
}

function safeFileStem(value: string): string {
  const stem = value.trim().replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/\s+/g, '-')
  return stem.length > 0 ? stem.slice(0, 80) : 'report'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
