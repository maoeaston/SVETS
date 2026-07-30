import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createEventBatchFaultInjectorForTests } from '../../../domain/event-batch/fault-injection'
import { prepareReportHtmlExport } from '../../../domain/report-export'
import {
  ReportExportPlanner,
  completeReportExportCancellation,
  loadReportExportPlannerSnapshot,
  prepareReportExportInteraction
} from '../report-export-planner'
import {
  REPORT_TEST_APP_VERSION,
  REPORT_TEST_TIME,
  acceptReportCommand,
  createReportExportBatchHarness,
  executeReportExport,
  exportTarget,
  recoverReportExport,
  seedLegacyReportBusinessState,
  type ReportBatchHarness
} from './report-export-test-support'

const harnesses: ReportBatchHarness[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close()
})

function reportTarget(reportId: string): Record<string, unknown> {
  return { aggregate_type: 'TASK_REPORT', report_id: reportId }
}

describe('M5B-13 report export planner', () => {
  it('freezes HTML bytes and a pre-APPLY artifact effect without mutating the source database', async () => {
    const harness = await createReportExportBatchHarness()
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 81, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })
    const target = exportTarget(harness)
    const interaction = prepareReportExportInteraction(command.envelope, target)

    const snapshot = await loadReportExportPlannerSnapshot(harness.database, command.envelope, {
      timestamp: REPORT_TEST_TIME,
      appVersion: REPORT_TEST_APP_VERSION,
      interaction
    })
    const plan = new ReportExportPlanner().plan({ envelope: command.envelope, snapshot })

    expect(plan).toMatchObject({
      commandType: 'reports:export',
      events: [expect.objectContaining({ eventType: 'REPORT_EXPORTED' })],
      preApplyEffects: [expect.objectContaining({ effectType: 'REPORT_ARTIFACT_PUBLISH' })]
    })
    expect(plan.events[0]?.payload.artifact).toMatchObject({
      schema_version: 'report-export-artifact-v1',
      file_hash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(existsSync(target.targetPath)).toBe(false)
    expect(harness.database.prepare('SELECT status, file_asset_id FROM task_report WHERE report_id = ?').get(seeded.reportId))
      .toEqual({ status: 'GENERATED', file_asset_id: null })
  })

  it('keeps the prepared artifact byte-for-byte equal to the established report HTML builder', async () => {
    const harness = await createReportExportBatchHarness()
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 85, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })
    const target = exportTarget(harness)
    const interaction = prepareReportExportInteraction(command.envelope, target)
    const established = prepareReportHtmlExport(harness.database, seeded.reportId, REPORT_TEST_TIME)
    const snapshot = await loadReportExportPlannerSnapshot(harness.database, command.envelope, {
      timestamp: REPORT_TEST_TIME,
      appVersion: REPORT_TEST_APP_VERSION,
      interaction
    })
    const plan = new ReportExportPlanner().plan({ envelope: command.envelope, snapshot })
    const artifact = plan.events[0]?.payload.artifact as Record<string, unknown>

    expect(Buffer.from(artifact.artifact_bytes_base64 as string, 'base64')).toEqual(established.htmlBytes)
    expect(artifact.file_hash).toBe(established.fileHash)
    expect(artifact.file_size_bytes).toBe(established.fileSizeBytes)
  })

  it('persists a dialog cancellation as a completed result without a batch or artifact', async () => {
    const harness = await createReportExportBatchHarness()
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 86, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })

    const canceled = completeReportExportCancellation({
      commandStore: harness.store,
      envelope: command.envelope,
      completedAt: REPORT_TEST_TIME
    })

    expect(canceled).toMatchObject({ command: { status: 'SUCCEEDED' }, publicResult: { success: true, canceled: true } })
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM applied_event_batch').get()).toEqual({ count: 0 })
    expect(harness.database.prepare(
      "SELECT COUNT(*) AS count FROM domain_event_projection WHERE event_type = 'REPORT_EXPORTED'"
    ).get()).toEqual({ count: 0 })
  })

  it('refuses to complete a cancellation when the accepted envelope has drifted', async () => {
    const harness = await createReportExportBatchHarness()
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 88, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })

    await expect(() => completeReportExportCancellation({
      commandStore: harness.store,
      envelope: { ...command.envelope, deviceId: 'different-device' },
      completedAt: REPORT_TEST_TIME
    })).toThrow(/does not match the current durable command/)
    expect(harness.store.findByCommandId(command.envelope.commandId)).toMatchObject({ status: 'PROCESSING' })
  })

  it('publishes a frozen artifact before APPLY and projects the corresponding REPORT_EXPORTED batch', async () => {
    const harness = await createReportExportBatchHarness()
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 82, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })
    const target = exportTarget(harness)
    const interaction = prepareReportExportInteraction(command.envelope, target)

    const result = await executeReportExport(harness, command, interaction)

    expect(result.publicResult).toMatchObject({ success: true, reportId: seeded.reportId, canceled: false })
    expect(existsSync(target.targetPath)).toBe(true)
    expect(harness.database.prepare('SELECT status, file_path, file_hash FROM task_report WHERE report_id = ?').get(seeded.reportId))
      .toMatchObject({ status: 'EXPORTED', file_path: target.targetPath })
  })

  it('rebuilds a missing PONR artifact during startup recovery without invoking the planner', async () => {
    const harness = await createReportExportBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'BEFORE_APPLY' })
    })
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 83, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })
    const target = exportTarget(harness)
    const interaction = prepareReportExportInteraction(command.envelope, target)

    await expect(executeReportExport(harness, command, interaction)).rejects.toThrow(/BEFORE_APPLY/)
    const frozenBytes = readFileSync(target.targetPath)
    expect(harness.database.prepare('SELECT file_asset_id FROM task_report WHERE report_id = ?').get(seeded.reportId))
      .toEqual({ file_asset_id: null })
    unlinkSync(target.targetPath)

    await expect(recoverReportExport(harness).run()).resolves.toMatchObject({
      appliedBatches: 1,
      appendedCommitted: 1,
      confirmedBatches: 1,
      recoveredResults: 1,
      plannerCalls: 0
    })
    expect(readFileSync(target.targetPath)).toEqual(frozenBytes)
    expect(harness.database.prepare('SELECT status, file_path FROM task_report WHERE report_id = ?').get(seeded.reportId))
      .toEqual({ status: 'EXPORTED', file_path: target.targetPath })
  })

  it('rejects a target that appears with different bytes after PREPARE and leaves it untouched', async () => {
    let targetPath = ''
    const harness = await createReportExportBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({
        failAt: null,
        onHit: (point) => {
          if (point === 'AFTER_PREPARE_FSYNC') writeFileSync(targetPath, 'external artifact', { flag: 'wx' })
        }
      })
    })
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 84, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })
    const target = exportTarget(harness)
    targetPath = target.targetPath
    const interaction = prepareReportExportInteraction(command.envelope, target)

    await expect(executeReportExport(harness, command, interaction)).rejects.toThrow(/artifact target/i)
    expect(readFileSync(target.targetPath, 'utf8')).toBe('external artifact')
    expect(harness.database.prepare('SELECT file_asset_id FROM task_report WHERE report_id = ?').get(seeded.reportId))
      .toEqual({ file_asset_id: null })
  })

  it('rejects a target replaced by a symlink after PREPARE without touching its referent', async () => {
    let targetPath = ''
    let externalPath = ''
    const harness = await createReportExportBatchHarness({
      faultInjector: createEventBatchFaultInjectorForTests({
        failAt: null,
        onHit: (point) => {
          if (point === 'AFTER_PREPARE_FSYNC') {
            externalPath = `${targetPath}.external`
            writeFileSync(externalPath, 'external artifact')
            symlinkSync(externalPath, targetPath)
          }
        }
      })
    })
    harnesses.push(harness)
    const seeded = await seedLegacyReportBusinessState(harness)
    const command = acceptReportCommand({
      harness, slot: 87, commandType: 'reports:export', actorId: seeded.teacherId,
      target: reportTarget(seeded.reportId)
    })
    const target = exportTarget(harness)
    targetPath = target.targetPath
    const interaction = prepareReportExportInteraction(command.envelope, target)

    await expect(executeReportExport(harness, command, interaction)).rejects.toThrow(/artifact target/i)
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true)
    expect(readFileSync(externalPath, 'utf8')).toBe('external artifact')
    expect(harness.database.prepare('SELECT file_asset_id FROM task_report WHERE report_id = ?').get(seeded.reportId))
      .toEqual({ file_asset_id: null })
  })
})
