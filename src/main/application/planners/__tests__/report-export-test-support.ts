import { mkdirSync } from 'fs'
import { join } from 'path'
import { DurableCommandStore } from '../../command/durable-command-store'
import { ReportExportPlanner, loadReportExportPlannerSnapshot, prepareReportExportInteraction } from '../report-export-planner'
import {
  REPORT_TEST_APP_VERSION,
  REPORT_TEST_TIME,
  acceptReportCommand,
  createReportBatchHarness,
  seedLegacyReportBusinessState,
  type AcceptedReportCommand,
  type ReportBatchHarness
} from './report-test-support'
import { RuntimeCorruptionState } from '../../../domain/event-batch/runtime-corruption'
import { StartupRecovery } from '../../../domain/event-batch/startup-recovery'
import { FairWriterMutex } from '../../../domain/event-batch/writer-mutex'
import { registerReportExportPreparedFacts } from '../../../domain/projectors/report-export-projector'

export {
  REPORT_TEST_APP_VERSION,
  REPORT_TEST_TIME,
  acceptReportCommand,
  seedLegacyReportBusinessState
}
export type { AcceptedReportCommand, ReportBatchHarness }

export async function createReportExportBatchHarness(options: Parameters<typeof createReportBatchHarness>[0] = {}) {
  return createReportBatchHarness({
    ...options,
    registry: registerReportExportPreparedFacts().seal()
  })
}

export function exportTarget(harness: ReportBatchHarness, name = 'report.html') {
  const artifactRoot = join(harness.root, 'artifacts')
  mkdirSync(artifactRoot, { recursive: true })
  return Object.freeze({ artifactRoot, targetPath: join(artifactRoot, name) })
}

export async function executeReportExport(
  harness: ReportBatchHarness,
  command: AcceptedReportCommand,
  interaction: ReturnType<typeof prepareReportExportInteraction>
) {
  return harness.coordinator.execute({
    envelope: command.envelope,
    readSnapshot: () => loadReportExportPlannerSnapshot(harness.database, command.envelope, {
      timestamp: REPORT_TEST_TIME,
      appVersion: REPORT_TEST_APP_VERSION,
      interaction
    }),
    planner: new ReportExportPlanner()
  })
}

export function recoverReportExport(harness: ReportBatchHarness) {
  return new StartupRecovery({
    database: harness.database,
    commandStore: new DurableCommandStore(harness.database),
    registry: registerReportExportPreparedFacts().seal(),
    fileCapability: harness.capability,
    corruptionState: new RuntimeCorruptionState(),
    workerId: 'report-export-recovery-worker',
    legacyAnchor: null,
    writerMutex: new FairWriterMutex(),
    now: () => new Date('2026-07-29T10:00:31.000Z')
  })
}
