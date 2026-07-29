#!/usr/bin/env python3
"""
SessionStart reminder/trigger for the self-improvement loop.

WHY this exists: the SessionEnd hook captures raw material into a pending queue, but a queue
with no consumer just piles up (it did — 13 captures, 0 ever processed). This hook is the
consumer's trigger: on a FRESH session start, if enough captures have backed up, it injects an
ACTION directive so Claude opens the session by running /apply-improvements (supervised — the
user still approves every edit). Below the batch threshold, or mid-session (compact), it falls
back to the old non-naggy one-line reminder so it never hijacks work you're in the middle of.

SessionStart hook output is added to the session context. We use the JSON
`hookSpecificOutput.additionalContext` form for the imperative (reliably actioned), and plain
stdout for the passive reminder. Always exits 0 — can never block a session from starting.
"""

import os
import glob
import sys
import json

PENDING_DIR = os.path.expanduser("~/.claude/improvements/pending")

# At/above this many backed-up captures, a fresh session auto-runs the audit instead of just
# reminding. Keeps single trivial captures from interrupting every session, but stops a flood.
BATCH_THRESHOLD = 3

# SessionStart `source` values where it's safe to hijack the opening turn with an audit.
# "compact" fires MID-session (context got summarized) — never interrupt active work there.
FRESH_SOURCES = {"startup", "resume", "clear"}


def emit_context(text):
    """Inject as actionable additional context (Claude acts on it)."""
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": text,
        }
    }))


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    source = str(data.get("source", "")).lower()

    try:
        files = sorted(glob.glob(os.path.join(PENDING_DIR, "*.md")))
    except Exception:
        files = []

    if not files:
        sys.exit(0)  # queue empty, nothing to say

    n = len(files)
    latest = os.path.basename(files[-1])

    if n >= BATCH_THRESHOLD and source in FRESH_SOURCES:
        # Loud, actionable: open the session by draining the queue.
        emit_context(
            f"ACTION REQUIRED — self-improvement loop: {n} end-of-session captures are queued "
            f"in ~/.claude/improvements/pending/ and none have been reviewed. Before starting the "
            f"user's first task, invoke the /apply-improvements skill to batch-triage these "
            f"captures: quickly archive trivial ones, deep-audit the substantive ones, propose "
            f"config edits, and apply ONLY what the user approves. "
            f"EXCEPTION: if the user's first message is clearly urgent or unrelated, ask whether "
            f"to defer the audit before diving in — don't block real work."
        )
    else:
        # Passive: one-line nudge (below batch threshold, or mid-session compact).
        print(
            f"[self-improvement] {n} pending session review(s) in "
            f"~/.claude/improvements/pending/ (latest: {latest}). "
            f"Run /apply-improvements to audit them and apply approved config edits."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
