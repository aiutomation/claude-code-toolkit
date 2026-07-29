# claude-code-toolkit

Each plugin now lives in its own repo. Go there for docs, issues, and releases:

| Plugin | What it does |
|---|---|
| **[visual-plan](https://github.com/aiutomation/claude-visual-plan)** | Renders every Claude Code plan as an interactive page before you approve it: file tree, per-file what/why/how cards, flowchart, old-vs-new UI previews. |
| **[challenger](https://github.com/aiutomation/claude-challenger)** | A session mode that pushes back on your decisions and your codebase when warranted, and stays silent when the code is fine. |
| **[apply-improvements](https://github.com/aiutomation/claude-apply-improvements)** | Turns what each session revealed into config edits you approve one at a time. |

This repo is kept as an umbrella marketplace for anyone who wants all three from one place. It holds no
plugin code: each entry points at the standalone repo above, so you always get that repo's latest.

```
/plugin marketplace add aiutomation/claude-code-toolkit
/plugin install visual-plan@claude-code-toolkit
/plugin install challenger@claude-code-toolkit
/plugin install apply-improvements@claude-code-toolkit
```

Installing one plugin on its own is the same two steps against its own repo, and that is the better
route if you only want one:

```
/plugin marketplace add aiutomation/claude-visual-plan
/plugin install visual-plan@visual-plan
```

All three are MIT licensed. No plugin here makes a network call, needs an API key, or installs an npm
package.
