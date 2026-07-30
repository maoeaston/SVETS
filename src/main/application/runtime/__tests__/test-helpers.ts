import { dirname } from 'path'
import type { DBAdapter } from '../../../db/interface'
import {
  ReportCommandCoordinator,
  type ReportMutationPort
} from '../../../domain/report-command-coordinator'
import { createInternalMutationCapability } from '../internal-mutation-capability'
import { createLegacyMutationPort } from '../legacy-mutation-port'

export function createTestReportCommandCoordinator(options: {
  db: DBAdapter
  actionLogPath: string
  writeEvent?: ReportMutationPort['writeEvent']
  recoverPending?: ReportMutationPort['recoverPending']
}): ReportCommandCoordinator {
  const basePort = createLegacyMutationPort({
    db: options.db,
    actionLogPath: options.actionLogPath,
    capability: createInternalMutationCapability({
      owner: 'test:legacy-event-port',
      phase: 'ACCEPTED_MUTATION',
      dataRoot: dirname(options.actionLogPath)
    })
  })
  return new ReportCommandCoordinator({
    db: options.db,
    eventPort: Object.freeze({
      writeEvent: options.writeEvent ?? basePort.writeEvent,
      recoverPending: options.recoverPending ?? basePort.recoverPending
    })
  })
}
