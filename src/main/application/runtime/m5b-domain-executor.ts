import type { DBAdapter } from '../../db/interface'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import {
  EventBatchCoordinator,
  type EventBatchExecutionResult
} from '../../domain/event-batch/batch-coordinator'
import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import type { PreparedProjectorContext } from '../../domain/event-batch/result-registry'
import type { ReportExportInteraction } from '../planners/report-export-planner'
import {
  AssessmentPlanner,
  loadAssessmentPlannerSnapshot
} from '../planners/assessment-planner'
import {
  AssignmentPlanner,
  loadAssignmentPlannerSnapshot
} from '../planners/assignment-planner'
import {
  ReportExportPlanner,
  loadReportExportPlannerSnapshot
} from '../planners/report-export-planner'
import {
  ReportPlanner,
  loadReportPlannerSnapshot
} from '../planners/report-planner'
import {
  SafetyPlanner,
  loadSafetyPlannerSnapshot
} from '../planners/safety-planner'
import {
  ScoringPlanner,
  loadScoringPlannerSnapshot
} from '../planners/scoring-planner'
import {
  TaskClosurePlanner,
  loadTaskClosurePlannerSnapshot
} from '../planners/task-closure-planner'
import {
  TrainingPlanner,
  loadTrainingPlannerSnapshot
} from '../planners/training-planner'
import {
  DurableCommandCoordinator,
  PRE_PONR_EXECUTION_ERROR_CODE,
  type DurableCommandAccepted,
  type DurableCommandAcceptance
} from '../command/durable-command-coordinator'
import { GateOnlyExecutor, M5B_GATE_ONLY_COMMAND_TYPES } from '../command/gate-only-executor'
import { applyGateOnlyCommand } from '../command/gate-only-command-apply'
import type { CommandEnvelopeV2 } from '../command/command-types'

const M5B_RUNTIME_APP_VERSION = '0.1.18-event-batch-v2.2'

const ASSESSMENT_COMMANDS = new Set([
  'assessment:abortSession',
  'assessment:calculateResult',
  'assessment:createSession',
  'assessment:emotionInterrupt',
  'assessment:emotionResume',
  'assessment:pauseSitting',
  'assessment:recordEmotionCollapse',
  'assessment:startNextSitting',
  'assessment:startSession',
  'assessment:submitAnswer'
])
const TRAINING_COMMANDS = new Set([
  'training:completeStep',
  'training:createSession',
  'training:failStep',
  'training:retryStep',
  'training:skipStep',
  'training:startStep'
])
const SCORING_COMMANDS = new Set([
  'assessment:recordTeacherObservation',
  'assessment:submitJobSkillOfflineScores',
  'assessment:submitOfflineAbilityScores',
  'assessment:submitOperationScores'
])
const ASSIGNMENT_COMMANDS = new Set([
  'assignment:confirmStudent',
  'assignment:create',
  'assignment:rebind',
  'assignment:release',
  'assignment:startAssessment'
])
const REPORT_COMMANDS = new Set([
  'reports:confirmPlacementReview',
  'reports:generate',
  'reports:lock'
])
const CLOSURE_COMMANDS = new Set([
  'reports:confirmTaskClosure',
  'reports:replaceTaskClosure'
])
const SAFETY_COMMANDS = new Set([
  'assessment:triggerRedline',
  'safety:confirm',
  'safety:replaceForFactualCorrection',
  'safety:resolve',
  'safety:void'
])

export type M5bMutationExecution = Readonly<{
  publicResult: Readonly<Record<string, CanonicalJsonValue>>
  batch: EventBatchExecutionResult['batch']
}>

export interface M5bDomainExecutorDependencies {
  readonly database: DBAdapter
  readonly durableCoordinator: DurableCommandCoordinator
  readonly batchCoordinator: EventBatchCoordinator
}

function timestamp(envelope: CommandEnvelopeV2): string {
  return envelope.createdAt
}

/**
 * Sole production dispatcher for the 36 prepared BATCH_DOMAIN mutations and
 * the ten durable gate-only mutations. No branch calls the legacy event port.
 */
export class M5bDomainExecutor {
  private readonly gates: GateOnlyExecutor

  constructor(private readonly dependencies: M5bDomainExecutorDependencies) {
    this.gates = new GateOnlyExecutor({
      database: dependencies.database,
      coordinator: dependencies.durableCoordinator
    })
  }

  accept<RawInput, ValidatedInput>(request: {
    commandType: string
    rawInput: RawInput
    transport: { source: 'IPC'; transportId: string }
    transportMetadata: unknown
  }): Promise<DurableCommandAcceptance<ValidatedInput>> {
    return this.dependencies.durableCoordinator.accept<RawInput, ValidatedInput>(request)
  }

  failRetryableBeforePrepare<ValidatedInput>(accepted: DurableCommandAccepted<ValidatedInput>): void {
    this.dependencies.durableCoordinator.failRetryableBeforePrepare(
      accepted.envelope,
      PRE_PONR_EXECUTION_ERROR_CODE
    )
  }

  async execute<ValidatedInput>(options: {
    accepted: DurableCommandAccepted<ValidatedInput>
    senderId: number
    reportExportInteraction?: ReportExportInteraction
  }): Promise<M5bMutationExecution> {
    const { accepted } = options
    const { envelope } = accepted
    if ((M5B_GATE_ONLY_COMMAND_TYPES as readonly string[]).includes(envelope.commandType)) {
      try {
        const completed = this.gates.execute(accepted, ({ envelope: gateEnvelope }) =>
          applyGateOnlyCommand(this.dependencies.database, gateEnvelope, { senderId: options.senderId })
        )
        return Object.freeze({ publicResult: completed.publicResult, batch: null })
      } catch (error) {
        this.failRetryableBeforePrepare(accepted)
        throw error
      }
    }

    const result = await this.executeBatch(envelope, options.reportExportInteraction)
    return Object.freeze({ publicResult: result.publicResult, batch: result.batch })
  }

  private async executeBatch(
    envelope: CommandEnvelopeV2,
    reportExportInteraction: ReportExportInteraction | undefined
  ): Promise<EventBatchExecutionResult> {
    const common = { timestamp: timestamp(envelope), appVersion: M5B_RUNTIME_APP_VERSION }
    if (ASSESSMENT_COMMANDS.has(envelope.commandType)) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadAssessmentPlannerSnapshot(this.dependencies.database, envelope, common),
        planner: new AssessmentPlanner()
      })
    }
    if (TRAINING_COMMANDS.has(envelope.commandType)) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadTrainingPlannerSnapshot(this.dependencies.database, envelope, common),
        planner: new TrainingPlanner()
      })
    }
    if (SCORING_COMMANDS.has(envelope.commandType)) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadScoringPlannerSnapshot(this.dependencies.database, envelope, common),
        planner: new ScoringPlanner()
      })
    }
    if (ASSIGNMENT_COMMANDS.has(envelope.commandType)) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadAssignmentPlannerSnapshot(this.dependencies.database, envelope, common),
        planner: new AssignmentPlanner()
      })
    }
    if (REPORT_COMMANDS.has(envelope.commandType)) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadReportPlannerSnapshot(this.dependencies.database, envelope, common),
        planner: new ReportPlanner()
      })
    }
    if (CLOSURE_COMMANDS.has(envelope.commandType)) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadTaskClosurePlannerSnapshot(this.dependencies.database, envelope, common),
        planner: new TaskClosurePlanner()
      })
    }
    if (SAFETY_COMMANDS.has(envelope.commandType)) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadSafetyPlannerSnapshot(this.dependencies.database, envelope, common),
        planner: new SafetyPlanner()
      })
    }
    if (envelope.commandType === 'reports:export' && reportExportInteraction) {
      return this.dependencies.batchCoordinator.execute({
        envelope,
        readSnapshot: () => loadReportExportPlannerSnapshot(this.dependencies.database, envelope, {
          ...common,
          interaction: reportExportInteraction
        }),
        planner: new ReportExportPlanner()
      })
    }
    throw new Error(`M5B runtime has no BATCH_DOMAIN executor for ${envelope.commandType}`)
  }
}

export function projectM5bAssessmentSessionStarted(context: PreparedProjectorContext): void {
  applyAssessmentEvent(context.database, context.event.record as unknown as Parameters<typeof applyAssessmentEvent>[1])
}
