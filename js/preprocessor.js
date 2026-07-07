// ── Phase 2 — Preprocessor (mirrors preprocessor.py) ─────────────────────────

const SKIP_DIRS = new Set([
  'node_modules','__pycache__','.git','.svn','.hg',
  'dist','build','.next','.nuxt','.output',
  'venv','.venv','env',
  'vendor','bower_components',
  'coverage','.nyc_output','htmlcov',
  '.tox','.pytest_cache','.mypy_cache','.ruff_cache',
  'eggs','.eggs','target','out','bin','obj',
  '.idea','.vscode','Pods','.gradle','.m2',
]);

const SKIP_FILENAMES = new Set([
  '.DS_Store','Thumbs.db','.env','.env.local','.env.production','CODEOWNERS',
]);

const SKIP_GENERATED = new Set([
  'package-lock.json','yarn.lock','pnpm-lock.yaml',
  'poetry.lock','Pipfile.lock','Gemfile.lock',
  'composer.lock','cargo.lock','bun.lockb',
]);

const SKIP_EXTS = new Set([
  '.pyc','.pyo','.pyd','.class','.o','.so','.dylib','.dll','.exe','.bin','.wasm',
  '.png','.jpg','.jpeg','.gif','.ico','.svg','.webp',
  '.mp4','.mp3','.wav','.mov','.avi',
  '.zip','.tar','.gz','.bz2','.xz','.7z','.rar',
  '.pdf','.docx','.xlsx','.pptx',
  '.ttf','.woff','.woff2','.eot','.lock',
]);

const TIER1_NAMES = new Set([
  'README.md','README.rst','README.txt','README',
  'CONTRIBUTING.md','CONTRIBUTING.rst','CHANGELOG.md','CHANGELOG.rst',
  'LICENSE','LICENSE.md','LICENSE.txt',
  'package.json','pyproject.toml','setup.py','setup.cfg',
  'requirements.txt','requirements-dev.txt','Pipfile',
  'Cargo.toml','go.mod','go.sum',
  'Gemfile','composer.json','pom.xml','build.gradle',
  '.gitignore','.gitattributes','Makefile',
  'Dockerfile','docker-compose.yml','docker-compose.yaml','.dockerignore','Procfile',
]);

const TIER2_PATTERNS = [
  /(?:^|\/)main\.[a-z]+$/,
  /(?:^|\/)index\.[a-z]+$/,
  /(?:^|\/)app\.[a-z]+$/,
  /(?:^|\/)server\.[a-z]+$/,
  /(?:^|\/)__init__\.py$/,
  /(?:^|\/)__main__\.py$/,
  /(?:^|\/)(?:tests?|spec|__tests__)\//,
  /(?:^|\/)test_[a-z]/,
  /(?:^|\/)[a-z]+\.test\.[a-z]+$/,
  /(?:^|\/)conftest\.py$/,
  /\.(?:ya?ml|toml|ini|cfg)$/,
];

const SOURCE_EXTS = new Set([
  '.py','.js','.ts','.jsx','.tsx','.go','.rs','.java','.kt','.scala',
  '.rb','.php','.cs','.cpp','.c','.h','.swift','.m',
  '.sh','.bash','.zsh','.sql',
  '.md','.rst','.html','.css','.scss','.sass',
  '.json','.yaml','.yml','.toml','.xml','.tf','.hcl',
]);

const AGENT_BUDGETS = {
  architecture: 60000, documentation: 40000,
  testing: 50000, code_quality: 70000, dependencies: 30000,
};

// Each agent cares about different files
const AGENT_AFFINITIES = {
  architecture: [
    /(?:^|\/)(?:main|index|app|server)\.[a-z]+$/,
    /(?:^|\/)__init__\.py$/,
    /\.(?:ya?ml|toml|json)$/,
    /(?:docker|compose|k8s)/i,
    /\.tf$/,
  ],
  documentation: [
    /\.(?:md|rst|txt)$/,
    /(?:readme|contributing|changelog|license)/i,
    /(?:^|\/)docs?\//,
    /(?:^|\/)examples?\//,
  ],
  testing: [
    /(?:^|\/)(?:tests?|spec|__tests__)\//,
    /(?:^|\/)test_/,
    /\.test\.[a-z]+$/,
    /(?:^|\/)conftest\.py$/,
    /(?:jest|pytest|vitest|mocha)\.config/,
  ],
  code_quality: [
    /\.(?:py|js|ts|jsx|tsx|go|rs|java|rb|php|cs|cpp)$/,
    /(?:eslint|prettier|ruff|flake8|black)/,
    /\.(?:editorconfig|prettierrc|eslintrc)/,
  ],
  dependencies: [
    /(?:package|requirements|pyproject|setup|pipfile|cargo|gemfile|go\.mod)/i,
    /\.(?:txt|toml|cfg|json)$/,
    /(?:docker|compose)/i,
    /(?:^|\/)\.github\/workflows\//,
  ],
};

function shouldSkipFile(path) {
  const parts  = path.split('/');
  const filename = parts[parts.length - 1];
  for (const seg of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(seg)) return `inside '${seg}/'`;
  }
  if (SKIP_FILENAMES.has(filename))  return 'skipped filename';
  if (SKIP_GENERATED.has(filename))  return 'lock/generated file';
  const dotIdx = filename.lastIndexOf('.');
  const ex = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  if (SKIP_EXTS.has(ex)) return `skipped extension '${ex}'`;
  return null;
}

function assignTier(path) {
  const filename = path.split('/').pop();
  if (TIER1_NAMES.has(filename)) return 1;
  if (/(?:^|\/)\.github\/workflows\//.test(path)) return 1;
  for (const p of TIER2_PATTERNS) if (p.test(path)) return 2;
  const dotIdx = filename.lastIndexOf('.');
  const ex = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  if (SOURCE_EXTS.has(ex)) return 3;
  return 4;
}

function agentFileScore(agent, path, tier) {
  const base      = 5 - tier;
  const affinities = AGENT_AFFINITIES[agent] || [];
  const bonus     = affinities.filter(p => p.test(path)).length * 2;
  return base + bonus;
}

const TIER_LABELS = ['', 'Critical', 'Entry / Test', 'Source', 'Other'];
const TIER_COLORS = ['', 'var(--green)', 'var(--accent)', 'var(--text)', 'var(--muted)'];

async function handlePreprocess() {
  if (!window._repoFiles || !window._repoMeta) {
    showError("Analyze a repo first before running the preprocessor.");
    return;
  }

  const btn = document.getElementById('preprocess-btn');
  setLoading(btn, true);
  setStage('stage-preprocess', 'active');
  await sleep(80);

  const allFiles = window._repoFiles;

  // Step 1 — Filter
  const kept = [];
  const skipReasons = {};
  for (const f of allFiles) {
    const reason = shouldSkipFile(f.path);
    if (reason) {
      const cat = reason.split("'")[0].trim();
      skipReasons[cat] = (skipReasons[cat] || 0) + 1;
    } else {
      kept.push(f);
    }
  }

  // Step 2 — Prioritise
  const prioritised = [...kept].sort((a, b) => {
    const ta = assignTier(a.path), tb = assignTier(b.path);
    if (ta !== tb) return ta - tb;
    const da = a.path.split('/').length, db = b.path.split('/').length;
    if (da !== db) return da - db;
    return a.path.localeCompare(b.path);
  });

  // Token estimate: file.size bytes / 4
  const withTokens = prioritised.map(f => ({
    ...f,
    tier:     assignTier(f.path),
    tokenEst: Math.max(1, Math.round(f.size / 4)),
  }));

  // Step 3+4 — Build per-agent bundles
  const agentBundles = {};
  for (const [agent, budget] of Object.entries(AGENT_BUDGETS)) {
    const scored = [...withTokens].sort((a, b) =>
      agentFileScore(agent, b.path, b.tier) - agentFileScore(agent, a.path, a.tier)
    );
    let used = 0;
    const included = [];
    let skipped = 0;
    for (const f of scored) {
      if (used + f.tokenEst <= budget) {
        included.push(f);
        used += f.tokenEst;
      } else {
        skipped++;
      }
    }
    agentBundles[agent] = { included, skipped, usedTokens: used, budget };
  }

  setStage('stage-preprocess', 'done');
  setLoading(btn, false);

  renderPhase2(allFiles, kept, skipReasons, withTokens, agentBundles);
  document.getElementById('preprocess-results').style.display = 'block';
  document.getElementById('preprocess-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPhase2(allFiles, kept, skipReasons, withTokens, agentBundles) {
  const skipped = allFiles.length - kept.length;

  // Filter badge
  document.getElementById('filter-badge').textContent =
    `${kept.length} / ${allFiles.length} files kept`;

  // Filter stats grid
  const filterItems = [
    ['Total files',  allFiles.length],
    ['After filter', kept.length],
    ['Skipped',      skipped],
    ...Object.entries(skipReasons),
  ];
  document.getElementById('filter-grid').innerHTML = filterItems.map(([k, v]) =>
    `<div class="meta-item">
      <div class="meta-key">${escHtml(String(k))}</div>
      <div class="meta-val">${v}</div>
    </div>`).join('');

  // Agent bundle rows
  const agentEmoji = {
    architecture: '🏗', documentation: '📝',
    testing: '🧪', code_quality: '🔍', dependencies: '📦',
  };

  document.getElementById('agent-rows').innerHTML =
    Object.entries(agentBundles).map(([agent, b]) => {
      const pct      = Math.min(100, Math.round(100 * b.usedTokens / b.budget));
      const barColor = pct > 85 ? 'var(--amber)' : 'var(--accent)';
      return `
      <div style="margin-bottom:18px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
          <span style="font-size:15px">${agentEmoji[agent]}</span>
          <span style="font-family:var(--mono);font-size:13px;font-weight:500;color:var(--text);">${agent.replace('_',' ')}</span>
          <span style="margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--muted)">
            ${b.included.length} files · ~${b.usedTokens.toLocaleString()} / ${b.budget.toLocaleString()} tokens
          </span>
        </div>
        <div style="background:var(--surface2);border-radius:4px;height:6px;overflow:hidden;border:1px solid var(--border);">
          <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.5s ease;"></div>
        </div>
      </div>`;
    }).join('');

  // Priority file table
  const tierCounts = {};
  for (const f of withTokens) tierCounts[f.tier] = (tierCounts[f.tier] || 0) + 1;
  document.getElementById('priority-count').textContent =
    Object.entries(tierCounts).map(([t, n]) => `T${t}: ${n}`).join(' · ');

  document.getElementById('priority-body').innerHTML =
    withTokens.slice(0, 150).map(f => `
    <div class="file-row">
      <span class="file-path">${escHtml(f.path)}</span>
      <span style="font-family:var(--mono);font-size:10px;color:${TIER_COLORS[f.tier]};flex-shrink:0;min-width:110px;text-align:right;">
        ${TIER_LABELS[f.tier]}
      </span>
      <span class="file-size">${fmt_size(f.size)}</span>
    </div>`).join('')
    + (withTokens.length > 150
      ? `<div style="padding:10px 0;font-family:var(--mono);font-size:12px;color:var(--muted);">
           + ${withTokens.length - 150} more files
         </div>`
      : '');
}
