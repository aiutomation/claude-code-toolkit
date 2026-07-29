#!/usr/bin/env node
// SessionStart hook. Runs on startup|resume|clear|compact. Reads the persisted
// level (flag file is source of truth; falls back to the configured default,
// which is 'off'), and — if active — injects the full filtered persona as
// additionalContext so Challenger mode survives across sessions and /clear.
const { getDefaultMode } = require('./challenger-config');
const { getMode, setMode, clearMode, writeHookOutput } = require('./challenger-runtime');
const { getChallengerInstructions } = require('./challenger-instructions');

const mode = getMode() || getDefaultMode();

if (mode === 'off') {
  clearMode();          // ensure no stale flag lingers
  process.exit(0);      // dormant: inject nothing
}

try { setMode(mode); } catch (e) {}  // refresh flag (keeps statusline/state consistent)
writeHookOutput('SessionStart', mode, getChallengerInstructions(mode));
