import type { AbilityScoringErrorCode } from '@shared/types/ability-scoring'
import type { AssessmentErrorCode } from '@shared/types/assessment'
import type { AssignmentErrorCode } from '@shared/types/assignment'
import type { CurrentSessionError, LoginError, LogoutError } from '@shared/types/auth'
import type { JobSkillScoringErrorCode } from '@shared/types/job-skill-scoring'
import type { OperationScoringErrorCode } from '@shared/types/operation-scoring'
import type { ReportErrorCode } from '@shared/types/report'
import type { SafetyIncidentErrorCode } from '@shared/types/safety-incident'
import type { StrategyErrorCode } from '@shared/types/strategy'
import type { StudentErrorCode } from '@shared/types/student'
import type { TeacherObservationErrorCode } from '@shared/types/teacher-observation'
import type { TrainingErrorCode } from '@shared/types/training'
import {
  COMMAND_PREFLIGHT_REASONS,
  type CommandPreflightReason,
  type PreflightErrorDetailMap,
  type PreflightErrorMap
} from './command-types'

type AuthErrorCode = LoginError['errorCode'] | CurrentSessionError['errorCode'] | LogoutError['errorCode']

export type PublicCommandErrorCode =
  | AuthErrorCode
  | StudentErrorCode
  | StrategyErrorCode
  | AssessmentErrorCode
  | AbilityScoringErrorCode
  | OperationScoringErrorCode
  | JobSkillScoringErrorCode
  | TeacherObservationErrorCode
  | TrainingErrorCode
  | AssignmentErrorCode
  | SafetyIncidentErrorCode
  | ReportErrorCode

export type PublicErrorFamily =
  | 'AUTH_STUDENT_STRATEGY'
  | 'ASSESSMENT_SCORING'
  | 'TRAINING'
  | 'ASSIGNMENT'
  | 'SAFETY'
  | 'REPORT'

export const PUBLIC_ERROR_FAMILY_DEFAULT = Object.freeze({
  AUTH_STUDENT_STRATEGY: 'SYSTEM_ERROR',
  ASSESSMENT_SCORING: 'ASSESSMENT_SYSTEM_ERROR',
  TRAINING: 'TRAINING_SYSTEM_ERROR',
  ASSIGNMENT: 'ASSIGNMENT_SYSTEM_ERROR',
  SAFETY: 'SAFETY_SYSTEM_ERROR',
  REPORT: 'REPORT_SYSTEM_ERROR'
} satisfies Record<PublicErrorFamily, PublicCommandErrorCode>)

export function createPreflightErrorMap<ErrorCode extends PublicCommandErrorCode>(
  defaultErrorCode: ErrorCode,
  overrides: Partial<Record<CommandPreflightReason, ErrorCode>> = {}
): PreflightErrorMap<ErrorCode> {
  return Object.freeze(Object.fromEntries(
    COMMAND_PREFLIGHT_REASONS.map((reason) => [reason, overrides[reason] ?? defaultErrorCode])
  ) as Record<CommandPreflightReason, ErrorCode>)
}

export function assertPublicErrorMap<ErrorCode extends string>(
  map: PreflightErrorMap<ErrorCode>,
  allowedCodes: readonly ErrorCode[]
): void {
  const allowed = new Set(allowedCodes)
  for (const reason of COMMAND_PREFLIGHT_REASONS) {
    const errorCode = map[reason]
    if (typeof errorCode !== 'string' || !errorCode || !allowed.has(errorCode)) {
      throw new Error(`preflight_error_map.${reason} must use a declared public error code`)
    }
  }
}

export function assertPublicErrorDetailMap<ErrorCode extends string>(
  map: PreflightErrorDetailMap<ErrorCode> | undefined,
  allowedCodes: readonly ErrorCode[]
): void {
  if (!map) return
  const allowedReasons = new Set<string>(COMMAND_PREFLIGHT_REASONS)
  const allowed = new Set(allowedCodes)
  for (const [reason, details] of Object.entries(map)) {
    if (!allowedReasons.has(reason)) {
      throw new Error(`preflight_error_detail_map.${reason} uses an unknown reason`)
    }
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      throw new Error(`preflight_error_detail_map.${reason} must be an object`)
    }
    for (const [detail, errorCode] of Object.entries(details)) {
      if (!detail.trim() || typeof errorCode !== 'string' || !errorCode || !allowed.has(errorCode as ErrorCode)) {
        throw new Error(`preflight_error_detail_map.${reason}.${detail || '<empty>'} must use a declared public error code`)
      }
    }
  }
}
