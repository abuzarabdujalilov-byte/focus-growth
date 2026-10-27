/* ==========================================================================
   FOCUS — GitHub sync module
   Backs up / restores the app data as a JSON file in a GitHub repository
   using the GitHub REST "contents" API. Runs entirely in the browser.
   Exposes a single global: window.GitHubSync
   ========================================================================== */
(function () {
  'use strict';

  const CONFIG_KEY = 'focus-github-config-v1';   // owner, repo, branch, path (+ token if remembered)
  const API = 'https://api.github.com';
  const NAME_RE = /^[A-Za-z0-9._-]+$/;
  const BRANCH_RE = /^[A-Za-z0-9._\/-]+$/;

  const DEFAULTS = { owner: '', repo: '', branch: 'main', path: 'focus-data.json', token: '', remember: false };

  /* ---------- config storage ---------- */
  function loadConfig() {
    let cfg = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
    } catch (e) { /* ignore corrupt config */ }
    try {
      // A token that was not "remembered" lives only for this tab session.
      const sessionToken = sessionStorage.getItem(CONFIG_KEY + '-token');
      if (sessionToken && !cfg.token) cfg.token = sessionToken;
    } catch (e) { /* sessionStorage may be blocked */ }
    return cfg;
  }

  function saveConfig(cfg) {
    const clean = {
      owner: String(cfg.owner || '').trim(),
      repo: String(cfg.repo || '').trim(),
      branch: String(cfg.branch || 'main').trim() || 'main',
      path: String(cfg.path || 'focus-data.json').trim().replace(/^\/+/, '') || 'focus-data.json',
      token: String(cfg.token || '').trim(),
      remember: !!cfg.remember
    };
    const persisted = { ...clean, token: clean.remember ? clean.token : '' };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(persisted));
    try {
      if (clean.remember) sessionStorage.removeItem(CONFIG_KEY + '-token');
      else if (clean.token) sessionStorage.setItem(CONFIG_KEY + '-token', clean.token);
      else sessionStorage.removeItem(CONFIG_KEY + '-token');
    } catch (e) { /* ignore */ }
    return clean;
  }

  function clearConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem(CONFIG_KEY + '-token'); } catch (e) { /* ignore */ }
  }

  function validate(cfg) {
    if (!cfg.owner || !NAME_RE.test(cfg.owner)) return 'Enter a valid GitHub owner (username or organization).';
    if (!cfg.repo || !NAME_RE.test(cfg.repo)) return 'Enter a valid repository name.';
    if (!cfg.branch || !BRANCH_RE.test(cfg.branch)) return 'Enter a valid branch name.';
    if (!cfg.path || cfg.path.split('/').some(s => !s || s === '.' || s === '..')) return 'Enter a valid file path such as focus-data.json.';
    if (!cfg.token) return 'Enter a personal access token.';
    return '';
  }

  /* ---------- helpers ---------- */
  function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }
  function repoUrl(cfg) {
    return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  }
  function fileUrl(cfg) {
    return `${repoUrl(cfg)}/contents/${encodePath(cfg.path)}`;
  }
  // Unicode-safe base64 for the contents API.
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }

  async function request(cfg, url, options = {}) {
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: {
          'Authorization': 'Bearer ' + cfg.token,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {})
        }
      });
    } catch (e) {
      throw new Error('Could not reach GitHub. Check your internet connection.');
    }
    return res;
  }

  async function errorMessage(res, fallback) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.message ? j.message : ''; } catch (e) { /* ignore */ }
    if (res.status === 401) return 'GitHub rejected the token (401). Check that it is correct and not expired.';
    if (res.status === 403) return 'Access denied (403). The token needs “Contents: Read and write” on this repository' + (detail ? ' — ' + detail : '.');
    if (res.status === 404) return 'Not found (404). Check the owner, repository and branch names, and that the token can access this repository.';
    if (res.status === 409) return 'Conflict (409). The file changed on GitHub — pull first, then push again.';
    if (res.status === 422) return 'GitHub could not accept the request (422)' + (detail ? ': ' + detail : '.');
    return fallback + (detail ? ' (' + res.status + ': ' + detail + ')' : ' (' + res.status + ')');
  }

  /* ---------- public API ---------- */

  // Confirms the token works and the repo + branch exist.
  async function testConnection(cfg) {
    const problem = validate(cfg);
    if (problem) throw new Error(problem);
    const repoRes = await request(cfg, repoUrl(cfg));
    if (!repoRes.ok) throw new Error(await errorMessage(repoRes, 'Could not open the repository'));
    const repo = await repoRes.json();
    const branchRes = await request(cfg, `${repoUrl(cfg)}/branches/${encodePath(cfg.branch)}`);
    if (!branchRes.ok) throw new Error(await errorMessage(branchRes, 'Could not find that branch'));
    return { fullName: repo.full_name, isPrivate: !!repo.private, canPush: !repo.permissions || !!repo.permissions.push };
  }

  // Returns the blob sha of the existing file, or null when it does not exist yet.
  async function getRemoteSha(cfg) {
    const res = await request(cfg, `${fileUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorMessage(res, 'Could not check the existing file'));
    const json = await res.json();
    return json && json.sha ? json.sha : null;
  }

  // Creates or updates the file with the given data object.
  async function push(cfg, data) {
    const problem = validate(cfg);
    if (problem) throw new Error(problem);
    const sha = await getRemoteSha(cfg);
    const body = {
      message: 'FOCUS backup ' + new Date().toISOString(),
      content: toBase64(JSON.stringify(data, null, 2)),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;
    const res = await request(cfg, fileUrl(cfg), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'Push failed'));
    const json = await res.json();
    return { created: !sha, commitUrl: json && json.commit ? json.commit.html_url : '' };
  }

  // Downloads and parses the JSON file. Returns null when the file does not exist.
  async function pull(cfg) {
    const problem = validate(cfg);
    if (problem) throw new Error(problem);
    const res = await request(cfg, `${fileUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, {
      headers: { 'Accept': 'application/vnd.github.raw+json' }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorMessage(res, 'Pull failed'));
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error('The file on GitHub is not valid JSON.'); }
  }

  window.GitHubSync = { DEFAULTS, loadConfig, saveConfig, clearConfig, validate, testConnection, push, pull };
})();