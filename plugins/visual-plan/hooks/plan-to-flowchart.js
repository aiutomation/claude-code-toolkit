#!/usr/bin/env node
// plan-to-flowchart.js — dual-event hook for ExitPlanMode.
//
//   PreToolUse  → spawn a detached heuristic render so the SVG opens BEFORE the
//                 user approves (lets them verify the plan visually first).
//   PostToolUse → inject additionalContext so Claude renders a polished version
//                 after approval, overwriting the heuristic SVG.
//
// Hook payload carries `hook_event_name` ("PreToolUse" | "PostToolUse"). We
// branch on it. Plan text lives under `tool_input.plan` (pre) or occasionally
// `tool_response.plan` / `response.plan` (varies by Claude Code version).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, exec } = require('child_process');

const home = os.homedir();
// Plan artifacts live in a dedicated, non-ephemeral folder you can revisit anytime.
// VISUAL_PLAN_DIR relocates it; keep this in sync with render-plan-blueprint.js.
const planDir = process.env.VISUAL_PLAN_DIR || path.join(home, '.claude', 'plan-mermaid');
fs.mkdirSync(planDir, { recursive: true });
const planFile = path.join(planDir, 'last-plan.md');

// STRICT MODE — off by default.
//   off (default): a missing/invalid/thin plan-blueprint block is reported as advice
//                  and the page renders with whatever is there.
//   on:            those three cases DENY ExitPlanMode, forcing Claude to fix the
//                  block before you can approve the plan.
// Resolution order mirrors challenger-config.js: env var, then config file, then off.
// ponytail: two sources, no schema validation — a malformed config just reads as off.
function strictMode() {
  const env = String(process.env.VISUAL_PLAN_STRICT || '').trim().toLowerCase();
  if (env === '1' || env === 'true' || env === 'strict') return true;
  if (env === '0' || env === 'false') return false;
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'visual-plan')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'visual-plan')
      : path.join(home, '.config', 'visual-plan');
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).strict === true;
  } catch { return false; }
}
const STRICT = strictMode();

// Entry-trace: append timestamp + event name BEFORE any other logic so we can
// verify whether Claude Code is actually invoking the hook on ExitPlanMode.
// Tail ~/.claude/plan-mermaid/hook-trace.log to debug "hook not firing" reports.
try {
  fs.appendFileSync(
    path.join(planDir, 'hook-trace.log'),
    `[${new Date().toISOString()}] plan-to-flowchart.js invoked (pid=${process.pid})\n`
  );
} catch {}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let plan = '';
  let payload = {};
  let event = '';
  try {
    payload = JSON.parse(raw || '{}');
    event = payload.hook_event_name || '';
    plan =
      (payload.tool_input && payload.tool_input.plan) ||
      (payload.tool_response && payload.tool_response.plan) ||
      (payload.response && payload.response.plan) ||
      payload.plan || '';
  } catch { /* malformed payload — emit nothing */ }

  try { fs.writeFileSync(planFile, plan); } catch {}
  try {
    fs.writeFileSync(
      path.join(planDir, 'last-plan-payload.json'),
      JSON.stringify(payload, null, 2)
    );
  } catch {}

  if (plan.length < 50) { process.stdout.write('{}'); return; }

  if (event === 'PreToolUse') return handlePre();
  return handlePost();

  // ----- PreToolUse: SYNCHRONOUSLY render the blueprint before the dialog -----
  // Pipe the whole plan markdown to render-plan-blueprint.js, which extracts the
  // single ```plan-blueprint JSON spec itself and stitches ONE combined HTML page
  // (per-file code-flow cards + UI showcase iframe + client-side-rendered Mermaid,
  // vendored locally). Legacy ```mermaid/```plan-showcase blocks still fall back.
  // The approval dialog only shows after this hook returns, so the blueprint is
  // on screen by the time the user decides. Requires hook timeout >= 15s.
  //
  // No more `mmdc`/SVG: the browser is the only renderer (it never broke; mmdc
  // did, ~2026-06-19). A write+open is ~1s, comfortably inside the 20s budget.
  function handlePre() {
    // THE GATE. The plan-blueprint block is the only accepted preview format, and
    // the prompt-submit reminder fires too early to be reliable — after a long
    // planning session the model often forgets to append the block. So the three
    // checks below run at the exact moment the plan is finalized.
    //
    // In STRICT mode each check DENIES ExitPlanMode, forcing a fix before you can
    // approve. By default they only advise, and the page renders regardless (a
    // missing or broken block renders as a diagnostic warn-box). Strict is opt-in
    // because denying plan approval is a big behavior change to inherit silently.
    // ponytail: stateless deny, no retry counter — the model complies on the next
    //           call; if it ever looped you just interrupt. Add a counter only if
    //           real loops show up.
    const advice = [];
    // (1) Block missing.
    const specRaw = (/```plan-blueprint\s*\n([\s\S]*?)\n```/.exec(plan) || [])[1];
    if (specRaw == null) {
      if (gate(advice,
        'This plan is missing the REQUIRED ```plan-blueprint block, so the plan-preview cannot render. '
        + 'Do NOT rewrite the plan — just APPEND, at the very end under a "## Blueprint" heading, ONE fenced '
        + 'block whose info-string is exactly  plan-blueprint  containing a single JSON object (the '
        + '/script-to-diagram format: "title", "subtitle", "scripts"[] with one object per changed file. '
        + 'Each scripts[] entry is a FILE-level explanation and MUST carry the required core: '
        + '{file, change, topic, oneliner, what, why, how} — what the file does / what changes / why. '
        + 'A card with only {file, change} renders as an empty stub and dead-ends every tree & sidebar link, '
        + 'so never emit one. "steps"[]/"edges"[] (the flowchart) are OPTIONAL — add them only when the change '
        + 'has real internal control flow; skip them for a plain edit. Add optional "components"[] for Medium+ '
        + 'UI changes. The full field schema is in the [plan-mermaid-prompt hook] context from the start of '
        + 'this session. Then call ExitPlanMode again with the block included.'
      )) return;
    }
    // (2) Block present but JSON invalid — repair it before approval rather than
    //     shipping a red parse-error card.
    let spec;
    if (specRaw != null) {
      try { spec = JSON.parse(specRaw); }
      catch (err) {
        if (gate(advice,
          'The ```plan-blueprint block is present but its JSON did not parse (' + err.message + '). '
          + 'Repair ONLY the block (escape newlines inside strings as \\n, remove trailing commas, balance the '
          + 'braces/brackets) — do NOT rewrite the plan prose — then call ExitPlanMode again.'
        )) return;
      }
    }
    // (3) Thin-card gate: every CHANGED-file card must actually EXPLAIN the change.
    //     Require BOTH "what" and "why" per file (a pure delete still has both);
    //     "how" is not universally required (a delete has no "how"). This is what
    //     forces rich cards instead of empty stubs — the file explanation the user
    //     keeps losing. The renderer's tree-comment fallback is the backstop for
    //     anything that still slips; this gate is the primary guarantee.
    const has = (v) => v != null && String(v).trim() !== '';
    const thin = (spec && Array.isArray(spec.scripts) ? spec.scripts : [])
      .filter((s) => s && s.file)
      .filter((s) => !(has(s.what) && has(s.why)))
      .map((s) => s.file);
    if (thin.length) {
      if (gate(advice,
        'The plan-blueprint gives empty/near-empty cards for ' + thin.length + ' changed file'
        + (thin.length > 1 ? 's' : '') + ': ' + thin.join(', ') + '. Each scripts[] entry is a FILE-level '
        + 'explanation and MUST carry BOTH "what" (concretely what is edited/added in THIS file) and "why" '
        + '(the problem/goal driving it) — plus "how" unless it is a pure delete, and topic + oneliner. '
        + 'You already wrote good one-line descriptions in the tree # comments; lift those into each card\'s '
        + 'what/why/how — never leave a card blank, because every tree & sidebar link points at one. '
        + 'Keep the SAME plan-blueprint block, just fill the fields, then call ExitPlanMode again.'
      )) return;
    }
    // (4) Render the preview. The renderer ships beside this file, so resolve it
    //     from __dirname — never from ~/.claude, which does not contain it once
    //     this runs as a plugin. Pass the session cwd so the renderer can also drop
    //     an in-repo copy at <git-root>/.plan-blueprints/.
    const cwd = (payload && payload.cwd) || process.cwd();
    spawnSync(
      'node',
      [path.join(__dirname, 'render-plan-blueprint.js'), cwd],
      { input: plan, encoding: 'utf8', windowsHide: true, timeout: 15000 }
    );
    // Render failure is non-blocking — the approval dialog still proceeds. Any
    // advisory notes from the non-strict gate ride along as context.
    if (advice.length) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: '[visual-plan] The blueprint rendered with gaps. '
            + 'Set VISUAL_PLAN_STRICT=1 to make these blocking instead of advisory.\n'
            + advice.join('\n'),
        },
      }));
      return;
    }
    process.stdout.write('{}');
  }

  // Strict mode: deny ExitPlanMode and return true (caller stops).
  // Default mode: collect the reason as advice and return false (caller continues).
  function gate(advice, reason) {
    if (!STRICT) { advice.push(reason); return false; }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }));
    return true;
  }

  // ----- PostToolUse: instruct Claude to render a polished overwrite -----
  function handlePost() {
    const additionalContext = [
      '[plan-to-flowchart hook] A plan was just approved. A blueprint (UI showcase + per-file code-flow cards) was already opened at PreToolUse time from the plan markdown. Only re-render if the embedded ```plan-blueprint spec was thin or missing — otherwise skip; the PreToolUse render is already good.',
      '',
      'DIAGRAM SINK — the code-flow diagram for THIS plan already lives at <git-root>/.plan-blueprints/latest.html. Do NOT run the bundled /script-to-diagram skill or build_map.py as part of executing this plan: that skill is for standalone script-map requests the user asks for by name, never a /plan execution artifact. They share the card FORMAT but write to different places; don\'t conflate them.',
      '',
      'HOW TO RE-RENDER (single Bash call — pass $PWD so the in-repo copy updates too):',
      `  cat "${planFile}" | node "${path.join(__dirname, 'render-plan-blueprint.js')}" "$PWD"`,
      '',
      `That re-reads the saved plan and rebuilds ${path.join(planDir, 'current-blueprint.html')} AND an in-repo copy at <git-root>/.plan-blueprints/latest.html (diagrams render in the browser from locally-vendored mermaid+prism — offline, no external CLI). Stable paths, so repeat runs overwrite.`,
      '',
      'IF re-authoring for a richer render, keep the SAME single ```plan-blueprint JSON block the injection hook specified (scripts[] in the /script-to-diagram format + components[] for the UI showcase). One block builds the whole page.',
      '',
      'AFTER RENDERING: proceed with plan execution. Render ONCE — do not re-render between steps.',
      `Plan source cached at ${planFile}.`,
    ].join('\n');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext,
      },
    }));
  }
});
