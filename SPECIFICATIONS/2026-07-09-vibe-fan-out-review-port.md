# Follow-up: port fan-out review synthesis to the `.vibe/` mirror

**Status:** Open
**Raised:** 2026-07-09
**Origin:** Template migration packet `2026-07-fan-out-review-synthesis` (applied to the `.claude/` tree in branch `refactor/adopt-fan-out-reviews`).

## Context

The migration packet removes the reviewers' "collaborative discussion" (debate) phase and replaces it with parallel independent review plus orchestrator-driven synthesis. See the ADR: [`REFERENCE/decisions/2026-07-09-fan-out-review-synthesis.md`](../REFERENCE/decisions/2026-07-09-fan-out-review-synthesis.md).

That packet, and this project's application of it, is scoped to the **`.claude/` (Claude Code) tree only**. This project also maintains a parallel, hand-written port of the review system under **`.vibe/` (Mistral Vibe, AGENTS.md-flavoured)**. That mirror still carries the old debate design.

## What is left to do

The `.vibe/` review system still describes the removed debate phase in:

- `.vibe/agents/security-specialist.md`
- `.vibe/agents/product-reviewer.md`
- `.vibe/agents/architect-reviewer.md`
- `.vibe/agents/technical-writer.md`
- `.vibe/agents/requirements-auditor.md`
- `.vibe/agents/technical-skeptic.md`
- `.vibe/agents/devils-advocate.md`
- `.vibe/skills/review-pr-team/SKILL.md`

(each has a `## Team Collaboration` / `broadcast` section), and likely related timing/wording in `.vibe/skills/review-spec/SKILL.md`, `.vibe/skills/review-pr/SKILL.md`, `.vibe/skills/review-gate.md`, `.vibe/agents/AGENTS.md`, and `.vibe/AGENTS.md`.

## Why it was deferred

Porting is **manual re-authoring**, not a mechanical re-apply: the `.vibe/` files are written in Vibe's own idiom (`skill(name=…)`, `task(agent=…)`) and are older than the `.claude/` versions, so they may have drifted from the template base. The packet's verification commands only grep `.claude/`, so they pass green while `.vibe/` remains on the debate design — green does **not** mean the Vibe tree is migrated.

## Suggested approach

Mirror the same transformation the `.claude/` tree received: replace each `## Team Collaboration` section with `## Reporting to the orchestrator`, restructure the team/spec review skills from three phases to two (independent review → orchestrator synthesis), and correct the 2–7 min timing to 2–4 min — all rewritten in Vibe's idiom. Treat it as its own PR with its own review.
