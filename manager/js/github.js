// Minimal GitHub client: read the repo, publish changes as ONE atomic commit, detect edit conflicts.
// Works in the browser and in Node (tests) - only needs fetch.

const utf8 = new TextEncoder();
const dec = new TextDecoder('utf-8');

export function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

export class GitHubError extends Error {
  constructor(message, { status = 0, code = 'error', detail } = {}) { super(message); this.status = status; this.code = code; this.detail = detail; }
}

export class GitHub {
  constructor({ token, owner, repo, branch = 'main', apiBase = 'https://api.github.com', fetchImpl } = {}) {
    Object.assign(this, { token, owner, repo, branch, apiBase: apiBase.replace(/\/+$/, '') });
    this._fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.requests = 0;
  }
  get repoPath() { return `/repos/${this.owner}/${this.repo}`; }

  async api(method, path, body, { raw = false, headers = {} } = {}) {
    this.requests++;
    let res;
    try {
      res = await this._fetch(this.apiBase + path, {
        method,
        headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new GitHubError('Could not reach GitHub. Check your internet connection and try again.', { code: 'network', detail: String(e) });
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* raw */ }
    if (!res.ok) {
      const msg = (data && data.message) || res.statusText || 'GitHub request failed';
      if (res.status === 401) throw new GitHubError('GitHub did not accept your access token. It may have expired or been revoked - create a new one in Settings.', { status: 401, code: 'auth', detail: msg });
      if (res.status === 403 && /rate limit/i.test(msg)) throw new GitHubError('GitHub is rate-limiting requests right now. Wait a few minutes and try again.', { status: 403, code: 'ratelimit', detail: msg });
      if (res.status === 403 || res.status === 404) throw new GitHubError(res.status === 404 ? 'GitHub could not find that (or your token does not have access to this repository).' : 'Your token does not have permission to do that. It needs "Contents: Read and write" on this repository.', { status: res.status, code: res.status === 404 ? 'notfound' : 'forbidden', detail: msg });
      if (res.status === 409 || res.status === 422) throw new GitHubError(msg, { status: res.status, code: 'conflict', detail: msg });
      throw new GitHubError(`GitHub error ${res.status}: ${msg}`, { status: res.status, detail: msg });
    }
    return raw ? text : data;
  }

  /** Confirms the token works and can write to the repository. */
  async verify() {
    const me = await this.api('GET', '/user').catch((e) => { if (e.code === 'notfound') return { login: '(token)' }; throw e; });
    const repo = await this.api('GET', this.repoPath);
    return { login: me.login, name: me.name || me.login, canPush: !!(repo.permissions && (repo.permissions.push || repo.permissions.admin)), fullName: repo.full_name, defaultBranch: repo.default_branch, private: repo.private };
  }

  async head() {
    const ref = await this.api('GET', `${this.repoPath}/git/ref/heads/${this.branch}`);
    const commit = await this.api('GET', `${this.repoPath}/git/commits/${ref.object.sha}`);
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha, message: commit.message, date: commit.committer && commit.committer.date };
  }

  async tree(treeSha) {
    const t = await this.api('GET', `${this.repoPath}/git/trees/${treeSha}?recursive=1`);
    return { entries: t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha, size: e.size })), truncated: !!t.truncated };
  }

  async blobBytes(sha) {
    const b = await this.api('GET', `${this.repoPath}/git/blobs/${sha}`);
    return b64ToBytes(b.content);
  }
  async blobText(sha) { return dec.decode(await this.blobBytes(sha)); }

  /** File text at a branch/commit (used for history and restore). */
  async fileText(path, ref) {
    return this.api('GET', `${this.repoPath}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref || this.branch)}`, undefined, { raw: true });
  }
  async fileSha(path, ref) {
    try { const m = await this.api('GET', `${this.repoPath}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref || this.branch)}`); return m.sha; }
    catch (e) { if (e.code === 'notfound') return null; throw e; }
  }

  async history(path, { perPage = 20 } = {}) {
    const list = await this.api('GET', `${this.repoPath}/commits?sha=${encodeURIComponent(this.branch)}&path=${encodeURIComponent(path)}&per_page=${perPage}`);
    return list.map((c) => ({ sha: c.sha, message: c.commit.message, author: (c.author && c.author.login) || c.commit.author.name, date: c.commit.author.date }));
  }

  /**
   * Publish a set of file changes as a single commit.
   * changes: [{ path, text } | { path, base64 } | { path, delete: true }]
   * expect:  { [path]: blobShaWhenLoaded | null }   // refuse (conflict) if someone changed the file since
   */
  async commit({ message, changes, expect = {} }) {
    if (!changes.length) throw new GitHubError('There is nothing to publish.', { code: 'empty' });
    // 1. upload blobs (content-addressed, reusable across retries)
    const prepared = [];
    for (const c of changes) {
      if (c.delete) { prepared.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const blob = await this.api('POST', `${this.repoPath}/git/blobs`, c.base64 !== undefined ? { content: c.base64, encoding: 'base64' } : { content: c.text, encoding: 'utf-8' });
      prepared.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await this.head();
      // 2. make sure nobody else touched the files we are about to write
      for (const [path, shaWhenLoaded] of Object.entries(expect)) {
        const now = await this.fileSha(path, head.commitSha);
        if (now !== shaWhenLoaded) {
          const e = new GitHubError(`"${path}" was changed by someone else while you were editing.`, { code: 'file-changed' }); e.path = path; throw e;
        }
      }
      const tree = await this.api('POST', `${this.repoPath}/git/trees`, { base_tree: head.treeSha, tree: prepared });
      const commit = await this.api('POST', `${this.repoPath}/git/commits`, { message, tree: tree.sha, parents: [head.commitSha] });
      try {
        await this.api('PATCH', `${this.repoPath}/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false });
        return { commitSha: commit.sha, parent: head.commitSha, url: `https://github.com/${this.owner}/${this.repo}/commit/${commit.sha}` };
      } catch (e) {
        if (e.code === 'conflict' && attempt < 2) continue;      // branch moved: re-check and rebuild on the new head
        throw e;
      }
    }
    throw new GitHubError('Could not publish because the site changed repeatedly. Please try again.', { code: 'moved' });
  }
}

export { utf8 };
