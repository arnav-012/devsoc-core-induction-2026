// ── Phase 1 — URL parser + GitHub API fetcher ──────────────────────────────
// Pure functions: no DOM access, easy to unit test in isolation.

function parseGitHubUrl(url) {
  url = url.trim();
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2], branch: null };

  if (!/^https?:\/\/github\.com\//.test(url))
    throw new Error("Not a valid GitHub URL.");

  const path = url.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '').split('?')[0].split('#')[0];
  const parts = path.split('/');
  if (parts.length < 2) throw new Error("Could not find owner/repo in URL.");

  const owner = parts[0];
  const repo  = parts[1].replace(/\.git$/, '');
  let branch  = null;
  if (parts.length >= 4 && (parts[2] === 'tree' || parts[2] === 'blob')) {
    branch = parts[3];
  }
  return { owner, repo, branch };
}

// ── GitHub API ────────────────────────────────────────────────────────────────

async function ghFetch(path) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error("Repository not found. Is it public?");
    if (res.status === 403) throw new Error("GitHub rate limit hit. Wait a minute and try again.");
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }
  return res.json();
}
