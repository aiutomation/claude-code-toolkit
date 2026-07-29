---
name: apply-improvements
description: Apply pending end-of-session self-improvement reviews. Reads capture files in ~/.claude/improvements/pending/, audits the session across CLAUDE.md, memory, skills, hooks, and plugins, proposes concrete config edits, applies only what the user approves, then archives the capture. Use when the user types /apply-improvements, says "apply session improvements", "process my session reviews", "run the self-improvement loop", "review what we learned", or when a SessionStart reminder flags pending reviews.
---

# Apply Improvements — the review step of the capture→review self-improvement loop

This is the review half of a capture-now/review-next loop. This plugin's `SessionEnd` hook
already captured the raw material of past sessions into `~/.claude/improvements/pending/`.
This skill turns that raw material into **approved** config improvements. The capture step did
no thinking — all judgement lives here.

## Steps

1. **Find pending captures + triage the backlog.** List `~/.claude/improvements/pending/*.md` (newest first).
   - None → tell the user the queue is empty, stop.
   - One → process it (steps 2–6).
   - **Many (backlog)** → do a fast first pass FIRST: open each capture's git signals (cheap, no transcript read) and split into two piles:
     - **Trivial** (clean/no tracked changes, tiny work, or a session you already learned from) → batch-archive straight to `done/` without proposing edits; just list them so the user sees what you dismissed.
     - **Substantive** (real commits, repeated friction, corrections) → deep-audit these in steps 2–4.
     This keeps a 10+ item queue tractable: most captures yield nothing durable; spend the thinking on the few that do.

2. **Read the capture + its transcript.** Open the capture file. If its `transcript:` path still
   exists, read it to recover what actually happened: mistakes, user corrections, repeated friction,
   tool errors, things you had to re-explain, approaches that failed. If the transcript is gone,
   audit from the git signals + metadata alone and say so explicitly.

3. **Audit across five targets.** For each, decide whether there's a *durable, generalizable*
   improvement (not one-off session noise):
   - **CLAUDE.md** — global `~/.claude/CLAUDE.md` or the project `CLAUDE.md`: a rule that was missing,
     wrong, or should be sharper.
   - **Memory** — `~/.claude/projects/<proj>/memory/`: a fact or feedback worth persisting. Follow the
     Memory protocol (frontmatter `type:` + a one-line `MEMORY.md` index entry).
   - **Skills** — a repeated multi-step flow worth a new skill, or an existing skill that
     misfired / has a weak trigger description. (If you have a skill-authoring skill installed,
     use it rather than hand-writing the SKILL.md.)
   - **Hooks** — a recurring mistake worth converting into a deterministic guardrail: add a
     script to `~/.claude/hooks/` and wire it in `settings.json` (or use a hook-authoring skill
     if you have one installed).
   - **Plugins / settings.json** — anything stale, noisy, or missing.

4. **Propose, never auto-apply.** Present the candidates as a short list: `file → change → why`.
   Use `AskUserQuestion` (multiSelect) so the user picks which to apply. NEVER edit CLAUDE.md, hooks,
   skills, or settings.json without explicit approval for that specific edit.

5. **Apply approved edits**, explaining each one as you go: why it's needed, what exactly changed,
   and what you deliberately did NOT do. Verify each edit (valid JSON for settings.json, etc.).

6. **Archive the capture.** Move processed files from `pending/` to `~/.claude/improvements/done/`
   so the SessionStart reminder stops flagging them. Report what was applied and what was skipped.

## Rules
- Quality over quantity — propose only improvements that will help future sessions, not session noise.
- If you already have session-audit or memory-writing skills installed, reuse their logic rather
  than duplicating it here.
- One approval = one edit (never batch-apply config changes the user didn't individually see).
