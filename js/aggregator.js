async function runOneAgent(agentName, meta, files, apiKey, row, index) {
  // Stagger start times slightly so 5 requests don't hit the API in the exact same instant —
  // still fully concurrent, just avoids a thundering-herd burst against the free-tier rate limit.
  await new Promise(r => setTimeout(r, index * 400));

  row.textContent = `  \u23f3 ${agentName.replace('_', ' ')} — running...`;

  try {
    const context = buildAgentContext(agentName, meta, files);
    const result  = await callAgentAPI(agentName, context, apiKey);
    row.textContent = `  \u2713 ${agentName.replace('_', ' ')} — ${result.score}/10`;
    row.style.color = 'var(--green)';
    return { ...result, error: null };
  } catch (e) {
    row.textContent = `  \u2717 ${agentName.replace('_', ' ')} — failed: ${e.message.slice(0, 80)}`;
    row.style.color = 'var(--red)';
    return { score: 0, summary: e.message, strengths: [], issues: [], suggestions: [], error: e.message };
  }
}

async function handleAgents() {
  const apiKey = document.getElementById('api-key-input').value.trim();
  if (!apiKey) { showError('Please enter your OpenRouter API key.'); return; }
  if (!window._repoFiles || !window._repoMeta) { showError('Run Phase 1 first.'); return; }

  const btn = document.getElementById('agents-btn');
  setLoading(btn, true);
  setStage('stage-agents', 'active');
  document.getElementById('phase3-results').style.display = 'none';

  const meta  = window._repoMeta;
  const files = window._repoFiles;

  // Live status indicator — one row per agent, all created up front since they now run concurrently.
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'font-family:var(--mono);font-size:12px;color:var(--muted);margin-top:14px;display:flex;flex-direction:column;gap:5px;';
  document.getElementById('phase3-trigger').appendChild(statusDiv);

  const rows = {};
  for (const agentName of AGENT_ORDER) {
    const row = document.createElement('div');
    row.style.transition = 'color 0.2s';
    row.textContent = `  \u2022 ${agentName.replace('_', ' ')} — queued`;
    statusDiv.appendChild(row);
    rows[agentName] = row;
  }

  // Phase 4: run all agents in parallel instead of sequentially awaiting each one.
  const settled = await Promise.allSettled(
    AGENT_ORDER.map((agentName, i) => runOneAgent(agentName, meta, files, apiKey, rows[agentName], i))
  );

  const results = {};
  settled.forEach((res, i) => {
    const agentName = AGENT_ORDER[i];
    results[agentName] = res.status === 'fulfilled'
      ? res.value
      : { score: 0, summary: res.reason?.message || 'Unknown error', strengths: [], issues: [], suggestions: [], error: res.reason?.message || 'Unknown error' };
  });

  setStage('stage-agents', 'done');
  setStage('stage-report', 'done');
  setLoading(btn, false);
  statusDiv.remove();

  const aggregate = aggregateResults(results);
  window._lastResults   = results;
  window._lastAggregate = aggregate;
  renderPhase3(results, aggregate);
  document.getElementById('phase3-results').style.display = 'block';
  document.getElementById('phase3-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Aggregator ──────────────────────────────────────────────────────────
// Consolidates the five independent agent outputs into one coherent report:
// weighted overall score, success/failure accounting, and a deduplicated,
// severity-ranked master issue list drawn from all agents at once.
function aggregateResults(results) {
  const overall = computeOverall(results);
  const grade   = overallGrade(overall);

  const succeeded = AGENT_ORDER.filter(n => !results[n]?.error);
  const failed    = AGENT_ORDER.filter(n => results[n]?.error);

  const sevRank = { high: 0, medium: 1, low: 2, positive: 3 };
  const allIssues = AGENT_ORDER.flatMap(n =>
    (results[n]?.issues || []).map(i => ({ ...i, agent: n }))
  ).sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));

  // De-dupe by normalized title — different agents sometimes flag the same problem.
  const seen = new Set();
  const prioritizedIssues = [];
  for (const issue of allIssues) {
    const key = (issue.title || '').toLowerCase().trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    prioritizedIssues.push(issue);
  }

  const executiveSummary = succeeded
    .map(n => results[n]?.summary)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ') || 'Review complete.';

  return {
    overall,
    grade,
    succeeded,
    failed,
    confidence: succeeded.length / AGENT_ORDER.length,
    prioritizedIssues,
    executiveSummary,
  };
}
