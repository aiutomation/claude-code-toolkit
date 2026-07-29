#!/usr/bin/env node
// Config resolver for Challenger mode. Mirrors ponytail-config.js.
// Resolves the DEFAULT level (used when no per-session flag is set) from:
//   env CHALLENGER_DEFAULT_MODE  >  ~/.config/challenger/config.json  >  'off'
// Challenger is OPT-IN, so the hard default is 'off' (ponytail defaults to 'full').
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MODE = 'off';
const VALID_MODES = ['off', 'lite', 'full', 'ultra'];

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null;
  const n = mode.trim().toLowerCase();
  return VALID_MODES.includes(n) ? n : null;
}

// ~/.claude (or CLAUDE_CONFIG_DIR override) — where the runtime flag file lives.
function getClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// ~/.config/challenger (or %APPDATA%\challenger on Windows) — the persistent default.
function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'challenger');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'challenger');
  }
  return path.join(os.homedir(), '.config', 'challenger');
}
function getConfigPath() { return path.join(getConfigDir(), 'config.json'); }

function getDefaultMode() {
  const envMode = process.env.CHALLENGER_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase())) return envMode.toLowerCase();
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    if (config.defaultMode && VALID_MODES.includes(config.defaultMode.toLowerCase())) {
      return config.defaultMode.toLowerCase();
    }
  } catch (e) {}
  return DEFAULT_MODE;
}

module.exports = {
  DEFAULT_MODE, VALID_MODES,
  normalizeMode, getClaudeDir, getConfigDir, getConfigPath, getDefaultMode,
};
