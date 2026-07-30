import type { DBAdapter } from '../../db/interface'
import {
  DurableCommandCoordinator,
  type DurableCommandAccepted,
  type DurableCommandReplayed
} from './durable-command-coordinator'
import type { CommandEnvelopeV2 } from './command-types'

export const M5B_GATE_ONLY_COMMAND_TYPES = Object.freeze([
  'auth:createTeacherAccount',
  'auth:login',
  'auth:logout',
  'auth:setTeacherAccountStatus',
  'student:create',
  'student:update',
  'student:archive',
  'strategy:createVersion',
  'strategy:update',
  'strategy:setActive'
] as const)

export type M5bGateOnlyCommandType = (typeof M5B_GATE_ONLY_COMMAND_TYPES)[number]

export interface GateOnlyApplyContext<ValidatedInput> {
  readonly envelope: CommandEnvelopeV2
  readonly validatedInput: ValidatedInput
}

export type GateOnlyApply<ValidatedInput> = (
  context: GateOnlyApplyContext<ValidatedInput>
) => object

export interface GateOnlyExecutorDependencies {
  readonly database: DBAdapter
  readonly coordinator: DurableCommandCoordinator
}

function isGateOnlyCommand(commandType: string): commandType is M5bGateOnlyCommandType {
  return (M5B_GATE_ONLY_COMMAND_TYPES as readonly string[]).includes(commandType)
}

/**
 * Test-composition-only executor for M5B-7. Production composition remains on
 * M5A until M5B-14; this class deliberately has no IPC/runtime imports.
 */
export class GateOnlyExecutor {
  constructor(private readonly dependencies: GateOnlyExecutorDependencies) {}

  execute<ValidatedInput>(
    accepted: DurableCommandAccepted<ValidatedInput>,
    apply: GateOnlyApply<ValidatedInput>
  ): { row: DurableCommandReplayed['row']; publicResult: DurableCommandReplayed['publicResult'] } {
    if (!isGateOnlyCommand(accepted.envelope.commandType)) {
      throw new Error(`gate-only executor rejects non-gate command ${accepted.envelope.commandType}`)
    }

    return this.dependencies.database.immediateTransaction(() => {
      this.dependencies.coordinator.assertCurrentLease(accepted.envelope)
      const publicResult = apply({
        envelope: accepted.envelope,
        validatedInput: accepted.validatedInput
      })
      return this.dependencies.coordinator.completeWithinTransaction(accepted.envelope, publicResult)
    })()
  }
}
