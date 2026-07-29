# Vendored third-party assets

These files are bundled so blueprints render **offline**, with no CDN request and no npm install.
An earlier version of this pipeline shelled out to the external `mmdc` CLI (`@mermaid-js/mermaid-cli`,
which drives headless Chromium); that broke silently in June 2026, and vendoring the browser-side
libraries instead removed the failure mode entirely.

Both dependencies are MIT licensed, which permits redistribution provided the copyright notice is
retained. That is what this file is for.

## Mermaid (`mermaid.min.js`, v11, ~3.5MB)

Renders the flowchart client-side inside the generated page.

```
Copyright (c) 2014 - 2026 Knut Sveidqvist
MIT License — https://github.com/mermaid-js/mermaid/blob/develop/LICENSE
```

## Prism (`prism.min.js` + grammars + theme, ~29KB total)

Syntax highlighting for code shown in the per-file cards. Files: `prism.min.js` (core, v1.29.0),
`prism-typescript.min.js`, `prism-jsx.min.js`, `prism-tsx.min.js`, `prism-python.min.js`, and the
`prism-vsc-dark-plus.min.css` theme.

```
Copyright (c) 2012 Lea Verou
MIT License — https://github.com/PrismJS/prism/blob/master/LICENSE
```

The minified bundles were produced by jsDelivr from the published npm packages.
