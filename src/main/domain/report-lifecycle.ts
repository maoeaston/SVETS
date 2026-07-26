/**
 * Schema-v2 report lifecycle rules shared by payload validation and projection.
 * Keeping these checks in one module prevents an appendable event from being
 * rejected only after it reaches the reducer.
 */
export const REPORT_EXPORT_STATUS_BEFORE = ['GENERATED', 'EXPORTED', 'LOCKED'] as const
export const REPORT_EXPORT_STATUS_AFTER = ['EXPORTED', 'LOCKED'] as const
export const SAFETY_VOID_REASONS = ['FALSE_TRIGGER', 'DUPLICATE_RECORD', 'NON_SAFETY_EVENT'] as const

export function isAllowedTaskClosureConfirmedState(status: string | null, isCycleHead: boolean | null): boolean {
  return status === 'CONFIRMED' && isCycleHead === true
}

export function isAllowedTaskClosureReplacementState(status: string | null, isCycleHead: boolean | null): boolean {
  return (status === 'CONFIRMED' && isCycleHead === true)
    || (status === 'SUPERSEDED' && isCycleHead === false)
}

export function isAllowedReportExportTransition(statusBefore: string | null, statusAfter: string | null): boolean {
  return (statusBefore === 'GENERATED' || statusBefore === 'EXPORTED')
    ? statusAfter === 'EXPORTED'
    : statusBefore === 'LOCKED' && statusAfter === 'LOCKED'
}
