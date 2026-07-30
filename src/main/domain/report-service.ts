import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import { assertCaller } from '../utils/auth-context'
import { sha256CanonicalJson } from './report-canonical'
import { parseReportContent } from './report-contract'
import {
  buildBaseAbilityReport,
  buildJobSkillReport,
  buildSafetyReport,
  type BuiltReportSnapshot
} from './report-builders'
import { recordReportGenerationError } from './report-errors'
import type { F7EventIntent, ReportCommandCoordinator } from './report-command-coordinator'
import type { ReportGeneratedV2Payload } from '@shared/types/event-payloads'
import type { GenerateReportParams, GenerateReportResult } from '@shared/types/report'

type ActorRole = 'TEACHER' | 'SYSTEM'
type ActiveReportStatus = 'GENERATED' | 'EXPORTED' | 'LOCKED'

interface ExistingReportRow {
  report_id: string
  status: ActiveReportStatus | 'SUPERSEDED' | 'ARCHIVED' | 'FAILED'
  contract_validation_status: 'VALID' | 'REPAIR_REQUIRED'
  report_content_json: string
  generation_key: string | null
  lineage_key: string | null
  report_revision: number | null
  source_aggregate_type: string | null
  source_aggregate_id: string | null
  task_closure_id: string | null
}

export interface ReportSourceKey {
  studentId: string
  jobCode: string
  taskCode: string
  scope: 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY'
  aggregateType: 'TASK_CLOSURE' | 'ASSESSMENT_SESSION' | 'SAFETY_INCIDENT'
  aggregateId: string
}

export interface GenerateReportServiceParams {
  reportScope: 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY'
  taskClosureId?: string
  resultId?: string
  incidentId?: string
  callerUserId: string
  callerRole: 'TEACHER'
  generatedAt?: string
  correlationId: string
}

export interface GenerateReportServiceResult {
  reportId: string
  generated: boolean
  eventId: string | null
}

export class ReportServiceError extends Error {
  constructor(
    public readonly code:
      | 'FORBIDDEN'
      | 'INVALID_INPUT'
      | 'SOURCE_NOT_FOUND'
      | 'SOURCE_NOT_READY'
      | 'REPORT_CONTRACT_INVALID'
      | 'REPORT_GENERATION_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'ReportServiceError'
  }
}

export class ReportService {
  constructor(
    private readonly db: DBAdapter,
    private readonly coordinator: ReportCommandCoordinator
  ) {}

  async generateReport(params: GenerateReportServiceParams): Promise<GenerateReportServiceResult> {
    const actorId = requireActiveTeacher(this.db, params.callerUserId, params.callerRole)
    return this.generateInternal(params, actorId, 'TEACHER')
  }

  async generateFromSharedParams(
    params: GenerateReportParams,
    correlationId: string
  ): Promise<GenerateReportResult> {
    const result = await this.generateReport({
      reportScope: params.reportScope,
      taskClosureId: 'taskClosureId' in params ? params.taskClosureId : undefined,
      resultId: 'resultId' in params ? params.resultId : undefined,
      incidentId: 'incidentId' in params ? params.incidentId : undefined,
      callerUserId: params.callerUserId,
      callerRole: params.callerRole as 'TEACHER',
      correlationId
    })
    return { success: true, reportId: result.reportId, generated: result.generated }
  }

  async generateJobSkillReportFromResult(
    resultId: string,
    actorId: string,
    actorRole: ActorRole,
    correlationId: string
  ): Promise<GenerateReportServiceResult> {
    return this.generateInternal(
      { reportScope: 'JOB_SKILL', resultId, callerUserId: actorId, callerRole: 'TEACHER', correlationId },
      actorId,
      actorRole
    )
  }

  generateJobSkillReportFromResultSync(
    resultId: string,
    actorId: string,
    actorRole: ActorRole,
    correlationId: string
  ): GenerateReportServiceResult {
    return this.generateInternalSync(
      { reportScope: 'JOB_SKILL', resultId, callerUserId: actorId, callerRole: 'TEACHER', correlationId },
      actorId,
      actorRole
    )
  }

  generateSafetyReportFromIncidentSync(
    incidentId: string,
    actorId: string,
    actorRole: ActorRole,
    correlationId: string
  ): GenerateReportServiceResult {
    return this.generateInternalSync(
      { reportScope: 'SAFETY', incidentId, callerUserId: actorId, callerRole: 'TEACHER', correlationId },
      actorId,
      actorRole
    )
  }

  private async generateInternal(
    params: Omit<GenerateReportServiceParams, 'callerRole'> & { callerRole: 'TEACHER' },
    actorId: string,
    actorRole: ActorRole
  ): Promise<GenerateReportServiceResult> {
    requireCorrelation(params.correlationId)
    const sourceKey = resolveReportSourceKey(this.db, params)
    try {
      return await this.coordinator.runSingleEventCommand({
        key: { studentId: sourceKey.studentId, jobCode: sourceKey.jobCode, taskCode: sourceKey.taskCode, scope: sourceKey.scope },
        areas: ['TASK_REPORT'],
        buildIntent: () => {
          const built = buildForParams(this.db, params, params.generatedAt ?? new Date().toISOString())
          const generation = generationFacts(this.db, built)
          const existing = findValidReportByGenerationKey(this.db, generation.generationKey)
          if (existing) return null

          const reportId = uuidv4()
          const payload: ReportGeneratedV2Payload = {
            report_id: reportId,
            student_id: sourceKey.studentId,
            job_code: sourceKey.jobCode,
            task_code: sourceKey.taskCode,
            report_type: built.reportType,
            report_scope: built.scope,
            source_aggregate_type: built.sourceAggregateType,
            source_aggregate_id: built.sourceAggregateId,
            result_ids: built.resultIds,
            incident_ids: built.incidentIds,
            report_title: built.reportTitle,
            report_content: built.content,
            generated_at: built.content.generated_at,
            generated_by: actorId,
            report_revision: generation.revision,
            report_schema_version: built.reportSchemaVersion,
            report_builder_version: built.reportBuilderVersion,
            lineage_key: built.lineageKey,
            source_set_hash: built.sourceSetHash,
            content_hash: built.contentHash,
            generation_key: generation.generationKey,
            generation_reason: generation.reason,
            task_closure_id: built.taskClosureId,
            repair_of_report_id: generation.repairOfReportId,
            superseded_report_ids: generation.supersededReportIds
          }
          return {
            aggregateType: 'TASK_REPORT',
            aggregateId: reportId,
            eventType: 'REPORT_GENERATED',
            payload: payload as unknown as Record<string, unknown>,
            actorId,
            actorRole,
            correlationId: params.correlationId
          } satisfies F7EventIntent
        },
        mapResult: (event) => {
          if (event) return { reportId: event.aggregate_id, generated: true, eventId: event.event_id }
          const built = buildForParams(this.db, params, params.generatedAt ?? new Date().toISOString())
          const generation = generationFacts(this.db, built)
          const existing = findValidReportByGenerationKey(this.db, generation.generationKey)
          if (!existing) throw new ReportServiceError('REPORT_GENERATION_FAILED', 'Idempotent report lookup failed')
          return { reportId: existing.report_id, generated: false, eventId: null }
        }
      })
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error))
      recordReportGenerationError(this.db, {
        relatedAggregateType: sourceKey.aggregateType,
        relatedAggregateId: sourceKey.aggregateId,
        message: reason.message,
        context: { reportScope: params.reportScope, source: sourceKey.aggregateId },
        stack: reason.stack
      })
      if (error instanceof ReportServiceError) throw error
      throw new ReportServiceError('REPORT_GENERATION_FAILED', reason.message)
    }
  }

  private generateInternalSync(
    params: Omit<GenerateReportServiceParams, 'callerRole'> & { callerRole: 'TEACHER' },
    actorId: string,
    actorRole: ActorRole
  ): GenerateReportServiceResult {
    requireCorrelation(params.correlationId)
    const sourceKey = resolveReportSourceKey(this.db, params)
    try {
      return this.coordinator.runSingleEventCommandSync({
        key: { studentId: sourceKey.studentId, jobCode: sourceKey.jobCode, taskCode: sourceKey.taskCode, scope: sourceKey.scope },
        areas: ['TASK_REPORT'],
        buildIntent: () => {
          const built = buildForParams(this.db, params, params.generatedAt ?? new Date().toISOString())
          const generation = generationFacts(this.db, built)
          const existing = findValidReportByGenerationKey(this.db, generation.generationKey)
          if (existing) return null

          const reportId = uuidv4()
          const payload: ReportGeneratedV2Payload = {
            report_id: reportId,
            student_id: sourceKey.studentId,
            job_code: sourceKey.jobCode,
            task_code: sourceKey.taskCode,
            report_type: built.reportType,
            report_scope: built.scope,
            source_aggregate_type: built.sourceAggregateType,
            source_aggregate_id: built.sourceAggregateId,
            result_ids: built.resultIds,
            incident_ids: built.incidentIds,
            report_title: built.reportTitle,
            report_content: built.content,
            generated_at: built.content.generated_at,
            generated_by: actorId,
            report_revision: generation.revision,
            report_schema_version: built.reportSchemaVersion,
            report_builder_version: built.reportBuilderVersion,
            lineage_key: built.lineageKey,
            source_set_hash: built.sourceSetHash,
            content_hash: built.contentHash,
            generation_key: generation.generationKey,
            generation_reason: generation.reason,
            task_closure_id: built.taskClosureId,
            repair_of_report_id: generation.repairOfReportId,
            superseded_report_ids: generation.supersededReportIds
          }
          return {
            aggregateType: 'TASK_REPORT',
            aggregateId: reportId,
            eventType: 'REPORT_GENERATED',
            payload: payload as unknown as Record<string, unknown>,
            actorId,
            actorRole,
            correlationId: params.correlationId
          } satisfies F7EventIntent
        },
        mapResult: (event) => {
          if (event) return { reportId: event.aggregate_id, generated: true, eventId: event.event_id }
          const built = buildForParams(this.db, params, params.generatedAt ?? new Date().toISOString())
          const generation = generationFacts(this.db, built)
          const existing = findValidReportByGenerationKey(this.db, generation.generationKey)
          if (!existing) throw new ReportServiceError('REPORT_GENERATION_FAILED', 'Idempotent report lookup failed')
          return { reportId: existing.report_id, generated: false, eventId: null }
        }
      })
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error))
      recordReportGenerationError(this.db, {
        relatedAggregateType: sourceKey.aggregateType,
        relatedAggregateId: sourceKey.aggregateId,
        message: reason.message,
        context: { reportScope: params.reportScope, source: sourceKey.aggregateId },
        stack: reason.stack
      })
      if (error instanceof ReportServiceError) throw error
      throw new ReportServiceError('REPORT_GENERATION_FAILED', reason.message)
    }
  }
}

function requireActiveTeacher(db: DBAdapter, callerUserId: string, callerRole: 'TEACHER'): string {
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok || caller.row.role !== 'TEACHER') {
    throw new ReportServiceError('FORBIDDEN', 'Report generation requires an ACTIVE TEACHER')
  }
  return caller.row.user_id
}

function requireCorrelation(correlationId: string): void {
  if (!correlationId.trim()) {
    throw new ReportServiceError('INVALID_INPUT', 'Report generation correlation is required')
  }
}

function buildForParams(db: DBAdapter, params: Pick<GenerateReportServiceParams, 'reportScope' | 'taskClosureId' | 'resultId' | 'incidentId'>, generatedAt: string): BuiltReportSnapshot {
  if (params.reportScope === 'BASE_ABILITY') {
    if (!params.taskClosureId || params.resultId || params.incidentId) throw new ReportServiceError('INVALID_INPUT', 'BASE report generation requires only taskClosureId')
    return buildBaseAbilityReport(db, params.taskClosureId, generatedAt)
  }
  if (params.reportScope === 'JOB_SKILL') {
    if (!params.resultId || params.taskClosureId || params.incidentId) throw new ReportServiceError('INVALID_INPUT', 'JOB report generation requires only resultId')
    return buildJobSkillReport(db, params.resultId, generatedAt)
  }
  if (!params.incidentId || params.taskClosureId || params.resultId) throw new ReportServiceError('INVALID_INPUT', 'SAFETY report generation requires only incidentId')
  return buildSafetyReport(db, params.incidentId, generatedAt)
}

export function resolveReportSourceKey(
  db: DBAdapter,
  params: Pick<GenerateReportServiceParams, 'reportScope' | 'taskClosureId' | 'resultId' | 'incidentId'>
): ReportSourceKey {
  if (params.reportScope === 'BASE_ABILITY') {
    if (!params.taskClosureId) throw new ReportServiceError('INVALID_INPUT', 'Missing taskClosureId')
    const row = db.prepare('SELECT student_id, job_code, task_code FROM task_closure WHERE task_closure_id = ?').get(params.taskClosureId) as {
      student_id: string
      job_code: string
      task_code: string
    } | undefined
    if (!row) throw new ReportServiceError('SOURCE_NOT_FOUND', `Task closure ${params.taskClosureId} was not found`)
    return { studentId: row.student_id, jobCode: row.job_code, taskCode: row.task_code, scope: 'BASE_ABILITY', aggregateType: 'TASK_CLOSURE', aggregateId: params.taskClosureId }
  }
  if (params.reportScope === 'JOB_SKILL') {
    if (!params.resultId) throw new ReportServiceError('INVALID_INPUT', 'Missing resultId')
    const row = db.prepare(
      `SELECT r.student_id, r.job_code, a.task_code
         FROM result_record r
         JOIN assessment_session a
           ON r.source_aggregate_type = 'ASSESSMENT_SESSION'
          AND a.session_id = r.source_aggregate_id
        WHERE r.result_id = ?`
    ).get(params.resultId) as { student_id: string; job_code: string; task_code: string } | undefined
    if (!row) throw new ReportServiceError('SOURCE_NOT_FOUND', `Result ${params.resultId} was not found`)
    return { studentId: row.student_id, jobCode: row.job_code, taskCode: row.task_code, scope: 'JOB_SKILL', aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.resultId }
  }
  if (!params.incidentId) throw new ReportServiceError('INVALID_INPUT', 'Missing incidentId')
  const row = db.prepare('SELECT student_id, job_code, task_code FROM safety_incident WHERE incident_id = ?').get(params.incidentId) as {
    student_id: string
    job_code: string
    task_code: string
  } | undefined
  if (!row) throw new ReportServiceError('SOURCE_NOT_FOUND', `Safety incident ${params.incidentId} was not found`)
  return { studentId: row.student_id, jobCode: row.job_code, taskCode: row.task_code, scope: 'SAFETY', aggregateType: 'SAFETY_INCIDENT', aggregateId: params.incidentId }
}

function generationFacts(db: DBAdapter, built: BuiltReportSnapshot): {
  generationKey: string
  revision: number
  reason: ReportGeneratedV2Payload['generation_reason']
  repairOfReportId: string | null
  supersededReportIds: string[]
} {
  const active = activeReportsForLineage(db, built.lineageKey)
  const invalid = active.find((report) => !reportContentStillValid(report))
  const reason = invalid ? 'CONTRACT_REPAIR' : 'NORMAL'
  const repairOfReportId = invalid?.report_id ?? null
  const generationKey = sha256CanonicalJson({
    report_scope: built.scope,
    lineage_key: built.lineageKey,
    source_set_hash: built.sourceSetHash,
    report_schema_version: built.reportSchemaVersion,
    report_builder_version: built.reportBuilderVersion,
    generation_reason: reason,
    repair_of_report_id: repairOfReportId
  })
  return {
    generationKey,
    revision: maxRevision(db, built.lineageKey) + 1,
    reason,
    repairOfReportId,
    supersededReportIds: active.map((report) => report.report_id)
  }
}

function findValidReportByGenerationKey(db: DBAdapter, generationKey: string): ExistingReportRow | null {
  const row = db.prepare('SELECT * FROM task_report WHERE generation_key = ? LIMIT 1').get(generationKey) as ExistingReportRow | undefined
  if (!row) return null
  return reportContentStillValid(row) ? row : null
}

function activeReportsForLineage(db: DBAdapter, lineageKey: string): ExistingReportRow[] {
  return db.prepare(
    `SELECT *
       FROM task_report
      WHERE lineage_key = ?
        AND status IN ('GENERATED', 'EXPORTED', 'LOCKED')
      ORDER BY report_revision ASC, report_id ASC`
  ).all(lineageKey) as ExistingReportRow[]
}

function maxRevision(db: DBAdapter, lineageKey: string): number {
  const row = db.prepare('SELECT MAX(report_revision) AS max_revision FROM task_report WHERE lineage_key = ?').get(lineageKey) as { max_revision: number | null } | undefined
  return row?.max_revision ?? 0
}

function reportContentStillValid(report: ExistingReportRow): boolean {
  if (report.contract_validation_status !== 'VALID') return false
  try {
    const parsed = parseReportContent(JSON.parse(report.report_content_json) as unknown)
    return parsed.valid
  } catch {
    return false
  }
}
