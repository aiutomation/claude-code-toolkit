#!/usr/bin/env node
// render-plan-blueprint.js — the combined plan-preview SINK.
//
// Reads the PLAN MARKDOWN on stdin and builds ONE self-contained HTML page,
// opened in the browser BEFORE the approval dialog. The CODE-FLOW half follows
// the /script-to-diagram FORMAT (per-file flowchart cards + overview map +
// legend + filter + sidebar + "show the actual code"); the UI-SHOWCASE half is
// the option-2 data-spec grid. Everything renders client-side from LOCALLY-
// VENDORED assets (assets/mermaid.min.js + assets/prism*.js) — offline, no CDN,
// no mmdc (mmdc silently died ~2026-06-19; that whole path is retired).
//
// The plan emits ONE fenced block, info-string exactly  plan-blueprint , with a
// JSON spec (script-to-diagram's specs.json shape + a `components` array):
//   {
//     "title": "...", "subtitle": "...",
//     "overview_mermaid": "flowchart TB ...",          // optional cross-file map
//     "scripts": [                                       // one per changed file
//       { "file":"features/X.tsx", "change":"add|edit|del|reuse",
//         "topic":"...", "oneliner":"...", "analogy":"...",
//         "what":"...", "why":"...", "how":"...",         // the What/Why/How row explanation
//         "input":"...", "output":"...", "press_go":"...", "mechanism":"...",
//         "steps":[ {"type":"io|process|decision|data","label":"...","note":"..."} ],
//         "edges":[ "A --> B", "Q? -- yes --> C" ],      // endpoints match step labels
//         "code":"...", "code_lang":"tsx" }              // code optional
//     ],
//     "components": [                                     // optional UI showcase
//       { "name":"X", "css":"...", "old":{"html":"...","caption":"..."},
//                                  "new":{"html":"...","caption":"..."} }
//     ]
//   }
// NO legacy fallback: the plan-blueprint block is the ONLY accepted input. A
// missing/unparseable block renders a diagnostic warn-box (never a heuristic
// ```mermaid tree — that old "Code flow (legacy format)" path is retired).
//
// Usage:  cat plan.md | node <plugin>/hooks/render-plan-blueprint.js [repo-cwd]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, exec } = require('child_process');

const home = os.homedir();
// Where rendered blueprints are kept. VISUAL_PLAN_DIR relocates them; the default
// keeps the historical ~/.claude/plan-mermaid location.
const planDir = process.env.VISUAL_PLAN_DIR || path.join(home, '.claude', 'plan-mermaid');
// Vendored mermaid/prism ship INSIDE the plugin, so resolve them relative to this
// file first. The planDir/assets fallback only exists for pre-plugin installs that
// already had them copied into ~/.claude/plan-mermaid/assets.
const bundledAssets = path.join(__dirname, '..', 'assets');
const assetsSrc = fs.existsSync(bundledAssets) ? bundledAssets : path.join(planDir, 'assets');
fs.mkdirSync(planDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Vendored assets each written-out bundle needs beside its HTML (relative refs).
const ASSET_FILES = [
  'mermaid.min.js', 'prism.min.js', 'prism-typescript.min.js', 'prism-jsx.min.js',
  'prism-tsx.min.js', 'prism-python.min.js', 'prism-vsc-dark-plus.min.css',
];

// Resolve the git repo root from a starting dir, so the in-repo copy lands at the
// repo root no matter which subdir the terminal is in. null = not a git repo.
function gitRoot(dir) {
  try {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout.trim()) return path.normalize(r.stdout.trim());
  } catch { /* git missing / not a repo */ }
  return null;
}

// Copy the vendored assets into <dir> only if missing (idempotent, cheap on repeat).
function ensureAssets(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ASSET_FILES) {
    const dst = path.join(dir, f), src = path.join(assetsSrc, f);
    try { if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst); } catch { /* skip */ }
  }
}

// Write one self-contained bundle (html + plan.md + assets) into <baseDir>.
// aliasHtml/aliasMd are the always-latest names; timestamped copies accumulate.
function writeBundle(baseDir, html, md, { aliasHtml, selfIgnore }) {
  fs.mkdirSync(baseDir, { recursive: true });
  ensureAssets(path.join(baseDir, 'assets'));
  if (selfIgnore) {                         // make the folder invisible to git without touching repo .gitignore
    const gi = path.join(baseDir, '.gitignore');
    try { if (!fs.existsSync(gi)) fs.writeFileSync(gi, '# plan blueprints — local working artifacts\n*\n'); } catch {}
  }
  fs.writeFileSync(path.join(baseDir, aliasHtml), html);
  fs.writeFileSync(path.join(baseDir, `${ts}-blueprint.html`), html);
  fs.writeFileSync(path.join(baseDir, `${ts}-plan.md`), md);
  fs.writeFileSync(path.join(baseDir, 'latest-plan.md'), md);
  return path.join(baseDir, aliasHtml);
}

let md = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { md += c; });
process.stdin.on('end', () => {
  if (!md.trim()) { console.error('[render-plan-blueprint] empty stdin'); process.exit(2); }

  // ONLY input: one plan-blueprint JSON spec (script-to-diagram format). No
  // legacy fallback — a missing/broken block yields a diagnostic, not a tree.
  let spec = null, specErr = null;
  const specRaw = extractBlock(md, 'plan-blueprint');
  if (specRaw == null) {
    specErr = 'no ```plan-blueprint block found in the plan markdown';
  } else {
    try { spec = JSON.parse(specRaw); } catch (e) { specErr = 'plan-blueprint JSON did not parse — ' + e.message; }
  }

  const html = buildBlueprint(spec || {}, specErr);

  // 1) Always write the global copy under ~/.claude/plan-mermaid (the "claude root").
  let openPath;
  try {
    openPath = writeBundle(planDir, html, md, { aliasHtml: 'current-blueprint.html', selfIgnore: false });
  } catch (e) { console.error('[render-plan-blueprint] global write failed:', e.message); process.exit(3); }

  // 2) ALSO write an in-repo copy so the report persists with the project and can
  //    be reopened from anywhere in that repo. Repo root resolved from the cwd the
  //    dispatcher passed (argv[2]) / env / process.cwd(). Skipped when not a git
  //    repo or when that root is inside ~/.claude (never litter config/home).
  const cwdHint = process.argv[2] || process.env.PLAN_REPO_CWD || process.cwd();
  const root = gitRoot(cwdHint);
  const claudeHome = path.join(home, '.claude');
  if (root && !path.normalize(root).startsWith(claudeHome)) {
    try {
      const repoDir = path.join(root, '.plan-blueprints');
      const repoHtml = writeBundle(repoDir, html, md, { aliasHtml: 'latest.html', selfIgnore: true });
      openPath = repoHtml; // prefer opening the in-repo copy so the location is reinforced
      console.log('[render-plan-blueprint] repo copy:', repoHtml);
    } catch (e) { console.error('[render-plan-blueprint] repo write skipped:', e.message); }
  }

  const openCmd = process.platform === 'win32' ? `start "" "${openPath}"`
    : process.platform === 'darwin' ? `open "${openPath}"` : `xdg-open "${openPath}"`;
  exec(openCmd, { shell: true }, (err) => {
    if (err) console.error('[render-plan-blueprint] could not auto-open, HTML at:', openPath);
    else console.log('[render-plan-blueprint] wrote + opened:', openPath);
  });
});

// ---- extraction / fallback -------------------------------------------------

function extractBlock(text, tag) {
  const re = new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)\\n```');
  const m = re.exec(text || '');
  return m ? m[1] : null;
}

// ---- helpers ---------------------------------------------------------------

function e(s) { // html.escape (text content)
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function slugify(name) {
  const s = String(name || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return s || 'item';
}

// change-type → [badge label, colour]. Replaces script-to-diagram's AI-course
// FAMILIES, which don't map to a plan. Used only for badge + left-border colour.
const CHANGE = {
  add:   ['Added',   '#16a34a'],
  edit:  ['Edited',  '#d97706'],
  del:   ['Deleted', '#dc2626'],
  reuse: ['Reused',  '#2563eb'],
};
// The model often uses synonyms ("modify", "create"…) instead of the four keys
// above; map them so the badge/colour stay correct instead of the grey fallback.
const CHANGE_ALIAS = {
  modify: 'edit', change: 'edit', changed: 'edit', update: 'edit', updated: 'edit',
  create: 'add', created: 'add', new: 'add', added: 'add',
  delete: 'del', deleted: 'del', remove: 'del', removed: 'del',
  reused: 'reuse',
};
function changeStyle(change) {
  const key = CHANGE_ALIAS[String(change || '').toLowerCase()] || String(change || '').toLowerCase();
  return CHANGE[key] || ['Changed', '#6b7280'];
}
// Normalise a change value to one of the four canonical keys (for a CSS class);
// unknown/absent → 'edit' so the file still reads as "touched".
function changeClass(change) {
  const key = CHANGE_ALIAS[String(change || '').toLowerCase()] || String(change || '').toLowerCase();
  return CHANGE[key] ? key : 'edit';
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Coerce steps into a uniform {type,label,note} shape. The model sometimes emits
// steps as bare strings (the label) instead of objects — accept both, drop the
// type to "process", and discard any step with no usable label so we never emit
// an empty  N0[""]  node (mermaid 11 throws "Syntax error" on an empty label).
function normSteps(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((st) => (typeof st === 'string' ? { label: st, type: 'process' } : (st || {})))
    .map((st) => ({
      type: st.type || 'process',
      label: String(st.label == null ? '' : st.label).trim(),
      note: st.note == null ? '' : st.note,
    }))
    .filter((st) => st.label);
}

// file extension → Prism language for the "show the actual code" block.
function langOf(file, override) {
  if (override) return override;
  const ext = (path.extname(file || '') || '').slice(1).toLowerCase();
  return ({ tsx: 'tsx', ts: 'typescript', jsx: 'jsx', js: 'javascript', mjs: 'javascript',
            py: 'python', css: 'css', json: 'json', html: 'markup' })[ext] || 'markup';
}

// ---- per-file flowchart (verbatim port of build_map.py build_mermaid) -------

const SHAPE = { io: ['[/"', '"/]'], process: ['["', '"]'], decision: ['{"', '"}'], data: ['(["', '"])'] };
// Mermaid node labels survive TWO HTML decodes before display: startOnLoad reads
// the graph from the element's textContent (decode #1), then renders each label
// as innerHTML under htmlLabels (decode #2). So we entity-encode TWICE:
//   • pass 1 → the string mermaid's grammar must see in textContent: no raw "
//     (it delimits the label → would break parsing) and no raw < > & (the browser
//     would parse "<Foo/>" as a DOM element and corrupt the graph source).
//   • pass 2 → re-encode the & of each entity so it survives the textContent decode
//     intact, then decodes once more in the htmlLabel and shows the char literally.
// Result: quotes, <JSX/> tags, & etc. all render as visible text with no
// "Syntax error in text". (Single-escaping renders too, but eats literal <tags>.)
function escNode(l) {
  const once = String(l == null ? '' : l).trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return once.replace(/&/g, '&amp;');
}

function buildMermaid(spec) {
  const steps = normSteps(spec.steps);
  if (!steps.length) return '';           // nothing renderable → caller omits the diagram
  const lines = ['flowchart TD'];
  const label2id = {};
  steps.forEach((st, i) => {
    const nid = 'N' + i;
    const typ = SHAPE[st.type] ? st.type : 'process';
    if (!(st.label in label2id)) label2id[st.label] = nid;
    const [op, cl] = SHAPE[typ];
    lines.push('    ' + nid + op + escNode(st.label) + cl + ':::' + typ);
  });
  const extra = {};
  const resolve = (lbl) => {
    lbl = lbl.trim();
    if (lbl in label2id) return label2id[lbl];
    if (lbl in extra) return extra[lbl];
    const nid = 'X' + Object.keys(extra).length;
    extra[lbl] = nid;
    lines.push('    ' + nid + '["' + escNode(lbl) + '"]:::process');
    return nid;
  };
  let drew = 0;
  (spec.edges || []).forEach((raw) => {
    const eStr = String(raw || '').trim();
    const idx = eStr.lastIndexOf('-->');
    if (idx === -1) return;               // prose "edge" with no arrow → skip
    const left = eStr.slice(0, idx);
    const to = eStr.slice(idx + 3).trim();
    let frm = left, label = '';
    if (left.includes('--')) { const p = left.split('--'); frm = p[0]; label = p.slice(1).join('--').trim(); }
    frm = frm.trim();
    if (!frm || !to) return;
    const fid = resolve(frm), tid = resolve(to);
    lines.push(label ? '    ' + fid + ' -->|' + escNode(label) + '| ' + tid : '    ' + fid + ' --> ' + tid);
    drew++;
  });
  // No parseable edges but multiple steps → chain them top→bottom so the diagram
  // still reads as a flow (the model gave prose edges, or none). Better a linear
  // chain than a stack of disconnected boxes.
  if (!drew && steps.length > 1) {
    for (let i = 0; i < steps.length - 1; i++) lines.push('    N' + i + ' --> N' + (i + 1));
  }
  lines.push(
    '    classDef io fill:#fff4c2,stroke:#b8860b,color:#5b4500;',
    '    classDef process fill:#e7f0ff,stroke:#3b6fb6,color:#16365c;',
    '    classDef decision fill:#ffe1e1,stroke:#c0392b,color:#7a1f17;',
    '    classDef data fill:#e3f7ea,stroke:#2e7d32,color:#14532d;',
  );
  return lines.join('\n');
}

// ---- per-file card (port of build_map.py card_html) ------------------------

// What / Why / How — the "row explanation" block. Three optional fields rendered
// as a 3-row table (colour-coded with the shape palette). Any empty row is
// dropped; if all three are empty the whole table is omitted (no empty box).
//   what → what actually changed (the concrete edit)
//   why  → why this change is needed (the problem/goal driving it)
//   how  → how the approach works (the mechanism/design at a glance)
function wwhBlock(s) {
  const rows = [['what', 'What', s.what], ['why', 'Why', s.why], ['how', 'How', s.how]]
    .filter(([, , v]) => v != null && String(v).trim());
  if (!rows.length) return '';
  const trs = rows.map(([cls, lbl, v]) =>
    '<tr class="' + cls + '"><th>' + lbl + '</th><td>' + e(v) + '</td></tr>').join('');
  return '<table class="wwh"><tbody>' + trs + '</tbody></table>';
}

function scriptCard(s, n, treeComments) {
  const [label, color] = changeStyle(s.change);
  const anchor = s.anchor || slugify(s.file);
  const steps = normSteps(s.steps);
  const rows = steps.map((st) =>
    '<tr><td class="st ' + (SHAPE[st.type] ? st.type : 'process') + '">' + e(st.label) + '</td><td>' + e(st.note) + '</td></tr>'
  ).join('\n');
  const search = e(((s.change || '') + ' ' + (s.topic || '') + ' ' + (s.oneliner || '') + ' ' + (s.file || '')).toLowerCase());
  const p = [];
  p.push('<section class="card" id="' + e(anchor) + '" data-search="' + search + '" style="--fc:' + color + '">');
  p.push('<div class="chead">');
  p.push('<span class="badge" style="background:' + color + '">' + e(label) + '</span>');
  p.push('<span class="num">#' + n + '</span>');
  p.push('<h2>' + e(s.topic || s.file) + '</h2>');
  p.push('<div class="hmeta"><code class="fname">' + e(s.file) + '</code>'
    + (s.framework ? '<span class="fw">' + e(s.framework) + '</span>' : '') + '</div>');
  p.push('</div>');
  const headerLen = p.length; // anything pushed past here is real card body
  if (s.oneliner) p.push('<p class="one">' + e(s.oneliner) + '</p>');
  const wwh = wwhBlock(s);
  if (wwh) p.push(wwh);
  if (s.analogy) p.push('<p class="analogy"><b>Analogy</b> ' + e(s.analogy) + '</p>');
  if (s.input || s.output) {
    p.push('<div class="iogrid">');
    p.push('<div class="io in"><h4>Input</h4><p>' + e(s.input) + '</p></div>');
    p.push('<div class="io out"><h4>Output</h4><p>' + e(s.output) + '</p></div>');
    p.push('</div>');
  }
  if (s.press_go) {
    // Same Prism treatment as the "actual code" block so the entry-point call is
    // VSCode-coloured, not flat text. langOf() picks the grammar from the file ext.
    const plang = langOf(s.file, s.code_lang);
    p.push('<div class="pressgo"><h4>Entry point &mdash; the call that runs it</h4>'
      + '<pre class="codeblock language-' + plang + '"><code class="language-' + plang + '">' + e(s.press_go) + '</code></pre></div>');
  }
  if (s.mechanism) p.push('<div class="mech"><h4>How control flows</h4><p>' + e(s.mechanism) + '</p></div>');
  const mer = buildMermaid(s);
  if (mer) p.push('<div class="diagram"><div class="mermaid">' + mer + '</div></div>');
  if (rows) {
    p.push('<details class="stepbox"><summary>Step details &mdash; what each box means</summary>');
    p.push('<table class="steptbl"><thead><tr><th>Box</th><th>What it does</th></tr></thead><tbody>' + rows + '</tbody></table>');
    p.push('</details>');
  }
  if (s.code && String(s.code).trim()) {
    const lang = langOf(s.file, s.code_lang);
    p.push('<details class="codebox"><summary>Show the actual code &mdash; the full change, inline</summary>'
      + '<button class="fs-btn" type="button">&#9974; Fullscreen</button>'
      + '<pre class="codeblock language-' + lang + '"><code class="language-' + lang + '">' + e(s.code) + '</code></pre></details>');
  }
  // Empty card (spec gave only file+change). Backstop, in order:
  //   1) derive the explanation from the matching tree `# comment` (the model
  //      reliably writes those even when it skips the card) — single source of truth;
  //   2) if there's no tree comment either, show a loud floor so the gap is visible,
  //      never a silent dead link.
  if (p.length === headerLen) {
    const tc = treeComments && treeComments[anchor];
    if (tc) {
      p.push('<p class="one">' + e(tc) + '</p>');
    } else {
      p.push('<p class="one" style="color:var(--decision-b)">&#9888; No explanation captured &mdash; '
        + 'the plan spec gave only the filename for this file. Add <code>what</code>/<code>why</code>/<code>how</code> '
        + '(and <code>oneliner</code>) to its <code>scripts[]</code> entry so this card explains the change.</p>');
    }
  }
  p.push('<div class="notes"><h4>My notes</h4>'
    + '<div class="note" contenteditable="true" data-key="' + e(anchor) + '" '
    + 'data-ph="Click here and type your own notes &mdash; they save in this browser."></div></div>');
  p.push('</section>');
  return p.join('\n');
}

// ---- UI showcase (option-2 grid; classes namespaced sc-* to avoid collision) ----

const CARD_CSS = [
  '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
  'body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;padding:12px}',
  '.compare{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d8d8d4;border-radius:6px;overflow:hidden}',
  '.panel{padding:14px}.panel.old{background:#fff8f0;border-right:1px solid #d8d8d4}.panel.new{background:#f0f7ff}',
  '.plabel{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px}',
  '.old .plabel{color:#c0392b}.new .plabel{color:#1a6b3c}',
  '.demo{min-height:90px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px dashed #d8d8d4;border-radius:4px;padding:14px}',
  '.cap{margin-top:10px;font-size:11px;color:#6b6b68}.cap b{color:#1a1a1a}',
  '.replay{margin-top:10px;font:inherit;font-size:11px;cursor:pointer;background:#fff;border:1px solid #d8d8d4;border-radius:4px;padding:4px 9px}',
  '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}',
  '@media(max-width:520px){.compare{grid-template-columns:1fr}.panel.old{border-right:none;border-bottom:1px solid #d8d8d4}}',
].join('');

function componentDoc(c) {
  const old = c.old || {}, neu = c.new || {};
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>', CARD_CSS, (c.css || ''),
    '</style></head><body><div class="compare">',
    '<div class="panel old"><div class="plabel">Old</div>',
    '<div class="demo">', (old.html || '<span style="color:#999">— no prior state —</span>'), '</div>',
    '<div class="cap"><b>Now:</b> ', e(old.caption || ''), '</div></div>',
    '<div class="panel new"><div class="plabel">New</div>',
    '<div class="demo" id="d">', (neu.html || ''), '</div>',
    '<div class="cap"><b>Change:</b> ', e(neu.caption || ''), '</div>',
    '<button class="replay" onclick="r()">▶ Replay</button></div>',
    '</div><script>function r(){var n=document.getElementById("d");var c=n.cloneNode(true);c.id="d";n.parentNode.replaceChild(c,n);}</script>',
    '</body></html>',
  ].join('');
}

function showcaseSection(spec) {
  const components = spec.components || [];
  const scripts = spec.scripts || [];
  const authored = new Map();
  components.forEach((c) => { if (c && c.name) authored.set(c.name.toLowerCase(), c); });

  // Expected frontend components = changed files with a frontend extension.
  const expected = scripts
    .map((s) => s.file || '')
    .filter((f) => /\.(tsx|jsx|vue|svelte)$/i.test(f))
    .map((f) => path.basename(f).replace(/\.(tsx|jsx|vue|svelte)$/i, ''));

  const order = [...expected];
  authored.forEach((c) => { if (!expected.some((x) => x.toLowerCase() === c.name.toLowerCase())) order.push(c.name); });
  const names = order.length ? order : [...authored.values()].map((c) => c.name);

  if (!names.length) return { chips: '', html: '' };

  let missing = 0;
  const cards = names.map((name) => {
    const c = authored.get(name.toLowerCase());
    if (!c) {
      missing++;
      return '<div class="sc-card empty"><div class="sc-name">' + e(name) + '</div>'
        + '<div class="sc-missing">⚠ not previewed — changed component omitted from the showcase spec</div></div>';
    }
    return '<div class="sc-card"><div class="sc-name">' + e(c.name) + '</div>'
      + '<iframe class="sc-frame" srcdoc="' + escAttr(componentDoc(c)) + '" sandbox="allow-scripts" title="' + e(c.name) + '"></iframe></div>';
  }).join('');

  const chip = missing
    ? '<span class="sc-chip warn">⚠ ' + missing + ' changed component' + (missing > 1 ? 's' : '') + ' not previewed</span>'
    : '<span class="sc-chip ok">✓ all ' + names.length + ' component' + (names.length > 1 ? 's' : '') + ' previewed</span>';

  return {
    chips: chip,
    html: '<div class="sc-wrap"><h3>UI showcase &mdash; old vs new (live motion)</h3>'
      + '<div class="sc-chips">' + chip + '</div><div class="sc-grid">' + cards + '</div></div>',
  };
}

// ---- file tree (the architecture overview) ---------------------------------
// The model authors `tree` as a plain ASCII tree string (the classic `├── │ └──`
// layout, one file/dir per line, optional trailing `# comment`). We DON'T ask it
// to declare which files changed a second time — we auto-highlight any tree line
// whose filename matches a scripts[] entry, colour it by that file's change type,
// and link it to the file's flow card. `**bold**` gives manual emphasis (e.g. a
// changed directory that has no single matching file).
function renderTreeLine(line, idx) {
  // Peel off a trailing `# comment` so it renders muted and never gets linkified.
  const m = line.match(/(\s#.*)$/);
  const code = m ? line.slice(0, m.index) : line;
  const cm = m ? m[1] : '';
  let out = e(code);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="tb">$1</strong>');
  // Link each changed basename as a whole token: \b before, no word-char after
  // (so main.py doesn't match inside main.pyc). count-once per basename per line.
  for (const base in idx) {
    const { anchor, cls } = idx[base];
    const eb = e(base);
    const re = new RegExp('\\b' + escRe(eb) + '(?![\\w])');
    out = out.replace(re, '<a href="#' + e(anchor) + '" class="tf ' + cls + '">' + eb + '</a>');
  }
  return out + (cm ? '<span class="tree-cm">' + e(cm) + '</span>' : '');
}

function treeSection(spec) {
  const raw = spec.tree;
  if (!raw || !String(raw).trim()) return { link: '', html: '' };
  const idx = {};
  (spec.scripts || []).forEach((s) => {
    if (!s.file) return;
    idx[path.basename(s.file)] = { anchor: s.anchor || slugify(s.file), cls: changeClass(s.change) };
  });
  const lines = String(raw).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  // Capture each matched file's trailing `# comment` (cleaned) keyed by anchor, so
  // scriptCard can use it as the card explanation when the spec left the card empty.
  // The model reliably writes these tree comments even when it skips the cards.
  const comments = {};
  lines.forEach((ln) => {
    const m = ln.match(/(\s#.*)$/);
    if (!m) return;
    const codePart = ln.slice(0, m.index);
    const cmText = m[1].replace(/^\s*#\s?/, '').trim();
    if (!cmText) return;
    for (const base in idx) {
      if (new RegExp('\\b' + escRe(base) + '(?![\\w])').test(codePart)) {
        comments[idx[base].anchor] = cmText;
        break;
      }
    }
  });
  const body = lines.map((ln) => renderTreeLine(ln, idx)).join('\n');
  const legend = '<div class="tree-legend">'
    + '<span class="tl add">■ added</span><span class="tl edit">■ edited</span>'
    + '<span class="tl del">■ deleted</span><span class="tl reuse">■ reused</span>'
    + '<span class="tl none">■ unchanged (context)</span></div>';
  return {
    comments,
    link: '<a href="#tree"><b>&#128193; File tree</b></a>',
    html: '<div class="tree-wrap" id="tree"><h3>Project structure &mdash; what changes, where</h3>'
      + '<p class="hint">Highlighted files are the ones this plan touches &mdash; click any to jump to its code-flow card. Everything else is unchanged context.</p>'
      + legend + '<pre class="tree">' + body + '</pre></div>',
  };
}

// ---- page assembly ---------------------------------------------------------

// template.html <style> block, embedded VERBATIM (Prism <link> is added locally
// below; showcase sc-* classes are appended after so they never collide).
const TEMPLATE_CSS = `
  :root{
    --io:#fff4c2; --io-b:#b8860b;
    --process:#e7f0ff; --process-b:#3b6fb6;
    --decision:#ffe1e1; --decision-b:#c0392b;
    --data:#e3f7ea; --data-b:#2e7d32;
    --ink:#1f2430; --muted:#6b7280; --line:#e5e7eb; --bg:#f6f7fb;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.5}
  a{color:#2563eb;text-decoration:none}
  code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}
  .layout{display:flex;align-items:flex-start}
  aside{position:sticky;top:0;height:100vh;width:250px;flex:0 0 250px;overflow:auto;background:#fff;border-right:1px solid var(--line);padding:16px 12px}
  aside h1{font-size:15px;margin:4px 6px 2px}
  aside .meta{font-size:11px;color:var(--muted);margin:0 6px 12px}
  .nav-group{margin:10px 0}
  .nav-fam{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--fc);border-left:3px solid var(--fc);padding-left:6px;margin-bottom:4px}
  aside a{display:block;font-size:13px;color:#374151;padding:3px 6px 3px 12px;border-radius:6px}
  aside a:hover{background:var(--bg)}
  main{flex:1;min-width:0;padding:24px 28px 80px;max-width:1000px;margin:0 auto}
  body.nav-hidden aside{display:none}
  .topbar{position:sticky;top:0;z-index:5;background:rgba(246,247,251,.92);backdrop-filter:blur(6px);padding:10px 0 14px;margin-bottom:8px;border-bottom:1px solid var(--line)}
  .topbar h2{margin:0 0 2px;font-size:22px}
  .topbar p{margin:0;color:var(--muted);font-size:13px}
  .controls{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  .controls input{flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:14px}
  .controls button{padding:8px 12px;border:1px solid var(--line);background:#fff;border-radius:8px;cursor:pointer;font-size:13px}
  .controls button:hover{background:#fff;border-color:#9ca3af}
  .legend{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:14px 0}
  .legend h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .legend .row{display:flex;flex-wrap:wrap;gap:14px}
  .chip{display:inline-flex;align-items:center;gap:7px;font-size:13px}
  .swatch{width:26px;height:18px;border-radius:4px;border:2px solid}
  .swatch.io{background:var(--io);border-color:var(--io-b);transform:skewX(-18deg)}
  .swatch.process{background:var(--process);border-color:var(--process-b)}
  .swatch.decision{background:var(--decision);border-color:var(--decision-b);border-radius:3px;transform:rotate(45deg) scale(.8)}
  .swatch.data{background:var(--data);border-color:var(--data-b);border-radius:10px}
  .overview{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0 26px}
  .overview h3{margin:0 0 4px;font-size:16px}
  .overview p.hint{margin:0 0 8px;color:var(--muted);font-size:13px}
  .card{background:#fff;border:1px solid var(--line);border-left:6px solid var(--fc);border-radius:12px;padding:18px 20px;margin:0 0 22px;scroll-margin-top:120px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .chead{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  .badge{color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px}
  .num{font-size:12px;color:var(--muted);font-weight:700}
  .chead h2{font-size:19px;margin:0;flex:1 1 100%}
  .hmeta{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .fname{font-size:12px;background:var(--bg);padding:2px 7px;border-radius:6px;color:#374151}
  .fw{font-size:12px;color:var(--muted);font-weight:600}
  .one{font-size:15px;margin:10px 0 6px}
  .wwh{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .wwh th{width:58px;text-align:left;vertical-align:top;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;white-space:nowrap}
  .wwh td{padding:8px 11px;vertical-align:top;color:#374151;background:#fbfbfe;border-bottom:1px solid var(--line)}
  .wwh tr:last-child td{border-bottom:0}
  .wwh tr.what th{background:#3b6fb6}.wwh tr.why th{background:#b8860b}.wwh tr.how th{background:#2e7d32}
  .analogy{font-size:13.5px;color:#4b5563;background:#fbfbfe;border:1px dashed var(--line);border-radius:8px;padding:8px 11px;margin:8px 0}
  .analogy b{color:var(--fc);margin-right:4px}
  .iogrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
  .io{border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:13.5px}
  .io h4{margin:0 0 3px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .io.in h4{color:#b8860b}.io.out h4{color:#2e7d32}
  .io p{margin:0;color:#374151}
  .pressgo h4,.mech h4{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 4px}
  .pressgo pre.codeblock{margin:0}
  .mech p{margin:0;font-size:13.5px;color:#374151}
  .diagram{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;margin:14px 0;overflow:auto}
  .mermaid{display:flex;justify-content:center}
  .stepbox{margin-top:6px}
  .stepbox summary,.codebox summary{cursor:pointer;font-size:13px;font-weight:600;color:#374151;padding:6px 0}
  .codebox{margin-top:6px}
  pre.codeblock{background:#1e1e1e;color:#d4d4d4;border:1px solid #2d2d2d;border-radius:8px;padding:13px 15px;overflow:auto;margin:6px 0 0;font-size:12.5px;line-height:1.55;max-height:520px;text-shadow:none}
  pre.codeblock code{white-space:pre;text-shadow:none;background:none}
  .fs-btn{margin:6px 0 0;padding:4px 11px;border:1px solid #2d2d2d;background:#252526;color:#d4d4d4;border-radius:6px;cursor:pointer;font-size:12px}
  .fs-btn:hover{background:#2d2d30;border-color:#3d3d40}
  .codebox pre.codeblock:fullscreen{max-height:none;width:100vw;height:100vh;font-size:14px;line-height:1.6;padding:26px 30px;margin:0}
  .steptbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  .steptbl th,.steptbl td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
  .steptbl th{background:var(--bg);font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
  .steptbl td.st{font-weight:600;white-space:nowrap}
  .steptbl td.st.io{color:var(--io-b)}.steptbl td.st.process{color:var(--process-b)}
  .steptbl td.st.decision{color:var(--decision-b)}.steptbl td.st.data{color:var(--data-b)}
  .notes{margin-top:14px}
  .notes h4{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 5px}
  .note{min-height:46px;border:1px dashed #c7cdd6;border-radius:8px;padding:9px 11px;font-size:14px;background:#fffef7}
  .note:focus{outline:none;border-color:var(--fc);background:#fff}
  .note:empty:before{content:attr(data-ph);color:#9aa3b2}
  footer{color:var(--muted);font-size:12px;text-align:center;padding:20px}
  /* ---- UI showcase (namespaced sc-* so it never collides with .card/.chip/.mermaid above) ---- */
  .sc-wrap{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0 26px}
  .sc-wrap h3{margin:0 0 10px;font-size:16px}
  .sc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .sc-chip{font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid var(--line)}
  .sc-chip.warn{background:#fddede;color:#c62828;border-color:#f2b8b8}
  .sc-chip.ok{background:#e3f7ea;color:#2e7d32;border-color:#a9e2a9}
  .sc-chip.muted{background:transparent;color:var(--muted)}
  .sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
  .sc-card{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg)}
  .sc-card.empty{border-style:dashed;border-color:#f2b8b8}
  .sc-name{font-size:12px;font-weight:650;padding:8px 12px;border-bottom:1px solid var(--line);background:#fff}
  .sc-frame{width:100%;height:300px;border:0;background:#fff;display:block}
  .sc-missing{padding:20px 12px;font-size:12px;color:#c62828}
  .warn-box{font-size:13px;color:#c62828;background:#fddede;border:1px solid #f2b8b8;border-radius:8px;padding:12px;margin:12px 0}
  /* ---- file tree (architecture overview) ---- */
  .tree-wrap{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0 26px}
  .tree-wrap h3{margin:0 0 4px;font-size:16px}
  .tree-wrap .hint{margin:0 0 10px;color:var(--muted);font-size:13px}
  .tree-legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:10px;font-size:12px;color:var(--muted)}
  .tree-legend .tl.add{color:#16a34a}.tree-legend .tl.edit{color:#d97706}.tree-legend .tl.del{color:#dc2626}.tree-legend .tl.reuse{color:#2563eb}
  pre.tree{background:#0f172a;color:#cbd5e1;border-radius:8px;padding:14px 16px;overflow:auto;margin:0;
        font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:12.5px;line-height:1.65}
  pre.tree a.tf{font-weight:700;text-decoration:none;border-bottom:1px dashed currentColor}
  pre.tree a.tf.add{color:#4ade80}pre.tree a.tf.edit{color:#fbbf24}pre.tree a.tf.del{color:#f87171}pre.tree a.tf.reuse{color:#60a5fa}
  pre.tree a.tf:hover{background:rgba(255,255,255,.10)}
  pre.tree strong.tb{color:#fff;font-weight:700}
  pre.tree .tree-cm{color:#64748b}
  @media (max-width:820px){aside{display:none}.iogrid{grid-template-columns:1fr}}
`;

function buildBlueprint(spec, specErr) {
  const scripts = (spec.scripts || []).map((s) => { s.anchor = s.anchor || slugify(s.file); return s; });
  const title = spec.title || 'Plan blueprint';
  const subtitle = spec.subtitle || 'UI showcase + per-file code flow — preview before approval';

  const sidebar = scripts.map((s) =>
    '<a href="#' + e(s.anchor) + '">' + e(s.topic || s.file) + '</a>').join('\n');

  const sc = showcaseSection(spec);
  const tree = treeSection(spec);

  const overview = spec.overview_mermaid
    ? '<div class="overview" id="overview"><h3>The big picture &mdash; how the changed files connect</h3>'
      + '<p class="hint">Read top &rarr; bottom. Arrows show how the pieces relate.</p>'
      + '<div class="mermaid">' + e(spec.overview_mermaid) + '</div></div>'
    : '';

  const specErrBox = specErr
    ? '<div class="warn-box"><b>Code flow unavailable — ' + e(specErr) + '.</b>'
      + ' Every /plan must end with ONE <code>```plan-blueprint</code> JSON block'
      + ' (the script-to-diagram format: per-file code-flow cards). Add it and re-run —'
      + ' the retired legacy <code>```mermaid</code> tree is no longer rendered.</div>'
    : '';

  const cards = scripts.map((s, i) => scriptCard(s, i + 1, tree.comments || {})).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<link rel="stylesheet" href="assets/prism-vsc-dark-plus.min.css">
<style>${TEMPLATE_CSS}</style>
</head>
<body>
<div class="layout">
  <aside>
    <h1>${e(title)}</h1>
    <p class="meta">${scripts.length} file${scripts.length === 1 ? '' : 's'} changed</p>
    ${tree.link}
    ${overview ? '<a href="#overview"><b>&#9776; Big picture</b></a>' : ''}
    ${sc.html ? '<a href="#showcase"><b>&#9635; UI showcase</b></a>' : ''}
    ${sidebar}
  </aside>
  <main>
    <div class="topbar">
      <h2>${e(title)}</h2>
      <p>${e(subtitle)}</p>
      <div class="controls">
        <button id="toggleNav" title="Show or hide the left sidebar">&#9776; Sidebar</button>
        <input id="filter" type="search" placeholder="Filter files (type a file name or topic)…">
        <button id="expandAll">Expand all details &amp; code</button>
        <button id="collapseAll">Collapse all</button>
      </div>
    </div>
    ${specErrBox}
    ${tree.html}
    ${sc.html ? '<div id="showcase">' + sc.html + '</div>' : ''}
    <div class="legend">
      <h3>How to read every diagram</h3>
      <div class="row">
        <span class="chip"><span class="swatch io"></span> Input / Output</span>
        <span class="chip"><span class="swatch process"></span> A step that does work</span>
        <span class="chip"><span class="swatch decision"></span> A decision / branch</span>
        <span class="chip"><span class="swatch data"></span> A piece of data</span>
      </div>
      <div class="row" style="margin-top:8px;color:var(--muted);font-size:12.5px">
        <span>Arrows show the order things run. A labelled arrow (e.g. <b>yes</b> / <b>no</b>) shows which branch is taken.</span>
      </div>
    </div>
    ${overview}
    ${cards}
    <footer>Code flow uses the <code>script-to-diagram</code> format &middot; diagrams render via vendored Mermaid.js &middot; notes save in this browser only.</footer>
  </main>
</div>
<script src="assets/mermaid.min.js"></script>
<script>
  if (window.mermaid) {
    mermaid.initialize({
      startOnLoad: true, theme: 'base', securityLevel: 'loose',
      flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
      themeVariables: { fontSize: '14px', fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif' }
    });
  } else {
    document.querySelectorAll('.mermaid').forEach(function(m){ m.innerHTML = '<p style="color:#c62828">mermaid.min.js failed to load — re-run the vendor step.</p>'; });
  }
  // editable notes persist per-card
  document.querySelectorAll('.note').forEach(function (n) {
    var k = 'blueprint:' + n.dataset.key;
    var saved = localStorage.getItem(k);
    if (saved !== null) n.innerHTML = saved;
    n.addEventListener('input', function () { localStorage.setItem(k, n.innerHTML); });
  });
  // live filter
  var f = document.getElementById('filter');
  if (f) f.addEventListener('input', function () {
    var q = f.value.trim().toLowerCase();
    document.querySelectorAll('.card').forEach(function (c) {
      c.style.display = (!q || (c.dataset.search || '').indexOf(q) > -1) ? '' : 'none';
    });
  });
  var ea = document.getElementById('expandAll'); if (ea) ea.onclick = function () {
    document.querySelectorAll('details.stepbox, details.codebox').forEach(function (d) { d.open = true; }); };
  var ca = document.getElementById('collapseAll'); if (ca) ca.onclick = function () {
    document.querySelectorAll('details.stepbox, details.codebox').forEach(function (d) { d.open = false; }); };
  var NAVK = 'blueprint:nav-hidden';
  if (localStorage.getItem(NAVK) === '1') document.body.classList.add('nav-hidden');
  var tn = document.getElementById('toggleNav'); if (tn) tn.onclick = function () {
    var hidden = document.body.classList.toggle('nav-hidden'); localStorage.setItem(NAVK, hidden ? '1' : '0'); };
  // fullscreen a code block
  document.addEventListener('click', function (evt) {
    var btn = evt.target.closest('.fs-btn'); if (!btn) return;
    var pre = btn.parentElement.querySelector('pre.codeblock');
    if (pre && pre.requestFullscreen) pre.requestFullscreen();
  });
</script>
<script src="assets/prism.min.js"></script>
<script src="assets/prism-typescript.min.js"></script>
<script src="assets/prism-jsx.min.js"></script>
<script src="assets/prism-tsx.min.js"></script>
<script src="assets/prism-python.min.js"></script>
<script>if (window.Prism) Prism.highlightAll();</script>
</body>
</html>`;
}
