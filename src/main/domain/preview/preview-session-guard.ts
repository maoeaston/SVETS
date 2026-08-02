import type { DBAdapter } from '../../db/interface'
import { PreviewContractError } from './preview-errors'

function previewProjectionInstalled(database: DBAdapter): boolean {
  const row = database.prepare(
    `SELECT 1 AS present
       FROM sqlite_master
      WHERE type = 'table' AND name = 'preview_session_projection'`
  ).get() as { present?: number } | undefined
  return Boolean(row?.present)
}

/** Formal writers must treat a preview shell as a different aggregate. */
export function isPreviewAssessmentSession(database: DBAdapter, sessionId: string): boolean {
  if (!previewProjectionInstalled(database)) return false
  const row = database.prepare(
    `SELECT 1 AS present
       FROM assessment_session s
      WHERE s.session_id = ?
        AND (
          s.session_contract_kind = 'PREVIEW_SHELL'
          OR EXISTS (
            SELECT 1
              FROM preview_session_projection p
             WHERE p.assessment_session_id = s.session_id
          )
        )`
  ).get(sessionId) as { present?: number } | undefined
  return Boolean(row?.present)
}

export function assertFormalAssessmentSession(
  database: DBAdapter,
  sessionId: string,
  operation = 'formal assessment operation'
): void {
  if (isPreviewAssessmentSession(database, sessionId)) {
    throw new PreviewContractError(
      'PREVIEW_RESULT_SUPPRESSED',
      `${operation} cannot target a PREVIEW_ONLY assessment session`
    )
  }
}
