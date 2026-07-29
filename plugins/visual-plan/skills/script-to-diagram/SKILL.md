---
name: script-to-diagram
description: Use when the user wants to turn code scripts or notebooks into visual, interpretable flowchart diagrams — a single self-contained HTML "map" with one Mermaid.js diagram per script plus a cross-framework overview and editable notes. Triggers include "script to diagram", "visualize this script/pipeline", "make a flowchart for every script", "course map", "turn my code into diagrams", "mermaid map of these files", "graphical representation of the pipeline".
---

# script-to-diagram

Turn one or many code files into **one self-contained HTML page**: a flowchart per
script (rendered by Mermaid.js in the browser), a top "big picture" map showing how
the files/frameworks relate, a shape legend, per-script plain-language notes, a live
filter box, and an editable "My notes" area that saves in the browser.

**Why HTML-that-embeds-Mermaid** (not plain Mermaid, not hand-built HTML): you write
simple editable diagram *text*, but the reader sees a polished, navigable page. One
file, no install — double-click to open. Editing a step = editing one line of data.

## When to use
- The user has several scripts/notebooks and wants to *grasp them quickly* and see how
  they wire together.
- The user asks for a flowchart / pipeline diagram / mindmap of code.
- The user wants reusable, note-friendly visual docs for a course or a codebase.

## How it works (3 parts)
1. `specs.json` — the **facts** about each script in plain fields (you edit this).
2. `build_map.py` — a tiny pure-stdlib converter (specs + template → HTML).
3. `assets/template.html` — the look & behaviour (CSS + Mermaid.js + Prism.js code
   highlighting + notes/filter JS). The page chrome also includes a **collapsible
   sidebar** (the "☰ Sidebar" button hides/shows the left nav; the choice is remembered
   in the browser) and a per-code **"⛶ Fullscreen"** button (native Fullscreen API,
   Esc to exit). Both are wired automatically — no spec fields needed.

## Procedure
1. **Read each target file** (the `.py` / `.ipynb`). For many files, dispatch parallel
   reader subagents (general-purpose, sonnet) so your own context stays clean.
2. **Produce one spec object per file** using the contract in
   `references/diagram-conventions.md` (type/label/note steps + edges + plain-language
   fields). Fill the `what`/`why`/`how` row-explanation fields (§5a) — what the code
   is/changes, why it exists/changes, how the approach works. Keep node labels ≤ 4 words;
   put detail in the `note`, not the box. Add the
   optional `code` field (full source; for notebooks, code cells only) to show a
   collapsible, Prism-highlighted "Show the actual code" block per card.
3. **Write/extend `specs.json`** — set `title`, `subtitle`, a curated
   `overview_mermaid` (the cross-file map), an optional `tree` (a plain ASCII file
   tree — classic `├── │ └──` glyphs, one file/dir per line, optional trailing
   `# comment`; lines whose filename matches a script are auto-highlighted and
   linked to that script's card), and the `scripts` array.
4. **Render** (only `--specs` is required; the template and output path auto-resolve):
   ```
   python "<skill-dir>/build_map.py" --specs <specs.json>
   ```
   Output goes to `COURSE_MAP.html` next to the specs file. Override with `--out`
   or `--template` if you want different locations.
5. **Verify** the HTML was written and (optionally) open it in a browser. Report the
   output path. Do NOT write diagrams into the source files — the map is the artifact.

## Adding a new script later
Read it → append one spec object to `specs.json` → re-run `build_map.py`. The diagram,
sidebar entry, and overview regenerate automatically. The user's typed notes survive
(they're keyed by the script's anchor in browser storage).

## Conventions (shapes, colours, families)
See `references/diagram-conventions.md`. Shapes follow the user's saved Mermaid spec:
parallelogram = I/O, rectangle = process, diamond = decision, rounded pill = data.
A fixed legend appears on every page.

## Notes
- `build_map.py` needs only Python 3 (standard library). No pip installs.
- Mermaid.js loads from a CDN, so the rendered page needs internet on first open
  (diagrams are cached by the browser after that). To go fully offline, vendor
  `mermaid.esm.min.mjs` locally and point the import at it.
- Keep this skill beginner-friendly: plain language, define jargon, one analogy per
  script.
