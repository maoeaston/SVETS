# M5B-11 R3 Code Review

## Conclusion

`CONDITIONAL_PASS`.

The test-only implementation freezes all five assignment roots with complete local runtime identity facts, uses insert-only prepared operational effects, and proves both APPLY rollback and post-PREPARE startup recovery. No P0 or unclosed P1 was found in this same-context review.

This is not an independent R3 review: the reviewer also implemented this atomic step. It cannot be promoted to `PASS` or replace the independent final R3 review required by M5B-15.

## Scope And Evidence

- PRD / implementation: `event-batch-v2.2-runtime-prd.md` and `event-batch-v2.2-runtime-impl.md`, Step M5B-11.
- Invariants checked: `INV-EVT-001`, `INV-EVT-003`, `INV-AUTH-001`, `INV-DATA-001`, and `INV-IPC-001`.
- Test-only boundary: `AssignmentPlanner` requires `cloneForPlanning()` and is not connected to production composition, startup, IPC, preload, schema, or the default database.
- Five roots are frozen as prepared facts: create, confirm student, start assessment, rebind grant, and release assignment. The local runtime plan contains organization, node, device, runtime, and hashed-auth facts; the projector rejects malformed or non-hash credential facts.
- `applyLocalRuntimeContextPlan()` only inserts absent identities and compares every existing identity fact before accepting it. A same-ID mismatch rejects the batch and leaves the conflicting row untouched; it does not UPSERT.
- Functional evidence: seven assignment-related test files / 39 tests passed, including create-confirm-start, rebind-release, prepared runtime identity conflict, child APPLY rollback, and `AFTER_PREPARE_FSYNC` startup recovery with `plannerCalls: 0`.
- Boundary evidence: M5B-11 source delta pins exactly five reviewed local-runtime direct calls as prepared effects; inventory/scope checks, typecheck, build, lint, isolated `/tmp` database verification, and `git diff --check` passed.

## Remaining Evidence

- Native Electron, real multi-device contention, manual teacher/student flow, production cutover, and default-database validation are `NOT_RUN` by the explicit M5B-14/15 boundary.
- An independent reviewer must repeat the R3 review before final production acceptance.
