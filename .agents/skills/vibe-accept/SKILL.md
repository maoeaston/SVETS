---
name: vibe-accept
description: Use after an implementation step or before commit, pull request, merge, or release to run evidence-based project validation and report PASS, FAIL, NOT_RUN, or BLOCKED without overstating unexecuted checks.
---

# Vibe Acceptance

Before validating, read:

1. `AGENTS.md`
2. `doc/specs/baseline.yaml`
3. `doc/specs/project-invariants.md`
4. `doc/ai/vibe-workflow-contract.md`
5. `vibe-coding-skills-v2/commands/vibe-accept.md`
6. Current package scripts, CI workflow, git status, and git diff

Treat the user's current request as the validation mode or scope.

Follow `vibe-coding-skills-v2/commands/vibe-accept.md` as the authoritative procedure.

Never report an unexecuted manual check as passed. Validation success does not authorize commit, push, merge, deletion, database reset, or release.
