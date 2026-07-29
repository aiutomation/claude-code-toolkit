#!/usr/bin/env python3
"""
SessionEnd capture for the self-improvement loop (Approach B: capture-now, review-next).

WHY: A hook runs a shell script, not Claude — so it can't "audit and edit intelligently".
Instead it cheaply preserves the raw material of the session the instant it ends, into a
dated queue file. The intelligent audit + config edits happen later, in an interactive
session, via the /apply-improvements skill (where the user approves each change).

This script does ZERO judgement. It just records: git signals + transcript pointer +
an audit checklist. It skips trivial sessions so the queue stays signal-rich. It can
never block session exit (always exits 0).
"""

import sys
import os
import json
import subprocess
import datetime

PENDING_DIR = os.path.expanduser("~/.claude/improvements/pending")


def run(cmd, cwd):
    try:
        return subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=8
        ).stdout.strip()
    except Exception:
        return ""


def _section(text, header):
    """Extract the body under a '### header' line, up to the next '###'/'##' line."""
    lines = text.splitlines()
    out, grab = [], False
    for ln in lines:
        if ln.strip() == header:
            grab = True
            continue
        if grab and (ln.startswith("### ") or ln.startswith("## ")):
            break
        if grab:
            out.append(ln)
    return "\n".join(out).strip()


def _changed_paths(status_text):
    """Set of file paths from a `git status --short` block: each line is `XY path`,
    so the path is column 3 onward. Ignores the leading status flags, the
    '(clean / not a git repo)' placeholder, and any markdown header lines.

    WHY a SET of paths and not the `diff --stat` text: in a permanently-dirty repo the
    insertion/deletion counts in `diff --stat` drift every session (149 -> 143 -> 112
    insertions while the same files stay changed), so an exact-text match never fired.
    The set of *which files* changed is stable, so it actually collapses the flood.
    """
    paths = set()
    for ln in (status_text or "").splitlines():
        ln = ln.rstrip()
        if len(ln) > 3 and not ln.startswith("(") and not ln.startswith("#"):
            paths.add(ln[3:].strip())
    return frozenset(paths)


def _transcript_digest(path, max_chars=300):
    """Best-effort: pull the user's own turns out of the transcript so the capture stays
    useful even after the `.jsonl` is rotated to a new filename on resume (which leaves
    the stored `transcript:` pointer dangling — the review step then has nothing to read).

    Keeps the first turn (what the session set out to do) + the last ~10 (where it ended
    and any corrections). Drops tool-results and hook/system-injected blocks.

    ponytail: best-effort only — hook-injected context blocks (leading '[' / '<') are
    dropped wholesale, so a real turn fused with such a block can be missed. Good enough
    for "what was this about" without a fragile parser; never raises (always returns str).
    """
    if not path or not os.path.exists(path):
        return ""
    msgs = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for ln in fh:
                try:
                    o = json.loads(ln)
                except Exception:
                    continue
                if o.get("type") != "user":
                    continue
                c = o.get("message", {}).get("content")
                if isinstance(c, list):
                    txt = " ".join(
                        b.get("text", "")
                        for b in c
                        if isinstance(b, dict) and b.get("type") == "text"
                    )
                elif isinstance(c, str):
                    txt = c
                else:
                    txt = ""
                txt = " ".join(txt.split())  # collapse whitespace/newlines to one line
                # Drop tool-results, system-reminders (<...>) and hook context ([...]).
                if (
                    not txt
                    or txt.startswith("<")
                    or txt.startswith("[")
                    or "tool_use_id" in txt
                    or "Base directory for this skill" in txt
                    or "Caveat: The messages below" in txt
                ):
                    continue
                msgs.append(txt[:max_chars])
    except Exception:
        return ""
    if not msgs:
        return ""
    picked = (msgs[:1] + msgs[-10:]) if len(msgs) > 11 else msgs
    seen, out = set(), []
    for m in picked:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return "\n".join(f"- {m}" for m in out)


def is_duplicate(cwd, git_status, git_log):
    """True if the newest pending capture for this same repo already recorded the same
    set of changed files + recent-commits — i.e. nothing meaningful changed since.

    WHY: a permanently-dirty tracked repo (uncommitted edits that never land) keeps
    `has_tracked_work` true forever, so every session re-captured the SAME stale state.
    Deduping on (changed-file set, recent-commits) collapses that flood to one capture.
    """
    try:
        files = [
            os.path.join(PENDING_DIR, n)
            for n in os.listdir(PENDING_DIR)
            if n.endswith(".md")
        ]
    except Exception:
        return False
    target = (cwd or "").casefold()
    newest, newest_mtime = None, -1
    for p in files:
        try:
            txt = open(p, encoding="utf-8").read()
        except Exception:
            continue
        m = [l for l in txt.splitlines() if l.startswith("- cwd:")]
        if not m or m[0][len("- cwd:"):].strip().casefold() != target:
            continue
        mt = os.path.getmtime(p)
        if mt > newest_mtime:
            newest, newest_mtime = txt, mt
    if newest is None:
        return False
    prev_status = _section(newest, "### status --short")
    prev_log = _section(newest, "### recent commits")
    return _changed_paths(prev_status) == _changed_paths(git_status) and prev_log == (
        git_log or "(none)"
    )


def main():
    # Escape hatch for other automation: any headless `claude -p` session that sets
    # TWIN_CAPTURE_RUNNING is skipped, so background agents don't flood this queue.
    if os.environ.get("TWIN_CAPTURE_RUNNING"):
        sys.exit(0)

    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    session_id = str(data.get("session_id", "unknown"))
    transcript = data.get("transcript_path", "") or ""
    cwd = data.get("cwd") or os.getcwd()
    reason = data.get("reason", "")

    git_status = run(["git", "status", "--short"], cwd)
    git_diffstat = run(["git", "diff", "--stat"], cwd)
    git_diffcached = run(["git", "diff", "--cached", "--stat"], cwd)
    git_log = run(["git", "log", "--oneline", "-5"], cwd)

    # Meaningfulness gate: only queue a review if real work happened.
    #
    # WHY this is NOT keyed on `git status --short`: in a permanently-dirty repo (untracked
    # logs, *.db, build artifacts that are never committed), `git status` is ALWAYS non-empty,
    # so the old gate never skipped — every 5-second session got captured (flooded the queue).
    # Real *work* shows up as TRACKED changes (unstaged or staged edits) or as a substantial
    # transcript. Pure untracked-noise + a short transcript = not worth reviewing.
    transcript_size = 0
    try:
        if transcript and os.path.exists(transcript):
            transcript_size = os.path.getsize(transcript)
    except Exception:
        transcript_size = 0
    has_tracked_work = bool(git_diffstat) or bool(git_diffcached)
    MIN_TRANSCRIPT = 25000          # tracked edits + at least this much chat -> worth a look
    MIN_TRANSCRIPT_NODIFF = 200000  # NO file changes: only a genuinely long (~200KB) session

    # Meaningfulness gate, split by whether any TRACKED file changed:
    #   - tracked edits present  -> capture unless the session was a blink (< MIN_TRANSCRIPT)
    #   - no tracked changes      -> a planning/Q&A chat has no git signal AND its transcript
    #     rots on resume, so only keep a genuinely long discussion (>= MIN_TRANSCRIPT_NODIFF).
    if has_tracked_work:
        if transcript_size < MIN_TRANSCRIPT:
            sys.exit(0)
    else:
        if transcript_size < MIN_TRANSCRIPT_NODIFF:
            sys.exit(0)

    # Dedupe gate: skip if the same repo's last capture already recorded the same set of
    # changed files + recent-commits (permanently-dirty repo re-captured every session).
    if is_duplicate(cwd, git_status, git_log):
        sys.exit(0)

    # Embed a digest of the user's turns NOW, while the transcript still exists — the
    # `.jsonl` is often rotated to a new filename on resume, dangling the pointer below.
    digest = _transcript_digest(transcript)

    try:
        os.makedirs(PENDING_DIR, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
        path = os.path.join(PENDING_DIR, f"{ts}_{session_id[:8]}.md")
        content = f"""# Session improvement capture — {ts}

- session_id: {session_id}
- cwd: {cwd}
- end_reason: {reason}
- transcript: {transcript}
- status: pending

## Git signals (what changed this session)
### status --short
{git_status or '(clean / not a git repo)'}

### diff --stat
{git_diffstat or '(no unstaged diff)'}

### recent commits
{git_log or '(none)'}

## Transcript digest (user turns — survives transcript rotation)
{digest or '(transcript unavailable at capture time)'}

## Audit checklist for /apply-improvements (next interactive session)
Read the transcript at the `transcript:` path above (it may have rotated away on resume —
the digest above is the fallback), then ask: what should change so this goes better next time?
- [ ] CLAUDE.md (global ~/.claude or the project one) — a rule that was missing or wrong?
- [ ] Memory files — a durable fact/lesson worth persisting? (+ MEMORY.md index line)
- [ ] Skills — a repeated multi-step flow worth a skill, or a skill that misfired?
- [ ] Hooks — a recurring mistake to convert into a deterministic guardrail (/hookify)?
- [ ] Plugins / settings.json — anything stale, noisy, or missing?
Propose each edit; apply ONLY what the user approves; then archive this file to ../done/.
"""
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception:
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
