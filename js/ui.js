// ── Shared UI helpers ───────────────────────────────────────────────────────
function setStage(id, state) {
  const el = document.getElementById(id);
  el.classList.remove('active', 'done');
  if (state) el.classList.add(state);
}

function fmt_size(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function fmt_num(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function ext(path) {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot) : '';
}

function dirPart(path) {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash + 1) : '';
}

function namePart(path) {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = '⚠ ' + msg;
  el.classList.add('visible');
}

function clearError() {
  document.getElementById('error-msg').classList.remove('visible');
}

function setLoading(btn, on) {
  btn.disabled = on;
  btn.classList.toggle('loading', on);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


// ── Phase 1 — DOM wiring (analyze button → parser.js → render) ─────────────
async function handleAnalyze() {
  clearError();
  const raw = document.getElementById('url-input').value;
  if (!raw.trim()) { showError("Please enter a GitHub repository URL."); return; }

  const btn = document.getElementById('analyze-btn');
  document.getElementById('pipeline').classList.add('visible');
  document.getElementById('results').classList.remove('visible');
  document.getElementById('preprocess-results').style.display = 'none';
  setLoading(btn, true);

  // Stage 1: parse URL
  setStage('stage-parse', 'active');
  let parsed;
  try {
    parsed = parseGitHubUrl(raw);
  } catch (e) {
    showError(e.message);
    setLoading(btn, false);
    setStage('stage-parse', '');
    return;
  }
  await sleep(180);
  setStage('stage-parse', 'done');

  // Stage 2: fetch metadata + file tree
  setStage('stage-index', 'active');
  let meta, treeData;
  try {
    meta = await ghFetch(`repos/${parsed.owner}/${parsed.repo}`);
    const branch = parsed.branch || meta.default_branch;
    treeData = await ghFetch(`repos/${parsed.owner}/${parsed.repo}/git/trees/${branch}?recursive=1`);
    parsed.branch = branch;
  } catch (e) {
    showError(e.message);
    setLoading(btn, false);
    setStage('stage-index', '');
    return;
  }
  setStage('stage-index', 'done');
  setStage('stage-preprocess', '');
  setStage('stage-agents', '');
  setStage('stage-report', '');

  const files = (treeData.tree || []).filter(e => e.type === 'blob');

  // Store for Phase 2
  window._repoFiles = files;
  window._repoMeta  = meta;
  window._repoParsed = parsed;

  renderPhase1(meta, files, parsed, treeData.truncated || false);
  setLoading(btn, false);
}

function renderPhase1(meta, files, parsed, truncated) {
  // Repo link + description
  const repoLink = document.getElementById('repo-link');
  repoLink.textContent = meta.full_name;
  repoLink.href = `https://github.com/${meta.full_name}`;
  document.getElementById('repo-desc').textContent = meta.description || 'No description provided.';

  // Meta grid
  const items = [
    ['Language', meta.language || 'Mixed'],
    ['Stars',    fmt_num(meta.stargazers_count)],
    ['Forks',    fmt_num(meta.forks_count)],
    ['Issues',   fmt_num(meta.open_issues_count)],
    ['Size',     fmt_size(meta.size * 1024)],
    ['License',  meta.license?.name || 'None'],
    ['Branch',   parsed.branch],
    ['Updated',  meta.updated_at.slice(0, 10)],
  ];
  document.getElementById('meta-grid').innerHTML = items.map(([k, v]) =>
    `<div class="meta-item">
      <div class="meta-key">${k}</div>
      <div class="meta-val">${escHtml(String(v))}</div>
    </div>`).join('');

  // Topics
  const tagsRow = document.getElementById('tags-row');
  tagsRow.innerHTML = (meta.topics || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');

  // Truncation warning
  document.getElementById('trunc-warning').classList.toggle('visible', !!truncated);

  // File tree
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  document.getElementById('tree-title').textContent = `File tree  /  ${parsed.owner}/${parsed.repo}`;
  document.getElementById('tree-count').textContent = `${files.length.toLocaleString()} files`;

  const shown = sorted.slice(0, 200);
  document.getElementById('tree-body').innerHTML = shown.map(f => {
    const dir  = dirPart(f.path);
    const name = namePart(f.path);
    const ex   = ext(name);
    return `<div class="file-row">
      <span class="file-path">${dir ? `<span class="dir">${escHtml(dir)}</span>` : ''}${escHtml(name)}</span>
      ${ex ? `<span class="file-ext">${escHtml(ex)}</span>` : ''}
      <span class="file-size">${fmt_size(f.size)}</span>
    </div>`;
  }).join('') + (files.length > 200
    ? `<div style="padding:10px 0;font-family:var(--mono);font-size:12px;color:var(--muted)">+ ${(files.length - 200).toLocaleString()} more files</div>`
    : '');

  document.getElementById('results').classList.add('visible');
}

// ── Phase 4/5 — DOM wiring for the AI review results ────────────────────────
function renderPhase3(results, aggregate) {
  const { overall, grade, failed, prioritizedIssues, executiveSummary } = aggregate;

  // Overall score display
  document.getElementById('overall-score-display').innerHTML =
    `<span style="color:${gradeColor(grade)}">${overall}</span>` +
    `<span style="font-size:20px;color:var(--muted)">/10</span>&nbsp;` +
    `<span style="font-size:30px;font-weight:700;color:${gradeColor(grade)}">${grade}</span>` +
    (failed.length
      ? `<div style="font-family:var(--mono);font-size:11px;color:var(--amber);margin-top:6px;">
           ${failed.length}/${AGENT_ORDER.length} agent${failed.length > 1 ? 's' : ''} failed — score based on remaining ${AGENT_ORDER.length - failed.length}.
         </div>`
      : '');

  // Score bars
  document.getElementById('score-bars').innerHTML = AGENT_ORDER.map(name => {
    const r   = results[name] || {};
    const pct = (r.score || 0) * 10;
    const m   = AGENT_META[name];
    const barCol = pct >= 70 ? 'var(--accent)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted);min-width:108px">${m.emoji} ${m.label}</span>
      <div style="flex:1;background:var(--surface2);border-radius:4px;height:5px;border:1px solid var(--border);overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${barCol};border-radius:4px;"></div>
      </div>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text);min-width:32px;text-align:right">${r.score ?? '?'}/10</span>
    </div>`;
  }).join('');

  // Executive summary — aggregated across up to 3 successful agents
  document.getElementById('exec-summary-text').textContent = executiveSummary;

  // Top priorities — deduplicated, severity-ranked across ALL agents (not just one)
  const topIssues = prioritizedIssues.filter(i => i.severity === 'high' || i.severity === 'medium').slice(0, 5);

  if (topIssues.length) {
    document.getElementById('priorities-section').style.display = 'block';
    document.getElementById('priorities-list').innerHTML =
      topIssues.map(p => {
        const m = AGENT_META[p.agent];
        return `<li style="line-height:1.7;font-size:14px;">
          ${escHtml(p.title)}
          <span style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-left:6px;">${m ? m.emoji + ' ' + m.label : ''}</span>
        </li>`;
      }).join('');
  } else {
    document.getElementById('priorities-section').style.display = 'none';
  }

  // Per-agent detail cards
  document.getElementById('agent-detail-cards').innerHTML = AGENT_ORDER.map(name => {
    const r = results[name] || {};
    const m = AGENT_META[name];
    const score = r.score ?? 0;
    const scoreCol = score >= 7 ? 'var(--green)' : score >= 5 ? 'var(--amber)' : 'var(--red)';

    if (r.error) {
      return `<div class="repo-card" style="margin-bottom:12px;border-color:rgba(245,101,101,0.3);">
        <div style="font-family:var(--mono);font-size:13px;font-weight:500;margin-bottom:6px;">${m.emoji} ${m.label}</div>
        <div style="color:var(--red);font-size:13px;">Agent failed: ${escHtml(r.error)}</div>
      </div>`;
    }

    const issueRows = (r.issues || []).map(i => `
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(37,43,59,0.4);">
        <span style="font-family:var(--mono);font-size:10px;font-weight:600;color:${sevColor(i.severity)};flex-shrink:0;min-width:62px;padding-top:2px;text-transform:uppercase;">${i.severity}</span>
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:2px;">
            ${escHtml(i.title)}
            ${i.file ? `<span style="color:var(--muted);font-family:var(--mono);font-size:10px;margin-left:6px;">${escHtml(i.file)}</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--muted);line-height:1.55;">${escHtml(i.detail)}</div>
        </div>
      </div>`).join('');

    const strengthRows = (r.strengths || []).map(s =>
      `<div style="font-size:13px;color:var(--green);padding:3px 0;">&#10003;&nbsp; ${escHtml(s)}</div>`
    ).join('');

    const suggRows = (r.suggestions || []).map(s =>
      `<div style="font-size:13px;color:var(--text);padding:3px 0;line-height:1.5;">&rarr;&nbsp; ${escHtml(s)}</div>`
    ).join('');

    return `<div class="repo-card" style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <span style="font-size:20px">${m.emoji}</span>
        <span style="font-family:var(--mono);font-size:14px;font-weight:500;">${m.label}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-size:24px;font-weight:600;color:${scoreCol};">
          ${score}<span style="font-size:13px;color:var(--muted)">/10</span>
        </span>
      </div>
      <p style="font-size:13px;color:var(--muted);line-height:1.65;margin-bottom:14px;">${escHtml(r.summary || '')}</p>
      ${strengthRows ? `<div style="margin-bottom:12px;">${strengthRows}</div>` : ''}
      ${issueRows ? `<div style="margin-bottom:12px;">${issueRows}</div>` : ''}
      ${suggRows ? `<div style="border-top:1px solid var(--border);padding-top:10px;">${suggRows}</div>` : ''}
    </div>`;
  }).join('');
}
