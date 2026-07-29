# Attribution

Challenger's hook architecture is a remix of [**ponytail**](https://github.com/DietrichGebert/ponytail)
by Dietrich Gebert — specifically the pattern of a persistent session mode built from three parts:

- a state flag file in `~/.claude` that survives `/clear` and restarts,
- a `SessionStart` hook that re-injects the persona from that flag,
- a `UserPromptSubmit` hook that parses `/<mode> <level>` out of the raw prompt so a level switch
  takes effect the same turn.

The five `challenger-*.js` files mirror ponytail's `ponytail-*.js` structure (config resolver,
runtime state manager, instruction builder with intensity filtering, activate, mode tracker).
The persona content, the six-rung challenge ladder, the when-NOT-to-challenge rules, and the
opt-in-by-default behavior are original to this plugin.

ponytail is MIT licensed:

```
MIT License

Copyright (c) 2026 DietrichGebert
```

Thanks to Dietrich for a genuinely good design worth copying.
