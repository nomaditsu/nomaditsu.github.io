// GitHub REST client and token storage for the LinkParty admin.
// The token only ever goes to https://api.github.com (enforced by the admin page CSP).

const API = 'https://api.github.com';
const STORE_KEY = 'linkparty.settings.v1';

/* ---------- errors ---------- */

export class GhError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.kind = kind; // auth | forbidden | ratelimit | notfound | conflict | validation | offline | network | unknown
    this.status = status;
  }
}

/* ---------- settings + token (localStorage, optional passphrase encryption) ---------- */

const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptToken(token, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) };
}

async function decryptToken(blob, passphrase) {
  const key = await deriveKey(passphrase, b64.dec(blob.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(blob.iv) }, key, b64.dec(blob.ct));
  return new TextDecoder().decode(pt);
}

const DEFAULTS = { owner: 'nomaditsu', repo: 'nomaditsu.github.io', branch: 'main' };

export function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...DEFAULTS, token: '', tokenEnc: null, ...raw };
  } catch { /* private mode or corrupt value: fall through */ }
  return { ...DEFAULTS, token: '', tokenEnc: null };
}

/** `token` is the plaintext token; with `passphrase` it is stored encrypted, never in the clear. */
export async function writeSettings({ owner, repo, branch, token, passphrase }) {
  const out = { owner: owner.trim(), repo: repo.trim(), branch: (branch || 'main').trim(), token: '', tokenEnc: null };
  if (token) {
    if (passphrase) out.tokenEnc = await encryptToken(token, passphrase);
    else out.token = token;
  }
  localStorage.setItem(STORE_KEY, JSON.stringify(out));
  return out;
}

export function clearToken() {
  const s = readSettings();
  localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, token: '', tokenEnc: null }));
}

export async function unlock(settings, passphrase) {
  try {
    return await decryptToken(settings.tokenEnc, passphrase);
  } catch {
    throw new GhError('auth', 'Wrong passphrase.');
  }
}

/* ---------- low-level request ---------- */

function utf8ToB64(text) {
  return b64.enc(new TextEncoder().encode(text));
}

function b64ToUtf8(s) {
  return new TextDecoder().decode(b64.dec(s.replace(/\s/g, '')));
}

export class GitHub {
  constructor({ owner, repo, branch, token }) {
    Object.assign(this, { owner, repo, branch, token });
  }

  get repoPath() {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  async request(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new GhError('offline', 'You are offline. Your changes are still here; save again when you reconnect.');
      }
      throw new GhError('network', 'Could not reach GitHub. Check your connection and try again.');
    }
    if (res.ok) return res.status === 204 ? null : res.json();

    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* no body */ }
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (res.status === 401) {
      throw new GhError('auth', 'GitHub rejected the token (invalid, expired or revoked). Open Settings and paste a new one.', 401);
    }
    if ((res.status === 403 || res.status === 429) && (remaining === '0' || /rate limit/i.test(detail))) {
      const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : 'a few minutes';
      throw new GhError('ratelimit', `GitHub rate limit reached. Try again after ${when}.`, res.status);
    }
    if (res.status === 403) {
      throw new GhError('forbidden', 'The token is not allowed to do that. It needs "Contents: Read and write" on this repository.', 403);
    }
    if (res.status === 404) {
      throw new GhError('notfound', 'Not found: check owner, repo and branch in Settings, and that the token has access to this repo.', 404);
    }
    if (res.status === 409 || (res.status === 422 && /fast.?forward|not a fast/i.test(detail))) {
      throw new GhError('conflict', 'The site changed on GitHub while you were editing.', res.status);
    }
    if (res.status === 422) throw new GhError('validation', `GitHub refused the request: ${detail || 'validation failed'}.`, 422);
    throw new GhError('unknown', `GitHub error ${res.status}${detail ? `: ${detail}` : ''}.`, res.status);
  }

  /* ---------- reads ---------- */

  async getRepo() {
    return this.request(this.repoPath);
  }

  /** Returns {sha, text} for a file on the branch, or null if it does not exist. */
  async getFile(path) {
    try {
      const j = await this.request(`${this.repoPath}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.branch)}`);
      return { sha: j.sha, text: j.content ? b64ToUtf8(j.content) : '' };
    } catch (e) {
      if (e.kind === 'notfound') return null;
      throw e;
    }
  }

  /** Cheap write-permission probe: creating an unreferenced blob needs Contents: write. */
  async probeWrite() {
    await this.request(`${this.repoPath}/git/blobs`, { method: 'POST', body: { content: 'linkparty-write-probe', encoding: 'utf-8' } });
  }

  /* ---------- atomic multi-file commit (Git Data API) ---------- */

  /**
   * files: [{path, text}] or [{path, base64}]; deletes: [path].
   * Re-reads the branch head right before committing, and fast-forwards only, so a
   * concurrent change on GitHub raises a 'conflict' error instead of being overwritten.
   */
  async commit({ files, deletes = [], message }) {
    const ref = await this.request(`${this.repoPath}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const headSha = ref.object.sha;
    const head = await this.request(`${this.repoPath}/git/commits/${headSha}`);

    const entries = [];
    const shas = {};
    for (const f of files) {
      const blob = await this.request(`${this.repoPath}/git/blobs`, {
        method: 'POST',
        body: f.base64 !== undefined
          ? { content: f.base64, encoding: 'base64' }
          : { content: f.text, encoding: 'utf-8' },
      });
      shas[f.path] = blob.sha;
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const path of deletes) entries.push({ path, mode: '100644', type: 'blob', sha: null });

    const tree = await this.request(`${this.repoPath}/git/trees`, {
      method: 'POST',
      body: { base_tree: head.tree.sha, tree: entries },
    });
    const commit = await this.request(`${this.repoPath}/git/commits`, {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [headSha] },
    });
    await this.request(`${this.repoPath}/git/refs/heads/${encodeURIComponent(this.branch)}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false },
    });
    return { commitSha: commit.sha, shas };
  }
}

export { utf8ToB64 };
