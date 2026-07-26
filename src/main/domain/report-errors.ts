import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import type { AggregateType } from '@shared/types/event-payloads'

export interface ReportErrorInput {
  relatedAggregateType: Extract<AggregateType, 'TASK_CLOSURE' | 'TASK_REPORT' | 'ASSESSMENT_SESSION' | 'TRAINING_SESSION' | 'SAFETY_INCIDENT' | 'SYSTEM'>
  relatedAggregateId: string
  message: string
  context?: Record<string, unknown>
  stack?: string | null
}

export function recordReportGenerationError(db: DBAdapter, input: ReportErrorInput): string {
  return recordReportError(db, 'REPORT_GENERATION_FAILED', 'RETRY_REPORT_GENERATION', input)
}

export function recordReportExportError(db: DBAdapter, input: ReportErrorInput): string {
  return recordReportError(db, 'REPORT_EXPORT_FAILED', 'RETRY_REPORT_EXPORT', input)
}

function recordReportError(
  db: DBAdapter,
  errorCode: 'REPORT_GENERATION_FAILED' | 'REPORT_EXPORT_FAILED',
  recoveryAction: string,
  input: ReportErrorInput
): string {
  const errorEventId = uuidv4()
  db.prepare(
    `INSERT INTO error_event_log (
       error_event_id, error_code, severity, error_category, related_aggregate_type,
       related_aggregate_id, message, context_json, stack_trace, recovery_action, recovery_status
     ) VALUES (?, ?, 'ERROR', 'REPORT', ?, ?, ?, ?, ?, ?, 'UNRESOLVED')`
  ).run(
    errorEventId,
    errorCode,
    input.relatedAggregateType,
    input.relatedAggregateId,
    scrub(input.message),
    JSON.stringify(scrubContext(input.context ?? {})),
    input.stack ? scrub(input.stack) : null,
    recoveryAction
  )
  return errorEventId
}

function scrub(value: string): string {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[uuid]')
    .slice(0, 2000)
}

function scrubContext(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (/student|name|description|note|path/i.test(key)) {
      output[key] = '[redacted]'
    } else if (typeof value === 'string') {
      output[key] = scrub(value)
    } else if (Array.isArray(value)) {
      output[key] = value.map((item) => typeof item === 'string' ? scrub(item) : item)
    } else {
      output[key] = value
    }
  }
  return output
}
