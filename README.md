# claude-code-toolkit

Three Claude Code plugins pulled out of my daily config. They are not demos. Each one runs on every
session I work in, which is the only real reason to trust them.

```
/plugin marketplace add aiutomation/claude-code-toolkit
```

Then install whichever you want. Each page below is a standalone product page with the full mechanic,
config, and honest limitations.

## [visual-plan](plugins/visual-plan): see the plan before you approve it

Plan mode hands you a wall of markdown and asks you to approve it. This renders every plan as an
interactive page in your browser first: a repo tree with changed files highlighted, one card per file
explaining what changes and why, a flowchart, and old-vs-new UI previews. Offline, no dependencies.

```
/plugin install visual-plan@claude-code-toolkit
```

![A rendered plan blueprint: file tree with changed files highlighted, and an old-vs-new UI preview](plugins/visual-plan/assets/docs/blueprint-overview.png)

## [challenger](plugins/challenger): a session mode that pushes back

A skeptical staff engineer that challenges your decisions and the existing code, but only when there is
something real to challenge. Silence when the code is fine is the whole discipline. Three intensity
levels, and it survives `/clear` and restarts until you turn it off.

```
/plugin install challenger@claude-code-toolkit
```

## [apply-improvements](plugins/apply-improvements): make your config learn

Claude notices things about your workflow every session, then the session ends and it all evaporates. A
`SessionEnd` hook queues the raw material with zero judgement; later, a skill audits it across five
config surfaces and applies only the edits you approve, one at a time.

```
/plugin install apply-improvements@claude-code-toolkit
```

## Requirements

| Plugin | Needs | Notes |
|---|---|---|
| visual-plan | Node | python3 only for the bundled `script-to-diagram` skill; git enables the in-repo copy |
| challenger | Node | no network, no API key |
| apply-improvements | Python 3 | git for the repo signals |

Every hook checks for its runtime and exits quietly when it is missing, so a partial setup degrades
instead of erroring at you. No plugin here makes a network call, needs an API key, or installs an npm
package.

## Notes

All three are MIT licensed and composable. `challenger` governs what gets flagged rather than prose
tone, so it stacks with whatever output style you already run. `visual-plan` ships its Mermaid and Prism
copies locally ([licenses](plugins/visual-plan/assets/VENDOR-LICENSES.md)) so blueprints render with no
network. `challenger`'s hook architecture is a remix of
[ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert
([attribution](plugins/challenger/NOTICE.md)).

Bug reports are welcome, and the interesting ones are behavioral: a challenge that fired on code it
should have left alone, or a plan whose blueprint came out wrong. Open an issue with the input.
