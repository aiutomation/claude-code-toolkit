# Diagram conventions

These rules keep every generated diagram consistent and easy to read. They follow the
user's refined Mermaid spec (standard shapes, fixed legend, detail in a separate panel,
compact layout, plain-language layer).

## 1. Shapes (one meaning each)
| Step `type` | Shape         | Means                          |
|-------------|---------------|--------------------------------|
| `io`        | parallelogram | input from / output to the user|
| `process`   | rectangle     | a step that does work          |
| `decision`  | diamond       | a yes/no or branch point       |
| `data`      | rounded pill  | a piece of data produced       |

(`build_map.py` maps these to Mermaid brackets and colours automatically — never hand-write
the brackets in `specs.json`.)

## 2. Labels vs notes
- **Label** (in the box): ≤ 4 words. It is the *name* of the step.
- **Note** (in the "Step details" table): one plain-language sentence. Define jargon here.
- This keeps the flow scannable and puts explanation in a separate panel.

## 3. Edges
Write edges as plain strings:
- `A --> B`  (simple flow)
- `Q? -- yes --> C`  (labelled branch — the label is what's between the dashes)

Endpoint text must match a step `label` exactly. A loop is just an edge that points back
to an earlier label (e.g. `TERMINATE? -- no --> AutoGen loop`).

## 4. Families (grouping + colour)
Assign each script a `family`. Cards and the sidebar are grouped and coloured by it:

| key            | label                       |
|----------------|-----------------------------|
| foundations    | Foundations                 |
| rag            | Retrieval (RAG)             |
| orchestration  | Multi-Agent Orchestration   |
| handoff        | Handoff & Structure         |
| local          | Local & Lightweight         |
| production     | Production & Serving        |
| protocols      | Protocols (MCP / A2A)       |
| safety         | Safety & Guardrails         |

Add new families by editing `FAMILIES` in `build_map.py`.

## 5. Plain-language fields (the "layman layer")
Every script spec carries: `oneliner` (≤ 18 words), `analogy` (one real-world/mechanical
comparison), `input`, `output`, `press_go` (the single line that runs it), and `mechanism`
(how "who runs next" is decided — the framework's signature trick).

### 5a. What / Why / How (the row-explanation block)
Three fields render as a colour-coded 3-row table at the top of each card (blue/amber/green):

| field  | answers                          | for a plan card                         | for a code-map card                        |
|--------|----------------------------------|-----------------------------------------|--------------------------------------------|
| `what` | *what is the involved change?*   | the concrete edit (funcs/props/lines)   | what this script actually does/produces    |
| `why`  | *why does this code change?*     | the problem/bug/goal driving it         | why the script exists / its role           |
| `how`  | *how does this approach work?*   | the mechanism + why this way vs another | how it works under the hood                |

Keep each to 1–2 sentences. `why` states the trigger, not a paraphrase of `what`. Any empty
row is dropped; if all three are empty the table is omitted. Distinct from `mechanism`, which
stays a lower-level "who runs next" note — `how` is the design-level summary.

Optional: `code` — the full source of the script, shown in a collapsible "Show the actual
code" block under the step table, syntax-highlighted by Prism.js (defaults to Python; set
`code_lang` to override, e.g. `"js"`). For notebooks, extract only the code cells (skip
markdown/outputs); a `# --- cell N ---` separator per cell reads well. Omit the field to
hide the block entirely. Don't paste code into other fields — it belongs only in `code`.

## 6. The overview map
`overview_mermaid` is a hand-curated `flowchart TB`. Show the families as a top→bottom
ladder and use **dotted** arrows (`-. "adds X" .->`) to say what each stage adds over the
previous one. Keep node labels single-line (use `·` instead of line breaks) so the browser
doesn't mis-parse them.

## 6a. The file tree (`tree`, optional)
A top-level `tree` string gives the reader a "where does everything live" map next to
the overview. Author it as a plain ASCII tree — the classic `├── │ └──` glyphs, one
file or directory per line, with an optional trailing `# comment` describing that
entry. Use `\n` between lines in JSON.

You do **not** re-declare which files are diagrammed/changed: `build_map.py` (and the
plan renderer) auto-highlight any line whose filename matches a script's `file`,
colour it (by `family` in the skill / by `change` in a plan), and turn it into a link
to that file's card. Wrap text in `**double asterisks**` only to manually emphasise
something with no single matching file (e.g. a directory). Include enough surrounding
*unchanged* context so the highlighted files have a place to sit — but don't dump the
whole repo; show the files that matter.

## 7. Spec object template
```json
{
  "file": "21_smolagents_finetuned_llm.py",
  "framework": "smolagents",
  "family": "local",
  "topic": "Local LLM agent + web search",
  "oneliner": "A locally-running AI model that can search the web to answer questions.",
  "what": "A CodeAgent wired to a local LiteLLMModel plus a web-search tool, run from a single web_agent.run(query) call.",
  "why": "Answering current questions needs live web data, but the model itself must stay local (privacy/cost) — so the agent bridges a local LLM to the open web.",
  "how": "CodeAgent runs a think-act loop, deciding each step whether to search or answer; max_steps caps the loop so it always terminates.",
  "analogy": "Like a researcher with a local library who can still Google things.",
  "input": "A research question string passed to web_agent.run()",
  "output": "A text answer string printed to terminal",
  "press_go": "result = web_agent.run(\"...\")",
  "mechanism": "CodeAgent runs a think-act loop; max_steps caps it; LiteLLMModel talks to local Ollama.",
  "steps": [
    {"type": "io", "label": "Research query", "note": "question passed to web_agent.run()"},
    {"type": "process", "label": "LLM thinks", "note": "the local model decides to search or answer"},
    {"type": "decision", "label": "Search needed?", "note": "does it have enough info?"},
    {"type": "process", "label": "Web search", "note": "returns top results as text"},
    {"type": "io", "label": "Answer string", "note": "returned and printed"}
  ],
  "edges": [
    "Research query --> LLM thinks",
    "LLM thinks --> Search needed?",
    "Search needed? -- yes --> Web search",
    "Search needed? -- no --> Answer string",
    "Web search --> Answer string"
  ]
}
```
