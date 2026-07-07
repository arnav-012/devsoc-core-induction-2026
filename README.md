# GitHub Repo Reviewer

A client-side app that reviews any public GitHub repository with a panel of AI agents — no backend, no build step. Paste a repo URL and get a scored, multi-dimension code review you can copy or download as Markdown.

**Pipeline:**

1. **Parse** — extracts owner/repo/branch from any GitHub URL (HTTPS or SSH)
2. **Index** — fetches repo metadata + full recursive file tree via the GitHub REST API
3. **Preprocess** — filters noise (`node_modules`, lockfiles, binaries, etc.), ranks files into priority tiers (README/manifests → entry points/tests → source → misc), and builds a token-budgeted context bundle per agent
4. **Agents** — five specialist agents (architecture, documentation, testing, code quality, dependencies) run in parallel via the OpenRouter API and return structured JSON scores/issues/suggestions
5. **Report** — aggregates all agent output into an overall score, executive summary, and prioritized issue list, exportable as a Markdown report (copy or download)

## Why this exists

Built for the DevSoc AI/ML Core Induction Project (2026) as a demonstration of an AI review pipeline with clear separation of concerns: pure parsing functions → deterministic preprocessing → structured-output agents → parallel execution + aggregation → export. Each phase was built and can be reasoned about independently.

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
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>
python3 -m http.server 8000
# visit http://localhost:8000
```

(Opening `index.html` directly by double-clicking also works in most browsers, since everything is a relative `<script src>`/`<link>` — no ES modules, no CORS issues.)

### API key

Phase 3 (AI agents) requires an [OpenRouter API key](https://openrouter.ai/keys). It's entered directly into the password field in the UI at runtime and is **never stored, logged, or sent anywhere except directly to OpenRouter's API from your browser**. Phases 1 and 2 (repo indexing + preprocessing) work with no key at all.

## Deploying

Static files, so it works out of the box on GitHub Pages — see the step-by-step guide below.

---

## Step-by-step: pushing this to GitHub

### 1. Create the repository on GitHub

1. Go to [github.com/new](https://github.com/new).
2. Pick a repo name (e.g. `repo-reviewer`).
3. Leave it **Public** (so GitHub Pages can serve it for free) or Private if you don't need a live demo.
4. **Do not** check "Add a README" — you already have one in this folder.
5. Click **Create repository**. GitHub will show you a page with setup commands — you can ignore those and use the ones below instead.

### 2. Push your local files

Open a terminal in the folder containing `index.html`, `css/`, `js/`, and `README.md`, then run:

```bash
git init
git add .
git commit -m "Initial commit: GitHub Repo Reviewer (Phases 1–5)"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Replace `<your-username>` and `<repo-name>` with your actual GitHub username and the repo name you picked in step 1.

If `git push` asks for a password and rejects it: GitHub no longer accepts account passwords over HTTPS. Either:
- use a [Personal Access Token](https://github.com/settings/tokens) in place of the password, or
- switch the remote to SSH (`git remote set-url origin git@github.com:<your-username>/<repo-name>.git`) if you have an SSH key set up with GitHub.

### 3. Verify it landed correctly

Refresh the repo page on GitHub. You should see `index.html`, `css/`, `js/`, and `README.md` at the top level. Click into `js/` to confirm all seven files are there.

### 4. (Optional) Make it live with GitHub Pages

1. On the repo page, go to **Settings → Pages**.
2. Under "Build and deployment", set **Source** to `Deploy from a branch`.
3. Set **Branch** to `main` and folder to `/ (root)`, then **Save**.
4. Wait ~30–60 seconds, then refresh — GitHub will show a URL like:
   `https://<your-username>.github.io/<repo-name>/`
5. Visit that URL to confirm the app loads and the pipeline runs end to end.

### 5. Submitting

Whatever the submission form asks for, you'll generally want to share:
- The repo URL: `https://github.com/<your-username>/<repo-name>`
- The live demo URL (if you enabled Pages): `https://<your-username>.github.io/<repo-name>/`
