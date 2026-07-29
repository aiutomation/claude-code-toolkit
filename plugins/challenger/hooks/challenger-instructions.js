#!/usr/bin/env node
// Instruction builder for Challenger mode. Mirrors ponytail-instructions.js:
// reads skills/challenger/SKILL.md, strips YAML frontmatter, and filters
// intensity-tagged lines so only the active level's table row / examples show.
//
// Tagging convention (same as ponytail):
//   table rows  ->  | **lite** | ... |   (shown only when that level is active)
//   bullets     ->  - lite: ...          (shown only when that level is active)
//   everything else is shown in all levels.
const fs = require('fs');
const path = require('path');
const { DEFAULT_MODE, normalizeMode } = require('./challenger-config');

// Resolved relative to this file, NOT to ~/.claude — the skill ships inside the
// plugin, so it must be found wherever the plugin cache happens to live.
const SKILL_PATH = path.join(__dirname, '..', 'skills', 'challenger', 'SKILL.md');

function filterSkillBodyForMode(body, mode) {
  const effectiveMode = normalizeMode(mode) || 'full';
  const withoutFrontmatter = String(body || '').replace(/^---[\s\S]*?---\s*/, '');
  return withoutFrontmatter.split(/\r?\n/).filter((line) => {
    const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
    if (tableLabel) {
      const labelMode = normalizeMode(tableLabel[1].trim());
      if (labelMode) return labelMode === effectiveMode;
    }
    const exampleLabel = line.match(/^-\s*([^:]+):\s*/);
    if (exampleLabel) {
      const labelMode = normalizeMode(exampleLabel[1].trim());
      if (labelMode) return labelMode === effectiveMode;
    }
    return true;
  }).join('\n');
}

// Used only if SKILL.md can't be read — keeps the mode functional regardless.
function getFallbackInstructions(mode) {
  return 'CHALLENGER MODE ACTIVE — level: ' + mode + '\n\n' +
    'You are a conservative, skeptical staff engineer. Challenge the user\'s ' +
    'decisions AND the existing code ONLY when warranted (correctness/safety, ' +
    'reinvented stdlib, inefficiency, spaghetti/dead/duplicate code, ' +
    'non-idiomatic patterns, premature complexity). When code is fine, say so ' +
    'in one line and proceed — no manufactured objections. Accuracy over ' +
    'agreeableness: lead with the objection + a concrete better alternative + ' +
    'confidence. Off only: "stop challenger" / "normal mode". Switch: ' +
    '/challenger lite|full|ultra.';
}

function getChallengerInstructions(mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  try {
    return 'CHALLENGER MODE ACTIVE — level: ' + effectiveMode + '\n\n' +
      filterSkillBodyForMode(fs.readFileSync(SKILL_PATH, 'utf8'), effectiveMode);
  } catch (e) {
    return getFallbackInstructions(effectiveMode);
  }
}

module.exports = { filterSkillBodyForMode, getFallbackInstructions, getChallengerInstructions };
