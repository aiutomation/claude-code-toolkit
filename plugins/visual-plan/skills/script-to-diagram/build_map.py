#!/usr/bin/env python3
"""build_map.py - turn a specs.json of script analyses into ONE self-contained
HTML "course map": a Mermaid.js flowchart per script + a cross-framework
overview, with editable notes. Pure standard library, no pip installs needed.

Usage:
    python build_map.py --specs specs.json \
        --template assets/template.html --out COURSE_MAP.html

specs.json shape:
{
  "title": "...", "subtitle": "...",
  "overview_mermaid": "flowchart TB ...",      # the big cross-framework map
  "tree": "src/\n├── a.py   # comment\n└── b.py",  # optional ASCII file tree; lines matching a
                                               # script's filename are auto-linked to its card
  "scripts": [
    {
      "file": "15_pydantic_ai.py", "framework": "PydanticAI",
      "family": "handoff", "topic": "...", "oneliner": "...", "analogy": "...",
      "what": "...", "why": "...", "how": "...",     # the What/Why/How row explanation
      "input": "...", "output": "...", "press_go": "...", "mechanism": "...",
      "steps": [ {"type": "io|process|decision|data", "label": "...", "note": "..."} ],
      "edges": [ "A --> B", "Q? -- yes --> C" ],
      "code": "..."                                # optional: full source, shown in a collapsible block
    }
  ]
}
"""
import argparse
import html
import json
import re
from datetime import datetime
from pathlib import Path

# Map a step "type" to the opening/closing Mermaid shape brackets.
SHAPE = {
    "io":       ('[/"', '"/]'),   # parallelogram = input / output
    "process":  ('["', '"]'),     # rectangle     = a step that does work
    "decision": ('{"', '"}'),     # diamond       = a yes/no branch
    "data":     ('(["', '"])'),   # rounded pill  = a piece of data
}

# Family key -> (human label, colour). Cards & sidebar are grouped by these.
FAMILIES = {
    "foundations":   ("Foundations",                 "#6366f1"),
    "rag":           ("Retrieval (RAG)",             "#0ea5e9"),
    "orchestration": ("Multi-Agent Orchestration",   "#16a34a"),
    "handoff":       ("Handoff & Structure",         "#9333ea"),
    "local":         ("Local & Lightweight",         "#0d9488"),
    "production":    ("Production & Serving",         "#ea580c"),
    "protocols":     ("Protocols (MCP / A2A)",        "#4f46e5"),
    "safety":        ("Safety & Guardrails",          "#dc2626"),
}


def esc_node(label):
    """Make a label safe to sit inside a Mermaid "quoted" node."""
    return (label or "").strip().replace("&", "&amp;").replace('"', "&quot;")


def slugify(name):
    s = re.sub(r"[^A-Za-z0-9]+", "-", name or "").strip("-").lower()
    return s or "item"


def render_tree_line(line, idx):
    """Escape one tree line, then linkify any diagrammed filename on it and mute a
    trailing `# comment`. `idx` maps basename -> (anchor, colour)."""
    m = re.search(r"(\s#.*)$", line)
    code, cm = (line[:m.start()], line[m.start():]) if m else (line, "")
    out = html.escape(code)
    out = re.sub(r"\*\*([^*]+)\*\*", r'<strong class="tb">\1</strong>', out)
    for base, (anchor, color) in idx.items():
        eb = html.escape(base)
        pat = r"\b" + re.escape(eb) + r"(?![\w])"        # whole-token match
        link = '<a href="#%s" class="tf" style="color:%s">%s</a>' % (anchor, color, eb)
        out = re.sub(pat, lambda _m, l=link: l, out, count=1)
    if cm:
        out += '<span class="tree-cm">%s</span>' % html.escape(cm)
    return out


def render_tree(tree_text, scripts):
    """Turn the optional `tree` ASCII string into a highlighted, clickable file-tree
    panel. Files that have a card are coloured by their family and link to it; the
    rest stay plain context. Returns '' when no tree is given."""
    if not (tree_text or "").strip():
        return ""
    idx = {}
    for s in scripts:
        f = s.get("file", "")
        if not f:
            continue
        _, color = FAMILIES.get(s.get("family", "foundations"), ("Other", "#667"))
        idx[Path(f).name] = (s.get("anchor") or slugify(f), color)
    lines = tree_text.replace("\r", "").rstrip("\n").split("\n")
    body = "\n".join(render_tree_line(ln, idx) for ln in lines)
    return ('<div class="tree-wrap" id="tree">'
            '<h3>Project structure &mdash; the files at a glance</h3>'
            '<p class="hint">Diagrammed files are highlighted and clickable &mdash; jump to that '
            'file\'s card. Everything else is context.</p>'
            '<pre class="tree">%s</pre></div>' % body)


def build_mermaid(spec):
    """Turn the spec's steps + edges into Mermaid flowchart source text."""
    steps = spec.get("steps", [])
    lines = ["flowchart TD"]
    label2id = {}
    for i, st in enumerate(steps):
        nid = "N%d" % i
        typ = st.get("type", "process")
        label = (st.get("label") or "").strip()
        label2id.setdefault(label, nid)
        op, cl = SHAPE.get(typ, SHAPE["process"])
        lines.append("    %s%s%s%s:::%s" % (nid, op, esc_node(label), cl, typ))

    extra = {}

    def resolve(lbl):
        lbl = lbl.strip()
        if lbl in label2id:
            return label2id[lbl]
        if lbl in extra:
            return extra[lbl]
        nid = "X%d" % len(extra)
        extra[lbl] = nid
        lines.append('    %s["%s"]:::process' % (nid, esc_node(lbl)))
        return nid

    for raw in spec.get("edges", []):
        e = (raw or "").strip()
        if "-->" not in e:
            continue
        left, to = e.rsplit("-->", 1)
        to = to.strip()
        label = ""
        if "--" in left:                       # form:  FROM -- label --> TO
            frm, label = left.split("--", 1)
            frm, label = frm.strip(), label.strip()
        else:                                  # form:  FROM --> TO
            frm = left.strip()
        fid, tid = resolve(frm), resolve(to)
        if label:
            lines.append("    %s -->|%s| %s" % (fid, esc_node(label), tid))
        else:
            lines.append("    %s --> %s" % (fid, tid))

    lines += [
        "    classDef io fill:#fff4c2,stroke:#b8860b,color:#5b4500;",
        "    classDef process fill:#e7f0ff,stroke:#3b6fb6,color:#16365c;",
        "    classDef decision fill:#ffe1e1,stroke:#c0392b,color:#7a1f17;",
        "    classDef data fill:#e3f7ea,stroke:#2e7d32,color:#14532d;",
    ]
    return "\n".join(lines)


def card_html(s, n):
    fam = s.get("family", "foundations")
    fam_label, color = FAMILIES.get(fam, ("Other", "#667"))
    e = html.escape
    steps = s.get("steps", [])
    rows = "\n".join(
        '<tr><td class="st %s">%s</td><td>%s</td></tr>'
        % (st.get("type", "process"), e(st.get("label", "")), e(st.get("note", "")))
        for st in steps
    )
    mer = build_mermaid(s)
    search = e((s.get("framework", "") + " " + s.get("topic", "")
                + " " + s.get("oneliner", "") + " " + s.get("file", "")).lower())
    p = []
    p.append('<section class="card" id="%s" data-search="%s" style="--fc:%s">'
             % (s["anchor"], search, color))
    p.append('<div class="chead">')
    p.append('<span class="badge" style="background:%s">%s</span>' % (color, e(fam_label)))
    p.append('<span class="num">#%d</span>' % n)
    p.append('<h2>%s</h2>' % e(s.get("topic", "")))
    p.append('<div class="hmeta"><code class="fname">%s</code>'
             '<span class="fw">%s</span></div>' % (e(s.get("file", "")), e(s.get("framework", ""))))
    p.append('</div>')
    p.append('<p class="one">%s</p>' % e(s.get("oneliner", "")))
    # What / Why / How row explanation — only rows that carry content; whole
    # table omitted if all three are empty (no empty box on plain visualisations).
    wwh = [(c, l, s.get(c, "")) for c, l in (("what", "What"), ("why", "Why"), ("how", "How"))]
    wwh = [(c, l, v) for c, l, v in wwh if (v or "").strip()]
    if wwh:
        trs = "".join('<tr class="%s"><th>%s</th><td>%s</td></tr>' % (c, l, e(v)) for c, l, v in wwh)
        p.append('<table class="wwh"><tbody>%s</tbody></table>' % trs)
    p.append('<p class="analogy"><b>Analogy</b> %s</p>' % e(s.get("analogy", "")))
    p.append('<div class="iogrid">')
    p.append('<div class="io in"><h4>Input</h4><p>%s</p></div>' % e(s.get("input", "")))
    p.append('<div class="io out"><h4>Output</h4><p>%s</p></div>' % e(s.get("output", "")))
    p.append('</div>')
    p.append('<div class="pressgo"><h4>Press GO &mdash; the one line that runs it</h4>'
             '<pre><code>%s</code></pre></div>' % e(s.get("press_go", "")))
    p.append('<div class="mech"><h4>How control flows</h4><p>%s</p></div>' % e(s.get("mechanism", "")))
    p.append('<div class="diagram"><div class="mermaid">%s</div></div>' % mer)
    p.append('<details class="stepbox"><summary>Step details &mdash; what each box means</summary>')
    p.append('<table class="steptbl"><thead><tr><th>Box</th><th>What it does</th></tr></thead>'
             '<tbody>%s</tbody></table>' % rows)
    p.append('</details>')
    code = s.get("code", "")
    if code.strip():
        lang = s.get("code_lang", "python")
        p.append('<details class="codebox"><summary>Show the actual code &mdash; the full script, inline</summary>'
                 '<button class="fs-btn" type="button">&#9974; Fullscreen</button>'
                 '<pre class="codeblock language-%s"><code class="language-%s">%s</code></pre></details>'
                 % (lang, lang, e(code)))
    p.append('<div class="notes"><h4>My notes</h4>'
             '<div class="note" contenteditable="true" data-key="%s" '
             'data-ph="Click here and type your own notes &mdash; they save in this browser."></div></div>'
             % s["anchor"])
    p.append('</section>')
    return "\n".join(p)


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(
        description="Build a self-contained HTML course map from a specs.json file.")
    ap.add_argument("--specs", required=True, help="path to specs.json")
    ap.add_argument("--template", default=str(here / "assets" / "template.html"),
                    help="HTML template (defaults to the one bundled with this skill)")
    ap.add_argument("--out", default=None,
                    help="output HTML path (defaults to COURSE_MAP.html next to specs.json)")
    a = ap.parse_args()

    if a.out is None:                       # write next to the specs file by default
        a.out = str(Path(a.specs).resolve().parent / "COURSE_MAP.html")

    data = json.loads(Path(a.specs).read_text(encoding="utf-8"))
    scripts = data["scripts"]
    for s in scripts:
        s.setdefault("anchor", slugify(s.get("file", "")))

    groups = {}
    for s in scripts:
        groups.setdefault(s.get("family", "foundations"), []).append(s)

    sidebar, cards, n = [], [], 0
    for fam in FAMILIES:
        if fam not in groups:
            continue
        fam_label, color = FAMILIES[fam]
        sidebar.append('<div class="nav-group"><span class="nav-fam" style="--fc:%s">%s</span>'
                       % (color, html.escape(fam_label)))
        for s in groups[fam]:
            sidebar.append('<a href="#%s">%s</a>' % (s["anchor"], html.escape(s["topic"])))
        sidebar.append('</div>')
        for s in groups[fam]:
            n += 1
            cards.append(card_html(s, n))

    tpl = Path(a.template).read_text(encoding="utf-8")
    out = (tpl
           .replace("@@TITLE@@", html.escape(data.get("title", "Course Map")))
           .replace("@@SUBTITLE@@", html.escape(data.get("subtitle", "")))
           .replace("@@META@@", html.escape("%d scripts · generated %s"
                                            % (len(scripts), datetime.now().strftime("%Y-%m-%d %H:%M"))))
           .replace("@@OVERVIEW@@", data.get("overview_mermaid", ""))
           .replace("@@TREE@@", render_tree(data.get("tree", ""), scripts))
           .replace("@@SIDEBAR@@", "\n".join(sidebar))
           .replace("@@CARDS@@", "\n".join(cards)))
    Path(a.out).write_text(out, encoding="utf-8")
    print("Wrote %s  (%d scripts)" % (a.out, len(scripts)))


if __name__ == "__main__":
    main()
