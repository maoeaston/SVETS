import { afterEach, describe, expect, it } from 'vitest'
import {
  assertF7WriteAllowed,
  blockF7Writes,
  clearF7WriteBlockAfterRecovery,
  f7WriteAreaForEvent,
  ReportWriteBlockedError
} from '../report-write-gate'

afterEach(() => {
  clearF7WriteBlockAfterRecovery()
})

describe('F7 report write gate', () => {
  it('maps closure, result, report, and safety mutations to the shared gate', () => {
    expect(f7WriteAreaForEvent('TASK_CLOSURE', 'TASK_CLOSURE_CONFIRMED')).toBe('TASK_CLOSURE')
    expect(f7WriteAreaForEvent('ASSESSMENT_SESSION', 'RESULT_CALCULATED')).toBe('RESULT')
    expect(f7WriteAreaForEvent('TASK_REPORT', 'REPORT_LOCKED')).toBe('TASK_REPORT')
    expect(f7WriteAreaForEvent('SAFETY_INCIDENT', 'SAFETY_INCIDENT_VOIDED')).toBe('SAFETY_INCIDENT')
    expect(f7WriteAreaForEvent('ASSESSMENT_SESSION', 'ANSWER_SUBMITTED')).toBeNull()
  })

  it('does not reopen writes until recovery explicitly clears the block', () => {
    blockF7Writes(new Error('pending schema-v2 event'))
    expect(() => assertF7WriteAllowed('TASK_CLOSURE')).toThrow(ReportWriteBlockedError)
    expect(() => assertF7WriteAllowed('RESULT')).toThrow(ReportWriteBlockedError)
    expect(() => assertF7WriteAllowed('TASK_REPORT')).toThrow(ReportWriteBlockedError)
    expect(() => assertF7WriteAllowed('SAFETY_INCIDENT')).toThrow(ReportWriteBlockedError)
    clearF7WriteBlockAfterRecovery()
    expect(() => assertF7WriteAllowed('TASK_REPORT')).not.toThrow()
  })
})
