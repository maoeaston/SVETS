import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestReportCommandCoordinator } from '../../application/runtime/__tests__/test-helpers'
import { createTestDb, seedCaller, seedStudent } from '../../db/test-helpers'
import type { DBAdapter, DBStatement } from '../../db/interface'
import type { MemoryAdapter } from '../../db/memory-adapter'
import { buildSafetyReport } from '../report-builders'
import {
  completeReportHtmlExport,
  prepareReportHtmlExport,
  ReportExportError,
  type ReportExportFilePort
} from '../report-export'
import { clearF7WriteBlockAfterRecovery } from '../report-write-gate'

const ISO = '2026-07-29T00:00:00.000Z'
const CORRELATION_ID = 'report-export-failure-matrix-correlation'
const JOB_CODE = 'SUPERMARKET_SHELVER'
const TASK_CODE = 'SHELVE_TASK'

let db: MemoryAdapter
let teacherId: string
let studentId: string
const dirs: string[] = []

beforeEach(async () => {
  clearF7WriteBlockAfterRecovery()
  db = await createTestDb()
  teacherId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
})

afterEach(() => {
  clearF7WriteBlockAfterRecovery()
  db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function actionLogPath(prefix: string): string {
  return join(tempDir(prefix), 'action_log.jsonl')
}

function seedProjectionEvent(
  database: DBAdapter,
  aggregateType: string,
  aggregateId: string,
  eventType: string
): string {
  const eventId = uuidv4()
  database.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, ?, ?, ?, 1, '{}', 'seed', 'seed', 2, ?)`
  ).run(eventId, aggregateType, aggregateId, eventType, ISO)
  return eventId
}

function seedExportableReport(): string {
  const incidentId = uuidv4()
  const triggerEventId = seedProjectionEvent(db, 'SAFETY_INCIDENT', incidentId, 'SAFETY_INCIDENT_CREATED')
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status)
     VALUES (?, ?, ?, ?, ?, 'BLADE_TOWARD_SELF', '已确认安全事实', ?,
             'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
  ).run(incidentId, studentId, JOB_CODE, TASK_CODE, triggerEventId, teacherId, ISO)
  db.prepare(
    `UPDATE safety_incident
        SET status = 'CONFIRMED', confirmed_by = ?, updated_at = ?
      WHERE incident_id = ?`
  ).run(teacherId, ISO, incidentId)

  const built = buildSafetyReport(db, incidentId, ISO)
  const reportId = uuidv4()
  const generatedEventId = seedProjectionEvent(db, 'TASK_REPORT', reportId, 'REPORT_GENERATED')
  db.prepare(
    `INSERT INTO task_report
       (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
        source_result_ids_json, report_title, report_content_json, generated_event_id,
        generated_by, generated_at, lineage_key, source_set_hash, generation_key, content_hash,
        report_revision, report_schema_version, report_builder_version, generation_reason,
        contract_validation_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'NORMAL', 'VALID', 'GENERATED')`
  ).run(
    reportId,
    built.reportType,
    studentId,
    built.sourceAggregateType,
    built.sourceAggregateId,
    JSON.stringify(built.resultIds),
    built.reportTitle,
    JSON.stringify(built.content),
    generatedEventId,
    teacherId,
    ISO,
    built.lineageKey,
    built.sourceSetHash,
    `${reportId.replace(/-/g, '')}${'a'.repeat(32)}`.slice(0, 64),
    built.contentHash,
    built.reportSchemaVersion,
    built.reportBuilderVersion
  )
  return reportId
}

function filePort(overrides: Partial<ReportExportFilePort> = {}): ReportExportFilePort {
  const base: ReportExportFilePort = {
    exists: existsSync,
    writeOwnedTemp(path, bytes) {
      writeFileSync(path, bytes, { flag: 'wx' })
    },
    readOwnedTemp: readFileSync,
    renameOwnedTemp(tempPath, targetPath) {
      linkSync(tempPath, targetPath)
      unlinkSync(tempPath)
    },
    cleanupOwnedTemp(path) {
      if (existsSync(path)) rmSync(path, { force: true })
    }
  }
  return { ...base, ...overrides }
}

function completionParams(reportId: string, targetPath: string) {
  return {
    prepared: prepareReportHtmlExport(db, reportId, ISO),
    targetPath,
    exportedBy: teacherId,
    exportedAt: ISO,
    correlationId: CORRELATION_ID
  }
}

function errorCount(): number {
  return (db.prepare(
    "SELECT COUNT(*) AS count FROM error_event_log WHERE error_code = 'REPORT_EXPORT_FAILED'"
  ).get() as { count: number }).count
}

class FailNextProjectionInsertAdapter implements DBAdapter {
  private failNext = true

  constructor(private readonly delegate: DBAdapter) {}

  prepare(sql: string): DBStatement {
    const statement = this.delegate.prepare(sql)
    if (!this.failNext || !sql.toUpperCase().includes('INSERT INTO DOMAIN_EVENT_PROJECTION')) {
      return statement
    }
    return {
      run: () => {
        this.failNext = false
        throw new Error('injected SQLite projection failure')
      },
      get: statement.get,
      all: statement.all
    }
  }

  transaction<T>(fn: () => T): () => T {
    return this.delegate.transaction(fn)
  }

  immediateTransaction<T>(fn: () => T): () => T {
    return this.delegate.immediateTransaction(fn)
  }

  exec(sql: string): void {
    this.delegate.exec(sql)
  }
}

describe('report export partial-failure ownership', () => {
  it('cleans only its temporary file when rename fails', async () => {
    const reportId = seedExportableReport()
    const outputDir = tempDir('svets-report-export-rename-failure-')
    const targetPath = join(outputDir, 'report.html')
    let ownedTempPath = ''
    const port = filePort({
      writeOwnedTemp(path, bytes) {
        ownedTempPath = path
        writeFileSync(path, bytes, { flag: 'wx' })
      },
      renameOwnedTemp() {
        throw new Error('injected rename failure')
      }
    })
    const coordinator = createTestReportCommandCoordinator({
      db,
      actionLogPath: actionLogPath('svets-report-export-rename-log-')
    })

    await expect(completeReportHtmlExport(
      db,
      coordinator,
      completionParams(reportId, targetPath),
      port
    )).rejects.toBeInstanceOf(ReportExportError)

    expect(ownedTempPath).toMatch(/\.tmp$/)
    expect(existsSync(ownedTempPath)).toBe(false)
    expect(existsSync(targetPath)).toBe(false)
    expect(errorCount()).toBe(1)
  })

  it('retains the renamed final artifact and reports an event-append failure', async () => {
    const reportId = seedExportableReport()
    const targetPath = join(tempDir('svets-report-export-append-failure-'), 'report.html')
    const coordinator = createTestReportCommandCoordinator({
      db,
      actionLogPath: actionLogPath('svets-report-export-append-log-'),
      writeEvent: () => {
        throw new Error('injected action-log append failure')
      },
      recoverPending: () => undefined
    })

    await expect(completeReportHtmlExport(
      db,
      coordinator,
      completionParams(reportId, targetPath),
      filePort()
    )).rejects.toBeInstanceOf(ReportExportError)

    expect(existsSync(targetPath)).toBe(true)
    expect(db.prepare('SELECT status, file_asset_id FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'GENERATED', file_asset_id: null })
    expect(errorCount()).toBe(1)
  })

  it('retains the final artifact when SQLite projection fails after JSONL append', async () => {
    const reportId = seedExportableReport()
    const targetPath = join(tempDir('svets-report-export-sqlite-failure-'), 'report.html')
    const faultingDb = new FailNextProjectionInsertAdapter(db)
    const coordinator = createTestReportCommandCoordinator({
      db: faultingDb,
      actionLogPath: actionLogPath('svets-report-export-sqlite-log-')
    })
    const params = {
      ...completionParams(reportId, targetPath),
      prepared: prepareReportHtmlExport(faultingDb, reportId, ISO)
    }

    await expect(completeReportHtmlExport(
      faultingDb,
      coordinator,
      params,
      filePort()
    )).rejects.toBeInstanceOf(ReportExportError)

    expect(existsSync(targetPath)).toBe(true)
    expect(db.prepare('SELECT status, file_asset_id FROM task_report WHERE report_id = ?').get(reportId))
      .toEqual({ status: 'GENERATED', file_asset_id: null })
    expect(errorCount()).toBe(1)
  })

  it('reports cleanup failure and never removes an unrelated artifact', async () => {
    const reportId = seedExportableReport()
    const outputDir = tempDir('svets-report-export-cleanup-failure-')
    const targetPath = join(outputDir, 'report.html')
    const unrelatedPath = join(outputDir, 'keep-me.txt')
    writeFileSync(unrelatedPath, 'unrelated')
    let cleanupPath = ''
    const port = filePort({
      writeOwnedTemp() {
        throw new Error('injected temp write failure')
      },
      cleanupOwnedTemp(path) {
        cleanupPath = path
        throw new Error('injected cleanup failure')
      }
    })
    const coordinator = createTestReportCommandCoordinator({
      db,
      actionLogPath: actionLogPath('svets-report-export-cleanup-log-')
    })

    await expect(completeReportHtmlExport(
      db,
      coordinator,
      completionParams(reportId, targetPath),
      port
    )).rejects.toMatchObject({
      code: 'REPORT_EXPORT_FAILED',
      message: 'Report export failed and temporary-file cleanup was incomplete'
    })

    expect(cleanupPath).toMatch(/\.tmp$/)
    expect(readFileSync(unrelatedPath, 'utf8')).toBe('unrelated')
    expect(errorCount()).toBe(1)
  })

  it('does not overwrite a pre-existing target selected outside this command', async () => {
    const reportId = seedExportableReport()
    const targetPath = join(tempDir('svets-report-export-existing-target-'), 'report.html')
    writeFileSync(targetPath, 'existing-artifact')
    const coordinator = createTestReportCommandCoordinator({
      db,
      actionLogPath: actionLogPath('svets-report-export-existing-log-')
    })

    await expect(completeReportHtmlExport(
      db,
      coordinator,
      completionParams(reportId, targetPath)
    )).rejects.toBeInstanceOf(ReportExportError)

    expect(readFileSync(targetPath, 'utf8')).toBe('existing-artifact')
    expect(errorCount()).toBe(1)
  })

  it('does not overwrite a target created after the initial existence check', async () => {
    const reportId = seedExportableReport()
    const targetPath = join(tempDir('svets-report-export-racing-target-'), 'report.html')
    const base = filePort()
    let firstTargetCheck = true
    const port = filePort({
      exists(path) {
        if (path === targetPath && firstTargetCheck) {
          firstTargetCheck = false
          return false
        }
        return existsSync(path)
      },
      writeOwnedTemp(path, bytes) {
        base.writeOwnedTemp(path, bytes)
        writeFileSync(targetPath, 'racing-artifact', { flag: 'wx' })
      }
    })
    const coordinator = createTestReportCommandCoordinator({
      db,
      actionLogPath: actionLogPath('svets-report-export-racing-log-')
    })

    await expect(completeReportHtmlExport(
      db,
      coordinator,
      completionParams(reportId, targetPath),
      port
    )).rejects.toBeInstanceOf(ReportExportError)

    expect(readFileSync(targetPath, 'utf8')).toBe('racing-artifact')
    expect(errorCount()).toBe(1)
  })
})
