# M5B-9 Independent R3 Review and Acceptance

**Date:** 2026-07-30
**Reviewer:** Independent R3 review context (not the M5B-9 implementation context)
**Scope:** M5B-9 non-redline assessment planners/projectors, prepared facts, assessment FSM/order, M4 safety read gate, result semantics, and test-only boundary.
**Risk:** R3 (`EVENT_PROJECTION`, `SAFETY_FSM`, core result calculation and replay).

## Initial Code Review Conclusion (Historical)

`BLOCKED`.

One P0 and one P1 are open. M5B-10, M5B-11 and M5B-13 remain blocked. This review changes no M5B implementation code.

## P0

### [M5B-9-R3-P0-01] SESSION_STARTED re-reads mutable question-bank facts after PONR

- **Location:** `src/main/application/planners/assessment-planner.ts:291-345`; `src/shared/types/event-payloads.ts:642-654`; `src/main/domain/projectors/assessment-projector.ts:112-115`; `src/main/domain/assessment-reducer.ts:428-471`.
- **Evidence:** The create-session planner stores question IDs and a limited online view in the v2 event. The prepared projector delegates directly to the legacy reducer. That reducer looks up `question_bank` during APPLY to obtain `bank_domain`, `module_type`, `question_type`, `item_usage` and `job_module_code`, and derives the phase from those live values instead of durable event facts.
- **Trigger:** Plan and fsync a `SESSION_STARTED` batch; before APPLY or startup recovery, disable a selected question or otherwise alter a question-bank value that can affect the session-question projection. The schema explicitly permits `ACTIVE -> DISABLED` while freezing semantic fields (`src/main/db/schema.sql:2212-2235`), but its session-question insert trigger requires the current question row to be `ACTIVE` (`src/main/db/schema.sql:2276-2294`).
- **Impact:** A durable PREPARE can no longer be applied/recovered without current source state. It can fail after PONR, leave a batch requiring recovery, or produce a different session-question snapshot if allowed source fields differ. This contradicts the M5B-9 requirement to freeze create/question facts and replay prepared events without current-state re-decision (`doc/features/event-batch-v2.2-runtime-impl.md:745-776`; `doc/features/event-batch-v2.2-runtime-prd.md:226-254`).
- **Violation:** `INV-EVT-001`, `INV-EVT-002`, `INV-EVT-003`, plus the M5B-9 prepared facts/replay contract.
- **Minimal repair:** Extend the versioned `SESSION_STARTED` prepared payload and its validator with the complete per-session-question snapshot needed by projection. The v2 projector/reducer path must consume those durable facts rather than query `question_bank`. Resolve the deliberate schema status gate in the same design: prepared/recovery projection must have a valid, explicit historical path or reject before PONR; it cannot silently rely on a live `ACTIVE` row after PREPARE. Do not weaken normal live-session validation or change production schema/startup composition in this M5B-9 repair.
- **Required regressions:** Add a fault-injector test that mutates/disables a selected question at `AFTER_PREPARE_FSYNC`, then proves no planner re-run and a deterministic prepared recovery result. Cover base-ability online/offline and job-skill observation snapshots, exact payload validation, and M4 safety behavior. The test must run on the test-only composition and isolated temporary database only.

## P1

### [M5B-9-R3-P1-01] Default parallel static regression is not stable

- **Location:** `scripts/__tests__/m5b-runtime-inventory.test.mjs:492-515`.
- **Evidence:** `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs` ran with the project default worker setting and failed two M5B-8/M5B-9 fixture-output assertions (`expected '' to contain 'source_delta=verified'`). Each fixture script independently exits 0 and prints the expected output, and the inventory test passes when constrained to one worker. The default validation command is therefore not a stable gate.
- **Impact:** The required source-delta validation cannot be trusted when run in the ordinary project test mode; a green serial run does not prove the normal command is reliable.
- **Minimal repair:** Determine and remove the parallel interaction, or make this static fixture verification hermetic so its result does not depend on sibling test workers. Preserve the frozen fixture hashes and fail-closed behavior.
- **Required regression:** Run the two-file command under the package default worker configuration repeatedly enough to demonstrate deterministic pass, then keep the constrained single-worker run only as diagnostic evidence rather than the acceptance command.

## Verified Key Items

| Item | Status | Evidence |
|---|---|---|
| Assessment FSM/event ordering | PASS | Existing planner/projector tests cover ten command paths, including start/collapse/result multi-event ordering; the exact suite passed 92 tests. |
| M4 safety read gate | PASS | `assessment-planner.ts:270-274` checks `student_id + job_code + task_code` for unresolved incidents before creating a session, matching `INV-SAFE-003`. |
| Safety result semantics | PASS | A frozen `REDLINE_HALTED` session produces a `LEVEL_FAIL_BY_SAFETY` ability result in `assessment-projector.test.ts`; the exact suite passed. |
| Test-only boundary | PASS | Current M5B-9 source/scope gates passed with zero scope violations. No production composition, schema/startup, IPC/preload or default-database access was introduced. |
| Question snapshot/replay | FAIL | P0-01. |
| Static source-delta gate | FAIL | P1-01 under the package default worker configuration. |

## Executed Checks

| Check | Status | Evidence |
|---|---|---|
| Assessment regression | PASS | `npm test -- src/main/application/planners/__tests__/assessment-planner.test.ts src/main/domain/projectors/__tests__/assessment-projector.test.ts src/main/application/services/__tests__/assessment-command-bus.test.ts src/main/ipc/handlers/__tests__/assessment-create.test.ts src/main/ipc/handlers/__tests__/assessment-answer.test.ts src/main/ipc/handlers/__tests__/assessment-emotion.test.ts src/main/ipc/handlers/__tests__/assessment-start-session.test.ts` -> 7 files, 92 tests passed. |
| M5B inventory/scope | PASS | `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-9` and `npm run contract:m5b:scope:check -- --step M5B-9` passed; scope violations=0. |
| Static regression pair | FAIL | `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs` -> 2 failed assertions described in P1-01. The serial diagnostic run is PASS but does not close this gate. |
| Type and lint | PASS | `npm run typecheck` passed. `npm run lint` exited 0 with 661 pre-existing Vue formatting warnings and 0 errors. |
| Whitespace | PASS | `git diff --check` passed. |
| Electron/native/manual workflow | NOT_RUN | M5B-9 is not attached to production composition before M5B-14; no Electron or default-database flow was run. |

## Initial Evidence-Based Accept (Historical)

`FAIL` because P0-01 and P1-01 are open. The 92 passing assessment tests do not cover source mutation after PREPARE and cannot override the code-path evidence.

## Applicable Invariants

- `INV-EVT-001`, `INV-EVT-002`, `INV-EVT-003`.
- `INV-SAFE-001`, `INV-SAFE-003`.
- `INV-RES-001`, `INV-RES-002`.
- `INV-STR-001`, `INV-STR-002`.

## Initial Next Step

Return only M5B-9 to the implementation context. Repair P0-01 and P1-01 in the test-only boundary, rerun the listed checks, then request a new independent R3 review. Do not begin M5B-10 or later work and do not connect production composition, schema/startup, IPC/preload, or the default database.

## Repair R3 Re-review

**Date:** 2026-07-30
**Reviewer:** Independent re-review context, separate from the M5B-9 implementation context
**Scope:** Verify closure of P0-01 and P1-01 only, plus the M5B-9 test-only and scope boundaries.

### Code Review Conclusion

`PASS`. No open P0 or P1 was found in the repaired M5B-9 scope.

### P0-01 Closure

- `assessment-planner.ts:112-143,293-389` freezes deterministic session-question IDs, order, phase, domain/module, type, usage and job-module facts before PREPARE.
- `assessment-projector.ts:84-173` rejects incomplete or inconsistent v2 question snapshots before projection, including mismatched `question_ids` or online-result facts.
- `assessment-projector.ts:201-203,292-305` refuses to fall back to the legacy reducer for v2 `SESSION_STARTED` without an explicit frozen-facts projector.
- The test-only projector in `assessment-test-support.ts:35-200` registers exact prepared facts before inserting the session-question projection. It changes only the temporary test database trigger and leaves production composition/schema/startup unconnected.
- `assessment-projector.test.ts:282-352` injects failure after PREPARE fsync, disables a selected live question, then verifies recovery applies the durable facts, preserves the disabled source row, and makes zero planner calls.

### P1-01 Closure

- `m5b-runtime-inventory.test.mjs:494-505` invokes the exported M5B-8/M5B-9 source-delta validators within the Vitest worker instead of asserting subprocess stdout.
- `update-m5b-step8-fixture.mjs:46-116` and `update-m5b-step9-fixture.mjs:39-93` expose the validation functions while retaining frozen-hash and fail-closed checks.
- The default-worker two-file regression command passed: 2 files / 33 tests.

### Executed Checks

| Check | Status | Evidence |
|---|---|---|
| M5B-9 assessment regression | PASS | Exact seven-file command: 7 files / 95 tests. |
| M5B inventory and scope regressions | PASS | `npm test -- scripts/__tests__/m5b-runtime-inventory.test.mjs scripts/__tests__/m5b-contract-scope.test.mjs`: 2 files / 33 tests. |
| M5B-9 migration inventory | PASS | `npm run contract:m5b:event-batch:check -- --mode migration --step M5B-9`: 75 channels, 36 `BATCH_DOMAIN`, 10 `GATE_ONLY`, pending `15 / 1 / 43 / 8`. |
| M5B-9 scope | PASS | `npm run contract:m5b:scope:check -- --step M5B-9`: preserved=757, M5B changes=127, violations=0. |
| Isolated coordinator/recovery | PASS | `npm run db:m5b:isolated:verify -- --stage coordinator`; temporary root removed after pass. |
| TypeScript | PASS | `npm run typecheck` exited 0. |
| lint | PASS | `npm run lint` exited 0; existing Vue formatting warnings remain. |
| Whitespace | PASS | `git diff --check` exited 0. |

### Residual Risk

- Native Electron, real multi-connection contention, production composition/schema/startup and manual user workflow remain `NOT_RUN` by design before M5B-14. This re-review does not authorize production cutover.
- The explicit no-adapter rejection is source-reviewed; recovery behavior is covered through the test-only frozen-facts adapter.

### Evidence-Based Accept

`AUTOMATION_PASS_MANUAL_PENDING`.

The repaired code review and all applicable automated M5B-9 checks are `PASS`. Required native/manual work is still `NOT_RUN`, not represented as passed.
