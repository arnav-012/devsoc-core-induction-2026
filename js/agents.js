// ── Phase 3 — AI Agents ───────────────────────────────────────────────────────

const AGENT_META = {
  architecture:  { label: 'Architecture',  emoji: '🏗',  weight: 0.20 },
  documentation: { label: 'Documentation', emoji: '📝', weight: 0.15 },
  testing:       { label: 'Testing',       emoji: '🧪', weight: 0.25 },
  code_quality:  { label: 'Code Quality',  emoji: '🔍', weight: 0.25 },
  dependencies:  { label: 'Dependencies',  emoji: '📦', weight: 0.15 },
};

const AGENT_ORDER = ['architecture', 'documentation', 'testing', 'code_quality', 'dependencies'];

const OUTPUT_SCHEMA = `
You MUST respond with a single JSON object and nothing else — no prose before or after, no markdown fences.

{
  "score": <integer 0-10>,
  "summary": "<2-3 sentence verdict on this dimension>",
  "strengths": ["<strength>", ...],
  "issues": [
    { "severity": "<high|medium|low|positive>", "title": "<short label>", "detail": "<1-3 sentences>", "file": "<path or null>" }
  ],
  "suggestions": ["<concrete actionable improvement>", ...]
}

Scoring: 0-2 critical, 3-4 significant gaps, 5-6 acceptable, 7-8 good, 9-10 excellent.
Keep strengths and suggestions to 2-4 items. Keep issues to 3-6 items.`;

const AGENT_PROMPTS = {
  architecture:
    'You are an expert software architect. Evaluate ONLY the architectural quality: folder structure, modularity, entry points, separation of concerns, scalability signals, and coupling. Do NOT comment on docs, tests, code style, or dependencies.' + OUTPUT_SCHEMA,

  documentation:
    'You are a senior developer assessing documentation. Evaluate ONLY: README quality, setup instructions, usage examples, inline comments, docstrings, contributor guidance, and onboarding difficulty. Do NOT comment on architecture, tests, code quality, or dependencies.' + OUTPUT_SCHEMA,

  testing:
    'You are a QA engineer. Evaluate ONLY: test presence, coverage signals, test types (unit/integration/e2e), test quality, test tooling, CI integration, edge case coverage, and test isolation. Do NOT comment on docs, architecture, code style, or dependencies.' + OUTPUT_SCHEMA,

  code_quality:
    'You are a senior engineer doing a code quality review. Evaluate ONLY: readability, naming, DRY principle, function size, complexity, consistency, error handling, code smells, and linting/formatting evidence. Do NOT comment on docs, tests, architecture, or dependencies.' + OUTPUT_SCHEMA,

  dependencies:
    'You are a DevOps/security engineer. Evaluate ONLY: dependency manifest presence, version pinning, dependency count/bloat, obvious red flags, dev vs prod separation, lockfile/tooling, security signals, and redundancy. Do NOT comment on code quality, docs, tests, or architecture.' + OUTPUT_SCHEMA,
};

function buildAgentContext(agentName, meta, files) {
  const kept = files.filter(f => !shouldSkipFile(f.path));
  const scored = kept
    .map(f => ({ ...f, tier: assignTier(f.path), sc: agentFileScore(agentName, f.path, assignTier(f.path)) }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 60);

  let ctx = `=== REPOSITORY OVERVIEW ===
Repository: ${meta.full_name}
Description: ${meta.description || 'No description'}
Language: ${meta.language || 'Mixed'}
Stars: ${meta.stargazers_count} | Forks: ${meta.forks_count} | Open issues: ${meta.open_issues_count}
License: ${meta.license?.name || 'None'}
Topics: ${(meta.topics || []).join(', ') || 'None'}
Total files (after filter): ${kept.length}

=== FILE TREE (top ${scored.length} files selected for ${agentName.replace('_',' ')} review) ===
`;
  for (const f of scored) {
    ctx += `[T${f.tier}] ${f.path}  (${fmt_size(f.size)})\n`;
  }
  ctx += `
[Note: Only the file tree is available in this browser-based review.
Assess based on file/folder naming conventions, project structure, configuration files visible,
and any signals you can infer from the paths and metadata above.]`;

  return ctx;
}

async function callAgentAPI(agentName, context, apiKey, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  window.location.origin || 'https://repo-reviewer.local',
        'X-Title':       'Repo Reviewer',
      },
      body: JSON.stringify({
        model:      'poolside/laguna-m.1:free',
        max_tokens: 1500,
        messages: [
          { role: 'system', content: AGENT_PROMPTS[agentName] },
          { role: 'user',   content: context },
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      // OpenRouter nests the real reason under error.metadata.raw for upstream provider failures.
      const detail  = err.error?.metadata?.raw || err.error?.message || `HTTP ${resp.status}`;
      const isRetryable = resp.status === 429 || resp.status === 502 || resp.status === 503;

      if (isRetryable && attempt < retries) {
        const wait = 1500 * Math.pow(2, attempt); // 1.5s, 3s, 6s...
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw new Error(isRetryable ? `Rate-limited by free model upstream — ${detail}` : detail);
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Strip markdown fences if present
    let clean = text.trim();
    if (clean.startsWith('```')) {
      const lines = clean.split('\n');
      const end = lines[lines.length - 1].trim() === '```' ? -1 : undefined;
      clean = lines.slice(1, end).join('\n').trim();
    }

    // Some free models wrap JSON with extra prose; extract the outermost {...} block as a fallback.
    try {
      return JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Failed to parse model output as JSON');
    }
  }
  throw new Error('Failed after retries');
}

function computeOverall(results) {
  let weighted = 0, totalW = 0;
  for (const [name, r] of Object.entries(results)) {
    if (r.error) continue;
    const w = AGENT_META[name]?.weight || 0.2;
    weighted += (r.score || 0) * w;
    totalW   += w;
  }
  return totalW > 0 ? Math.round(weighted / totalW * 10) / 10 : 0;
}

function overallGrade(score) {
  if (score >= 8.5) return 'A';
  if (score >= 7.0) return 'B';
  if (score >= 5.5) return 'C';
  if (score >= 4.0) return 'D';
  return 'F';
}

function gradeColor(grade) {
  return { A: 'var(--green)', B: 'var(--accent)', C: 'var(--amber)', D: 'var(--red)', F: 'var(--red)' }[grade] || 'var(--text)';
}

function sevColor(sev) {
  return { high: 'var(--red)', medium: 'var(--amber)', low: 'var(--muted)', positive: 'var(--green)' }[sev] || 'var(--muted)';
}
