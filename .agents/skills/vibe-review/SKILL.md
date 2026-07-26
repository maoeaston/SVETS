---
name: vibe-review
description: Use for evidence-based independent review of a PRD, implementation plan, code diff, migration, schema change, safety logic, or other high-risk project artifact.
---

# Vibe Review

Before reviewing, read:

1. `AGENTS.md`
2. `doc/specs/baseline.yaml`
3. `doc/specs/project-invariants.md`
4. `doc/ai/vibe-workflow-contract.md`
5. `vibe-coding-skills-v2/commands/vibe-review.md`
6. The actual review target
7. The real git diff and relevant tests when reviewing code

Treat the user's current request as the review type and scope.

Follow `vibe-coding-skills-v2/commands/vibe-review.md` as the authoritative procedure.

Every finding must be supported by a file path, line range, diff hunk, command output, or specific design section. Do not manufacture findings merely to satisfy the reviewer role.
