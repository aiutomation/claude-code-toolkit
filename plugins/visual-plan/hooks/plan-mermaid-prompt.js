#!/usr/bin/env node
// plan-mermaid-prompt.js — UserPromptSubmit hook.
//
// Detects when the user is kicking off a /plan and injects instructions telling
// Claude to append ONE `plan-blueprint` JSON spec to the plan markdown. The plan
// markdown is what ExitPlanMode captures, so embedding the spec there lets the
// ExitPlanMode hook (plan-to-flowchart.js → render-plan-blueprint.js) build the
// combined blueprint (per-file code-flow cards in the /script-to-diagram format
// + a UI-showcase grid) and open it in the browser before the approval dialog.

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let prompt = '';
  try {
    const p = JSON.parse(raw || '{}');
    prompt = p.user_prompt || p.prompt || p.user_message || '';
  } catch { /* malformed payload — silently skip */ }

  // Covers /plan, /plan-team, /plan-parallel (the \b after "plan" matches before the
  // hyphen), plus /goal and the natural-language plan-mode triggers. All of these end
  // in ExitPlanMode, whose hook (plan-to-flowchart.js) renders the same blueprint —
  // so the contract injected here must fire for every one of them.
  const planTrigger = /(^|\s)(\/plan\b|\/plan-team\b|\/plan-parallel\b|\/goal\b|enter plan mode|let'?s plan\b|plan this\b|go into plan mode)/i;
  if (!planTrigger.test(prompt)) { process.stdout.write('{}'); return; }

  // Example plan-blueprint spec injected into the instructions below. The model
  // emits DATA ONLY; render-plan-blueprint.js owns all presentation (per-file
  // flowchart cards in the script-to-diagram format + the OLD|NEW showcase grid).
  const BLUEPRINT_EXAMPLE = [
    '```plan-blueprint',
    '{',
    '  "title": "Add manual refresh to the keywords table",',
    '  "subtitle": "features/insights — 2 files changed",',
    '  "tree": "features/\\n├── insights/\\n│   ├── TopKeywordsTable.tsx   # the table + new Refresh button\\n│   └── useTopKeywords.ts       # data hook (unchanged)\\n└── **api/** insights/keywords  # endpoint the hook calls",',
    '  "overview_mermaid": "flowchart TB\\n  UI[\\"TopKeywordsTable\\"] -->|calls| HOOK[\\"useTopKeywords\\"]\\n  HOOK -->|GET| API[\\"/api/insights/keywords\\"]",',
    '  "scripts": [',
    '    {',
    '      "file": "features/insights/TopKeywordsTable.tsx",',
    '      "change": "edit",',
    '      "topic": "Manual refresh button",',
    '      "oneliner": "Adds a Refresh button so users get fresh data without waiting for the cache.",',
    '      "what": "Adds a <button> to TopKeywordsTable and wires its onClick to refetch() from the useTopKeywords hook.",',
    '      "why": "The table only updated when the 5-minute cache expired, so users stared at stale keyword counts with no way to force fresh data.",',
    '      "how": "onClick calls React Query refetch(); isFetching disables the button while in flight. Chose refetch() over invalidateQueries() so only THIS table reloads, not every cached query.",',
    '      "analogy": "Like a pull-to-refresh on a phone feed.",',
    '      "input": "limit prop (default 20)",',
    '      "output": "a ranked table + a Refresh button",',
    '      "press_go": "<TopKeywordsTable limit={20} />",',
    '      "mechanism": "onClick calls refetch() from useTopKeywords; React Query dedupes spam clicks.",',
    '      "steps": [',
    '        {"type": "io", "label": "User clicks Refresh", "note": "onClick handler fires"},',
    '        {"type": "process", "label": "refetch()", "note": "re-runs the query via the hook"},',
    '        {"type": "decision", "label": "isFetching?", "note": "true while the request is in flight"},',
    '        {"type": "data", "label": "keyword rows", "note": "fresh array rendered into the table"}',
    '      ],',
    '      "edges": [',
    '        "User clicks Refresh --> refetch()",',
    '        "refetch() --> isFetching?",',
    '        "isFetching? -- no --> keyword rows"',
    '      ],',
    '      "code": "export function TopKeywordsTable({ limit = 20 }) {\\n  const { data, refetch, isFetching } = useTopKeywords(limit);\\n  return <button onClick={() => refetch()}>Refresh</button>;\\n}",',
    '      "code_lang": "tsx"',
    '    }',
    '  ],',
    '  "components": [',
    '    {',
    '      "name": "TopKeywordsTable",',
    '      "css": ".btn{padding:8px 14px;border-radius:6px;background:#1565c0;color:#fff;border:0;transition:transform .2s} .btn:hover{transform:scale(1.05)}",',
    '      "old": { "html": "<span style=\'color:#999\'>static table, no refresh</span>", "caption": "wait 5 min for cache to expire" },',
    '      "new": { "html": "<button class=\'btn\'>Refresh</button>", "caption": "manual refresh with hover feedback — hover it" }',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');

  const additionalContext = [
    '[plan-mermaid-prompt hook] The user is starting a /plan. At the END of the plan markdown, under a `## Blueprint` heading, append ONE fenced block whose info-string is exactly  plan-blueprint  (three backticks + the word plan-blueprint) containing a single JSON object. It is auto-extracted and rendered as an interactive HTML page (opened in the browser BEFORE the approval dialog) so the user can verify the plan visually — a per-file code-flow map in the /script-to-diagram format PLUS a live UI showcase.',
    '',
    'You emit DATA ONLY. The renderer owns all layout, theme, flowchart drawing, syntax highlighting, sidebar, filter, and the OLD|NEW compare grid. Do NOT write HTML pages, Mermaid diagrams, or SVG — just fill the JSON fields.',
    '',
    '═══════════════════════════════════════════════════════════════════',
    'THE plan-blueprint JSON — top-level fields',
    '═══════════════════════════════════════════════════════════════════',
    '  "title":            short plan title.',
    '  "subtitle":         one line (e.g. area + N files changed).',
    '  "tree":             OPTIONAL but STRONGLY PREFERRED for any change spanning 2+ files or directories — a plain ASCII file tree (classic `├──  │  └──` glyphs, ONE file/dir per line, `\\n` between lines) giving the modification overview across the repo\'s files & architecture. Include ENOUGH surrounding unchanged files/dirs to show WHERE the changed files sit — this is the "where does this fit" map. Add a trailing `# comment` on a line to say what that file/dir does. You do NOT re-mark which files changed: the renderer auto-highlights, colours (by change type), and links any line whose filename matches a scripts[] entry to its card. Use `**double asterisks**` only to manually emphasise something with no single matching file (e.g. a changed directory). Keep it to the files that matter — not an exhaustive dump.',
    '  "overview_mermaid": OPTIONAL cross-file map as Mermaid `flowchart TB` source text (single string, use \\n for newlines). Show how the changed files/modules relate. Complements "tree" (tree = WHERE files live; overview = HOW they call each other). Omit if there is only one file or no meaningful relationship.',
    '  "scripts":          array — ONE object per file being changed (see below). ALWAYS include for any code change.',
    '  "components":       array — the UI showcase (see the effort gate below). Include ONLY for Medium+ frontend UI changes.',
    '',
    '─────────── scripts[] — one per changed file (FILE-level explanation cards) ───────────',
    'Each card EXPLAINS A FILE (not a function): what this file is, what is changing in it, and why. This is a PLAN of a not-yet-written change, so scope the card to the file — do NOT force an internal function-by-function flowchart. Every tree/sidebar link points to one of these cards, so a card must NEVER be a bare stub (file + change only) or the link dead-ends on an empty box.',
    'REQUIRED core (always fill — this is the whole point): topic + oneliner + what/why/how. Everything below that is OPTIONAL and added only when it genuinely helps.',
    'Each object:',
    '  "file":      repo-relative path (its extension picks the code syntax highlighting).',
    '  "change":    one of "add" | "edit" | "del" | "reuse" (colours the card: green/amber/red/blue).',
    '  "topic":     REQUIRED ≤ 6-word title of what changes in this file.',
    '  "oneliner":  REQUIRED ≤ 18 words, plain language — what this change does and why.',
    '  "what":      REQUIRED — the involved change: concretely WHAT is edited/added in this FILE (functions, props, lines, files touched).',
    '  "why":       REQUIRED — WHY this file changes: the problem, bug, or goal driving it (the trigger, not a restatement of "what").',
    '  "how":       REQUIRED — HOW this approach works: the mechanism/design in 1–2 sentences, and (if a real alternative existed) why this way over that.',
    '               → what/why/how render as a 3-row explanation table at the top of the card. Fill ALL THREE for every changed file; they ARE the file explanation and the heart of the plan. Omit an individual row only if it is genuinely empty (e.g. a pure delete has no "how"). A pure delete still needs what + why.',
    '  "analogy":   OPTIONAL one real-world comparison (define jargon in plain terms).',
    '  "input":     OPTIONAL what goes in (props, args, request).',
    '  "output":    OPTIONAL what comes out (JSX, return value, response).',
    '  "press_go":  OPTIONAL the single call/line that exercises it — rendered as a Prism syntax-highlighted (VSCode Dark+) code line.',
    '  "mechanism": OPTIONAL how control flows / the key trick.',
    '  "steps":     OPTIONAL flowchart boxes — array of {"type","label","note"}. Add a flowchart ONLY when the change introduces real internal control flow worth diagramming (a new branch, loop, or multi-step pipeline). For a plain edit/add with no interesting flow, SKIP steps/edges — the file-level what/why/how is the explanation. NEVER drop the whole card just because a flowchart does not fit.',
    '                 type = "io" (input/output, parallelogram) | "process" (a step that does work, rectangle) | "decision" (a branch, diamond) | "data" (a piece of data, rounded pill).',
    '                 label = ≤ 4 words (the box name). note = one plain sentence (goes in the Step-details table, not the box).',
    '  "edges":     array of plain strings connecting step LABELS exactly:',
    '                 "A --> B"                (simple flow)',
    '                 "Q? -- yes --> C"        (labelled branch — text between the dashes is the arrow label)',
    '                 A loop is just an edge pointing back to an earlier label.',
    '  "code":      INCLUDE for every non-trivial changed file — the actual new/changed source (a string; use \\n for newlines). Rendered as a collapsible "Show the actual code" block, Prism syntax-highlighted in the VSCode Dark+ scheme (keywords, functions, types, strings, params all coloured). This is the ONLY place the reader sees real, coloured code — the mermaid boxes hold plain-prose labels, NOT code. Omit only for pure deletes or a trivial one-liner.',
    '  "code_lang": OPTIONAL override the highlight language (defaults from the file extension: tsx/ts/jsx/js/py/css/json).',
    '',
    'DIAGRAM RULES (keep flowcharts scannable):',
    '  • One meaning per shape (io/process/decision/data) — never hand-write Mermaid bracket syntax; just set "type".',
    '  • Box label ≤ 4 words; put the explanation in "note".',
    '  • Every edge endpoint MUST match a step "label" exactly (else the renderer invents a stray box).',
    '  • 4–8 steps per file is ideal. If a file barely changes, 2–3 steps is fine.',
    '',
    '─────────── components[] — the UI showcase (conditional) ───────────',
    'INCLUDE components ONLY when the plan has a clear MEDIUM-or-higher frontend UI/UX change:',
    '  • new/restructured component; layout change; new modal/dropdown/form/panel; changed interaction or navigation; responsive rework; an animation/transition/micro-interaction change; a new page/view; a design-system change (HIGH — always include).',
    '  SKIP for trivial tweaks (one icon/colour/font/copy/spacing). SUMMATION: 4+ trivial tweaks together → treat as Medium and include.',
    '  Pure backend/refactor/docs/config with NO visible UI change → OMIT components entirely.',
    'Give ONE entry per changed FRONTEND component (files ending .tsx/.jsx/.vue/.svelte). The renderer cross-checks against your scripts and shows a visible "⚠ not previewed" empty slot for any changed frontend file you leave out — so cover them all.',
    'Each component object:',
    '  "name":  match the component/file basename (e.g. TopKeywordsTable) — this is how it maps to the scripts.',
    '  "css":   CSS for THIS component — put the REAL transition/@keyframes/:hover here so old-vs-new MOTION is visible.',
    '  "old":   { "html": "<fragment approximating the CURRENT component>", "caption": "one line: current behavior/issue" }',
    '  "new":   { "html": "<fragment approximating the PROPOSED component, wired with real motion>", "caption": "one line: what changes + why" }',
    '  HTML values are FRAGMENTS (no <html>/<head>/<body>, no <style>, no <script>). Use SINGLE quotes for HTML attributes to avoid JSON escaping. No external URLs — inline SVG/data: only. System fonts. Keep small.',
    '',
    'HARD RULES:',
    '  • EVERY scripts[] entry MUST carry topic + oneliner + at least one of what/why/how. A card with only file + change renders as an empty stub and turns every tree/sidebar link to it into a dead end — never emit one.',
    '  • The block MUST be valid JSON (a parse error shows a red warning card instead of the preview). Escape newlines inside string values as \\n.',
    '  • Put it LAST in the plan, under `## Blueprint`, in its own plan-blueprint fenced block.',
    '  • BEFORE WRITING: read the target files (or grep) so steps/edges/props are real, not fabricated. If you cannot verify something, omit it rather than guess.',
    '',
    'EXAMPLE (copy the shape, fill with the real files/components this plan changes):',
    BLUEPRINT_EXAMPLE,
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  }));
});
