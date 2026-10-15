// LinkParty renderer. Pure functions, no DOM, no network.
// Shared by the admin (live preview + save) and scripts/render.mjs (local regeneration),
// so the page you preview is byte-for-byte the page that is committed.
import { ICONS } from './icons.js';
import { BASE_CSS } from './styles.js';

export const SCHEMA_VERSION = 1;
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const ASSET_RE = /^assets\/[A-Za-z0-9._\-\/]+$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Own-property lookup so a hostile key like "constructor" or "__proto__" falls back instead of crashing.
const own = (map, key, fallback) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : fallback);

/* ---------- escaping and URL safety ---------- */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Returns the trimmed URL if it is absolute and uses an allowed scheme, else null. */
export function safeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /[\u0000-\u001f\u007f\s]/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return null;
  if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname) return null;
  return s;
}

/** Self-hosted asset path (assets/...). No data:, no remote hosts, no traversal. */
export function safeAsset(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.includes('..') || !ASSET_RE.test(s)) return null;
  return s;
}

/* ---------- themes ---------- */

export const FONT_STACKS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif, "Apple Color Emoji", "Segoe UI Emoji"',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace, "Apple Color Emoji", "Segoe UI Emoji"',
};

export const SHAPES = { pill: '999px', rounded: '14px', soft: '8px', square: '2px' };

// Every light/dark pair is checked for WCAG AA contrast by tests/render.test.mjs.
export const PRESETS = {
  classic: {
    label: 'Classic (your Linktree)',
    accent: '#2f5fd0',
    light: { bg: '#eceef1', surface: '#ffffff', text: '#111111', muted: '#586070', line: '#dcdfe5' },
    dark: { bg: '#14161b', surface: '#1f2229', text: '#f3f4f6', muted: '#a4acba', line: '#2d313a' },
    accentDark: '#7ea2ff',
  },
  midnight: {
    label: 'Midnight',
    accent: '#4f5fe8',
    light: { bg: '#f1f2fa', surface: '#ffffff', text: '#14162b', muted: '#565a78', line: '#d9dcf0' },
    dark: { bg: '#0b0d1a', surface: '#151934', text: '#eef0ff', muted: '#a3a9d6', line: '#262b52' },
    accentDark: '#98a3ff',
  },
  paper: {
    label: 'Paper',
    accent: '#a8481f',
    light: { bg: '#f5efe3', surface: '#fffdf8', text: '#2b2417', muted: '#6a5d47', line: '#e2d8c3' },
    dark: { bg: '#1b1814', surface: '#26221c', text: '#f1e9d8', muted: '#b7aa92', line: '#3a342b' },
    accentDark: '#f0a070',
  },
  forest: {
    label: 'Forest',
    accent: '#217a4a',
    light: { bg: '#e7efe8', surface: '#ffffff', text: '#14231a', muted: '#4d6355', line: '#cfdcd1' },
    dark: { bg: '#0e1812', surface: '#17261d', text: '#e6f2ea', muted: '#9fb8a8', line: '#254030' },
    accentDark: '#63d596',
  },
  sunset: {
    label: 'Sunset',
    accent: '#c2361f',
    light: { bg: '#fdeee4', surface: '#ffffff', text: '#2a1410', muted: '#74504a', line: '#f0d6c8' },
    dark: { bg: '#1d0f12', surface: '#2c1519', text: '#ffe9e0', muted: '#d1a89d', line: '#47262b' },
    accentDark: '#ff8a6b',
  },
  mono: {
    label: 'Mono',
    accent: '#444444',
    light: { bg: '#ffffff', surface: '#f3f3f4', text: '#000000', muted: '#555555', line: '#dddddd' },
    dark: { bg: '#000000', surface: '#121212', text: '#ffffff', muted: '#a8a8a8', line: '#2a2a2a' },
    accentDark: '#cfcfcf',
  },
};

export const DEFAULT_THEME = {
  preset: 'classic',
  mode: 'auto', // auto | light | dark
  accent: '', // '' = use the preset's accent
  buttonShape: 'soft', // pill | rounded | soft | square
  buttonStyle: 'filled', // filled | outline | soft
  background: 'solid', // solid | gradient
  font: 'sans', // sans | serif | mono
};

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function onColor(bg) {
  return contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#000000' : '#ffffff';
}

function themeVars(theme, side) {
  const p = own(PRESETS, theme.preset, PRESETS.classic);
  const c = side === 'dark' ? p.dark : p.light;
  const custom = HEX_RE.test(theme.accent) ? theme.accent : '';
  const accent = custom || (side === 'dark' ? p.accentDark : p.accent);
  return [
    `--bg:${c.bg}`, `--surface:${c.surface}`, `--text:${c.text}`, `--muted:${c.muted}`,
    `--line:${c.line}`, `--accent:${accent}`, `--on-accent:${onColor(accent)}`,
  ].join(';');
}

export function themeCss(themeIn) {
  const theme = { ...DEFAULT_THEME, ...(themeIn || {}) };
  const light = themeVars(theme, 'light');
  const dark = themeVars(theme, 'dark');
  const radius = own(SHAPES, theme.buttonShape, SHAPES.soft);
  const font = own(FONT_STACKS, theme.font, FONT_STACKS.sans);
  let vars;
  let scheme;
  if (theme.mode === 'dark') { vars = `:root{${dark}}`; scheme = 'dark'; }
  else if (theme.mode === 'light') { vars = `:root{${light}}`; scheme = 'light'; }
  else {
    vars = `:root{${light}}@media (prefers-color-scheme:dark){:root{${dark}}}`;
    scheme = 'light dark';
  }
  const gradient = theme.background === 'gradient' ? ' bg-gradient' : '';
  const style = `btn-${['filled', 'outline', 'soft'].includes(theme.buttonStyle) ? theme.buttonStyle : 'filled'}`;
  return {
    css: `${vars}:root{color-scheme:${scheme};--radius:${radius};--font:${font}}`,
    bodyClass: `${style}${gradient}`,
    scheme,
  };
}

/* ---------- data model ---------- */

export const ICON_CHOICES = [
  'link', 'mail', 'world', 'app-window', 'brand-youtube', 'brand-instagram', 'brand-linkedin',
  'brand-x', 'brand-twitter', 'brand-facebook', 'brand-tiktok', 'brand-github', 'brand-spotify',
  'brand-apple', 'brand-paypal', 'brand-openai', 'music', 'coffee', 'coin', 'shirt',
];

export function newId(prefix = 'lnk') {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}

export function normalize(input) {
  const d = JSON.parse(JSON.stringify(input || {}));
  d.version = SCHEMA_VERSION;
  d.profile = { name: '', bio: '', avatar: '', title: '', description: '', url: '', ...(d.profile || {}) };
  d.theme = { ...DEFAULT_THEME, ...(d.theme || {}) };
  d.header = Array.isArray(d.header) ? d.header : [];
  d.items = Array.isArray(d.items) ? d.items : [];
  d.sites = Array.isArray(d.sites) ? d.sites : [];
  for (const it of [...d.header, ...d.items]) {
    if (!it.id) it.id = newId(it.type === 'header' ? 'sec' : 'lnk');
    if (it.enabled === undefined) it.enabled = true;
  }
  return d;
}

/** Returns [{path, message, level}] where level is 'error' or 'warning'. */
export function validate(data) {
  const out = [];
  const err = (path, message) => out.push({ path, message, level: 'error' });
  const warn = (path, message) => out.push({ path, message, level: 'warning' });
  const d = data || {};
  const p = d.profile || {};
  if (!String(p.name || '').trim()) err('profile.name', 'Name is required.');
  if (p.avatar && !safeAsset(p.avatar)) err('profile.avatar', 'Avatar must be a file in assets/.');
  if (p.url && !/^https:\/\//i.test(p.url)) err('profile.url', 'Site URL must start with https://');
  if (d.theme && d.theme.accent && !HEX_RE.test(d.theme.accent)) err('theme.accent', 'Accent must be a hex color like #2f5fd0.');
  const seen = new Set();
  const check = (it, where) => {
    const path = `${where}[${it.id}]`;
    if (seen.has(it.id)) err(path, `Duplicate id ${it.id}.`);
    seen.add(it.id);
    if (it.type === 'header') {
      if (!String(it.title || '').trim()) err(path, 'Section needs a title.');
      return;
    }
    if (it.type === 'link') {
      if (!String(it.title || '').trim()) err(path, 'Link needs a title.');
      if (!safeUrl(it.url)) err(path, `"${it.title || 'Untitled'}": URL must be a full http, https, mailto or tel address.`);
      if (it.thumbnail && !safeAsset(it.thumbnail)) err(path, 'Thumbnail must be a file in assets/.');
      if (it.featured && !it.thumbnail) warn(path, `"${it.title}": featured cards look best with a thumbnail.`);
    } else if (it.type === 'icon-link') {
      if (!safeUrl(it.url)) err(path, `"${it.label || 'Icon'}": URL must be a full http, https, mailto or tel address.`);
      if (!it.icon || !Object.hasOwn(ICONS, it.icon)) err(path, 'Pick an icon.');
      if (!String(it.label || '').trim()) err(path, 'Icon needs a label (used for screen readers).');
    } else {
      err(path, `Unknown item type "${it.type}".`);
    }
  };
  (d.header || []).forEach((it) => check({ ...it, type: 'icon-link' }, 'header'));
  (d.items || []).forEach((it) => check(it, 'items'));
  return out;
}

/* ---------- rendering ---------- */

function icon(name, cls = 'ico') {
  const inner = own(ICONS, name, ICONS.link);
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function assetSrc(path, opts) {
  const safe = safeAsset(path);
  if (!safe) return '';
  if (opts.assetMap && opts.assetMap[safe]) return opts.assetMap[safe];
  return safe;
}

/** Groups the flat ordered items into sections, dropping disabled and archived content. */
export function buildSections(items) {
  const sections = [];
  let cur = { header: null, entries: [], hidden: false };
  sections.push(cur);
  for (const it of items || []) {
    if (it.archived === true) continue; // archived headers are transparent, like in the admin
    if (it.type === 'header') {
      cur = { header: it, entries: [], hidden: it.enabled === false };
      sections.push(cur);
      continue;
    }
    if (cur.hidden) continue;
    if (it.enabled === false) continue;
    cur.entries.push(it);
  }
  return sections.filter((s) => !s.hidden && (s.header || s.entries.length));
}

function renderLink(it, opts) {
  const href = safeUrl(it.url);
  if (!href) return '';
  const thumb = it.thumbnail ? assetSrc(it.thumbnail, opts) : '';
  const title = esc(it.title);
  const desc = it.description ? `<span class="desc">${esc(it.description)}</span>` : '';
  if (it.featured && thumb) {
    return `<a class="link card" href="${esc(href)}" data-id="${esc(it.id)}"><img class="card-img" src="${esc(thumb)}" alt="" width="1200" height="675" loading="lazy" decoding="async"><span class="body"><span class="title">${title}</span>${desc}</span></a>`;
  }
  let lead = '<span class="lead"></span>';
  if (thumb) lead = `<span class="lead"><img class="thumb" src="${esc(thumb)}" alt="" width="48" height="48" loading="lazy" decoding="async"></span>`;
  else if (it.icon && Object.hasOwn(ICONS, it.icon)) lead = `<span class="lead">${icon(it.icon)}</span>`;
  return `<a class="link${it.description ? ' has-desc' : ''}" href="${esc(href)}" data-id="${esc(it.id)}">${lead}<span class="body"><span class="title">${title}</span>${desc}</span><span class="lead"></span></a>`;
}

function renderIconRow(list, cls) {
  const lis = list
    .map((it) => {
      const href = safeUrl(it.url);
      if (!href) return '';
      return `<li><a href="${esc(href)}" aria-label="${esc(it.label)}" title="${esc(it.label)}" data-id="${esc(it.id)}">${icon(it.icon, 'ico ico-lg')}</a></li>`;
    })
    .join('');
  return lis ? `<ul class="${cls}">${lis}</ul>` : '';
}

function renderSection(sec, opts, index) {
  const parts = [];
  let run = [];
  const flushRun = () => {
    if (run.length) parts.push(renderIconRow(run, 'icons inline'));
    run = [];
  };
  let linkItems = [];
  const flushLinks = () => {
    if (linkItems.length) parts.push(`<ul class="links">${linkItems.join('')}</ul>`);
    linkItems = [];
  };
  for (const it of sec.entries) {
    if (it.type === 'icon-link') { flushLinks(); run.push(it); continue; }
    flushRun();
    const html = renderLink(it, opts);
    if (html) linkItems.push(`<li>${html}</li>`);
  }
  flushRun();
  flushLinks();
  if (sec.header && sec.header.footnote) parts.push(`<p class="footnote">${esc(sec.header.footnote)}</p>`);
  if (!parts.length && !(sec.header && sec.header.title)) return '';
  const hid = `s${index}`;
  const heading = sec.header ? `<h2 id="${hid}">${esc(sec.header.title)}</h2>` : '';
  const label = sec.header ? ` aria-labelledby="${hid}"` : '';
  return `<section${label} data-id="${esc(sec.header ? sec.header.id : 'top')}">${heading}${parts.join('')}</section>`;
}

function absolute(base, path) {
  if (!path) return '';
  try { return new URL(path, base).href; } catch { return ''; }
}

function jsonLd(data) {
  const p = data.profile;
  const sameAs = (data.header || [])
    .filter((h) => h.enabled !== false && /^https?:/i.test(h.url || ''))
    .map((h) => h.url);
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.name,
    description: p.description || p.bio,
    url: p.url || undefined,
    image: p.url && p.avatar ? absolute(p.url, p.avatar) : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  };
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

const CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'none'";

function shell(data, opts, bodyInner, extra = {}) {
  const t = themeCss(data.theme);
  const p = data.profile;
  const title = esc(extra.title || p.title || p.name);
  const desc = esc(p.description || p.bio);
  const base = p.url || '';
  const ogImage = base && p.avatar ? absolute(base, p.avatar) : '';
  const lightBg = own(PRESETS, data.theme.preset, PRESETS.classic).light.bg;
  const darkBg = own(PRESETS, data.theme.preset, PRESETS.classic).dark.bg;
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    opts.base ? `<base href="${esc(opts.base)}"${opts.preview ? ' target="_blank"' : ''}>` : '',
    opts.preview ? '' : `<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">`,
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    `<meta name="color-scheme" content="${t.scheme}">`,
    t.scheme === 'dark'
      ? `<meta name="theme-color" content="${darkBg}">`
      : t.scheme === 'light'
        ? `<meta name="theme-color" content="${lightBg}">`
        : `<meta name="theme-color" content="${lightBg}" media="(prefers-color-scheme: light)"><meta name="theme-color" content="${darkBg}" media="(prefers-color-scheme: dark)">`,
    base ? `<link rel="canonical" href="${esc(extra.canonical || base)}">` : '',
    p.avatar ? `<link rel="icon" href="${esc(assetSrc(p.avatar, opts))}">` : '',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    base ? `<meta property="og:url" content="${esc(base)}">` : '',
    ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : '',
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : '',
    extra.noindex ? '<meta name="robots" content="noindex">' : '',
    `<style>${t.css}${BASE_CSS}</style>`,
    extra.jsonLd === false ? '' : `<script type="application/ld+json">${jsonLd(data)}</script>`,
  ].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body class="${t.bodyClass}">
${bodyInner}
</body>
</html>
`;
}

export function renderPage(dataIn, opts = {}) {
  const data = normalize(dataIn);
  const p = data.profile;
  const avatar = p.avatar && safeAsset(p.avatar)
    ? `<img class="avatar" src="${esc(assetSrc(p.avatar, opts))}" alt="${esc(p.name)}" width="96" height="96" fetchpriority="high" decoding="async">`
    : '';
  const header = renderIconRow((data.header || []).filter((h) => h.enabled !== false), 'icons');
  const sections = buildSections(data.items).map((s, i) => renderSection(s, opts, i)).filter(Boolean).join('\n');
  const body = `<main class="page">
<header class="profile">
${avatar}
<h1>${esc(p.name)}</h1>
${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
${header ? `<nav aria-label="Social links">${header}</nav>` : ''}
</header>
${sections}
</main>`;
  return shell(data, opts, body);
}

export function renderNotFound(dataIn, optsIn = {}) {
  const opts = { base: '/', ...optsIn }; // 404 is served from any depth, so assets must be root-relative
  const data = normalize(dataIn);
  const body = `<main class="page">
<header class="profile">
<h1>Page not found</h1>
<p class="bio">That page does not exist.</p>
<p><a class="link" href="/"><span class="lead"></span><span class="body"><span class="title">Back to ${esc(data.profile.name)}</span></span><span class="lead"></span></a></p>
</header>
</main>`;
  return shell(data, opts, body, { title: `Not found | ${data.profile.name}`, noindex: true, jsonLd: false, canonical: data.profile.url });
}
