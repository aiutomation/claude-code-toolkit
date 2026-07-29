#!/usr/bin/env node
// UserPromptSubmit hook. Watches each prompt for "/challenger [level]" (also
// @challenger / $challenger) and deactivation phrases, rewrites the flag file,
// and injects the persona immediately so the toggle takes effect THIS turn.
// Mirrors ponytail-mode-tracker.js.
const { setMode, clearMode, writeHookOutput } = require('./challenger-runtime');
const { getChallengerInstructions } = require('./challenger-instructions');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input.replace(/^﻿/, '')); // strip BOM
    const prompt = (data.prompt || '').trim().toLowerCase();

    if (/^[\/@$]challenger\b/.test(prompt)) {
      const arg = prompt.split(/\s+/)[1] || '';
      let mode;
      if (arg === 'lite') mode = 'lite';
      else if (arg === 'ultra') mode = 'ultra';
      else if (arg === 'off') mode = 'off';
      else mode = 'full';                 // bare /challenger => full

      if (mode === 'off') {
        clearMode();
        writeHookOutput('UserPromptSubmit', 'off', 'CHALLENGER MODE OFF — reverting to normal behavior.');
      } else {
        setMode(mode);
        writeHookOutput('UserPromptSubmit', mode, getChallengerInstructions(mode));
      }
      return;
    }

    if (/\b(stop challenger|normal mode)\b/i.test(prompt)) {
      clearMode();
      writeHookOutput('UserPromptSubmit', 'off', 'CHALLENGER MODE OFF — reverting to normal behavior.');
    }
  } catch (e) {}
});
