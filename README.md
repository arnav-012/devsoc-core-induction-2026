# GitHub Repo Reviewer

**Repo:** https://github.com/arnav-012/devsoc-core-induction-2026
**Live demo (GitHub Pages):** https://arnav-012.github.io/devsoc-core-induction-2026/

A client-side app that reviews any public GitHub repository with a panel of AI agents — no backend, no build step. Paste a repo URL and get a scored, multi-dimension code review you can copy or download as Markdown.

Built for the **DevSoc AI/ML Core Induction Project (2026)**.

## How it works

1. **Parse** — extracts owner/repo/branch from any GitHub URL (HTTPS or SSH)
2. **Index** — fetches repo metadata + full recursive file tree via the GitHub REST API
3. **Preprocess** — filters noise (`node_modules`, lockfiles, binaries, etc.), ranks files into priority tiers (README/manifests → entry points/tests → source → misc), and builds a token-budgeted context bundle per agent
4. **Agents** — five specialist agents (architecture, documentation, testing, code quality, dependencies) run in parallel via the OpenRouter API and return structured JSON scores/issues/suggestions
5. **Report** — aggregates all agent output into an overall score, executive summary, and prioritized issue list, exportable as a Markdown report (copy or download)

## Try it now

No install needed — just open the live demo and paste a GitHub repo URL:

👉 **https://arnav-012.github.io/devsoc-core-induction-2026/**

You'll need an [OpenRouter API key](https://openrouter.ai/keys) to run the AI agent step (Phase 3+). See [API key](#api-key) below for details on how it's handled.

## Project structure

The code is split to mirror the five build phases, plus a thin UI layer that wires them to the DOM:

```
.
├── index.html              # markup only
├── css/
│   └── style.css           # all styles
└── js/
    ├── parser.js            # Phase 1 — URL parsing + GitHub API fetch (pure, unit-testable)
    ├── preprocessor.js       # Phase 2 — filtering, tiering, per-agent token budgeting
    ├── agents.js             # Phase 3 — agent prompts, context builder, OpenRouter calls
    ├── aggregator.js         # Phase 4 — parallel agent execution + result aggregation
    ├── report.js             # Phase 5 — Markdown report generation, copy/download
    ├── ui.js                 # shared DOM helpers + rendering for phases 1 and 4/5
    └── main.js               # entry point (event wiring on page load)
```

`parser.js` and `preprocessor.js` have no DOM dependencies at all — they're plain functions you could drop straight into a Jest/Vitest test file.

## Tech stack

- Vanilla HTML/CSS/JS — zero dependencies, zero build step
- [GitHub REST API](https://docs.github.com/en/rest) for repo metadata and file trees
- [OpenRouter](https://openrouter.ai/) for LLM access (agents currently target a free model; swap the model string in `js/agents.js` to use any OpenRouter-supported model)

## Running it locally

```bash
git clone https://github.com/arnav-012/devsoc-core-induction-2026.git
cd devsoc-core-induction-2026
python3 -m http.server 8000
# visit http://localhost:8000
```

(Opening `index.html` directly by double-clicking also works in most browsers, since everything is a relative `<script src>`/`<link>` — no ES modules, no CORS issues.)

## API key

Phase 3 (AI agents) requires an [OpenRouter API key](https://openrouter.ai/keys). It's entered directly into the password field in the UI at runtime and is **never stored, logged, or sent anywhere except directly to OpenRouter's API from your browser**. Phases 1 and 2 (repo indexing + preprocessing) work with no key at all.

## Deployment

This app is deployed via **GitHub Pages**, serving directly from the `main` branch root:

- **Settings → Pages → Source:** Deploy from a branch
- **Branch:** `main` / `(root)`
- **Live URL:** https://arnav-012.github.io/devsoc-core-induction-2026/

Since it's a static site with no build step, any push to `main` updates the live version within about a minute — no CI/CD needed.

## Notes on the review output

Because this runs entirely in the browser, agents review the **file tree and metadata only** (paths, sizes, naming conventions, config files) rather than full file contents — there's no server-side step to pull and chunk raw source. This keeps the tool fast, key-free for indexing, and deployable as a static site, at the tradeoff of not doing a deep line-by-line code read.
