import type { DBAdapter } from '../../db/interface'
import { writeEvent } from '../../domain/event-writer'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import { reconcileActionLog } from '../../domain/recovery'
import {
  assertInternalMutationCapability,
  type InternalMutationCapability
} from './internal-mutation-capability'

export type LegacyMutationPort = ReportMutationPort

export function createLegacyMutationPort(options: {
  db: DBAdapter
  actionLogPath: string
  capability: InternalMutationCapability
}): LegacyMutationPort {
  assertInternalMutationCapability(options.capability, 'ACCEPTED_MUTATION')
  return Object.freeze({
    writeEvent(params) {
      return writeEvent({
        ...params,
        database: options.db,
        actionLogPath: options.actionLogPath
      })
    },
    recoverPending() {
      reconcileActionLog(options.db, { logPath: options.actionLogPath })
    }
  })
}
