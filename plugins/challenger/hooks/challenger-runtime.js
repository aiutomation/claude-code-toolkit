// State manager for Challenger mode. Mirrors ponytail-runtime.js but the flag
// file is the SINGLE SOURCE OF TRUTH for cross-session persistence (ponytail
// reads its default from config instead). Flag file: ~/.claude/.challenger-active
// — a single trimmed word: 'lite' | 'full' | 'ultra'. Absent file = mode off.
const fs = require('fs');
const path = require('path');
const { getClaudeDir } = require('./challenger-config');

const STATE_FILE = '.challenger-active';
const statePath = path.join(getClaudeDir(), STATE_FILE);

function getMode() {
  try {
    const v = fs.readFileSync(statePath, 'utf8').trim().toLowerCase();
    return v || null;
  } catch (e) {
    return null; // no flag file => not active
  }
}

function setMode(mode) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, mode);
}

function clearMode() {
  try { fs.unlinkSync(statePath); } catch (e) {}
}

// Claude Code reads a command hook's raw stdout as additionalContext for both
// SessionStart and UserPromptSubmit, so we just write the context string.
function writeHookOutput(_event, _mode, context = '') {
  if (context) process.stdout.write(context);
}

module.exports = { statePath, getMode, setMode, clearMode, writeHookOutput };
