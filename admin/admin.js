// LinkParty admin. Vanilla ES modules, no dependencies, no third-party requests.
import {
  renderPage, renderNotFound, validate, normalize, safeUrl, safeAsset, esc, newId,
  PRESETS, ICON_CHOICES, DEFAULT_THEME, SHAPES, FONT_STACKS,
} from '../js/render.js';
import { ICONS } from '../js/icons.js';
import { GitHub, GhError, readSettings, writeSettings, clearToken, unlock } from './api.js';
import { makeSortable } from './dnd.js';

// A meta CSP cannot set frame-ancestors, so refuse to run inside someone else's frame.
if (window.top !== window.self) {
  document.documentElement.remove();
  throw new Error('LinkParty admin cannot run in a frame.');
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- state ---------- */

const S = {
  data: null,
  saved: '',
  savedRefs: new Set(),
  loadedSha: null,
  pending: new Map(), // asset path -> { base64, dataUrl }
  undo: [],
  redo: [],
  coalesce: { key: '', t: 0 },
  focus: null,
  ui: {
    tab: 'links',
    open: new Set(),
    collapsed: new Set(),
    previewMode: '',
    readOnly: true,
    demo: true,
    token: '',
    errors: [],
    saving: false,
  },
};

const ser = () => JSON.stringify(S.data);
const isDirty = () => S.data && ser() !== S.saved;
const itemIndex = (id) => S.data.items.findIndex((i) => i.id === id);
const idOf = (path) => (/\[(.+)\]$/.exec(path) || [])[1] || '';

function ico(name, cls = '') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${cls ? ` class="${cls}"` : ''}>${ICONS[name] || ''}</svg>`;
}

function assetUrl(path) {
  const p = S.pending.get(path);
  if (p) return p.dataUrl;
  return safeAsset(path) ? `../${path}` : '';
}

function refs(data) {
  const out = new Set();
  if (data.profile.avatar) out.add(data.profile.avatar);
  for (const it of data.items) if (it.thumbnail) out.add(it.thumbnail);
  return out;
}

/* ---------- mutation, undo, status ---------- */

function mutate(fn, { key = '', render = true } = {}) {
  const now = Date.now();
  const sameBurst = key && S.coalesce.key === key && now - S.coalesce.t < 1500;
  if (!sameBurst) {
    S.undo.push(ser());
    if (S.undo.length > 100) S.undo.shift();
    S.redo.length = 0;
  }
  S.coalesce = { key, t: now };
  fn(S.data);
  afterChange(render);
}

function restore(from, to) {
  if (!from.length) return;
  to.push(ser());
  S.data = JSON.parse(from.pop());
  S.coalesce = { key: '', t: 0 };
  afterChange(true);
}

let previewTimer = 0;
function afterChange(render) {
  if (render) renderAll();
  updateChrome();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

function setStatus(kind, text) {
  const el = $('#status');
  el.className = `status ${kind}`;
  el.textContent = text;
}

function updateChrome() {
  const dirty = isDirty();
  if (!S.ui.saving) {
    if (S.ui.demo) setStatus('', dirty ? 'Demo: edits stay in this tab' : 'Demo: nothing is saved');
    else if (S.ui.readOnly) setStatus('err', dirty ? 'Unsaved changes (read only)' : 'Read only: GitHub could not be reached');
    else setStatus(dirty ? 'dirty' : '', dirty ? 'Unsaved changes' : 'All changes saved');
  }
  $('#btn-save').disabled = !dirty || S.ui.saving;
  $('#btn-undo').disabled = !S.undo.length;
  $('#btn-redo').disabled = !S.redo.length;
  const n = S.data ? S.data.items.filter((i) => i.archived).length : 0;
  $('#archive-count').textContent = n ? String(n) : '';
}

function toast(message, { kind = '', action = null, ms = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { action.fn(); el.remove(); });
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

function banner(message, { kind = '', actions = [] } = {}) {
  const el = $('#banner');
  if (!message) { el.hidden = true; return; }
  el.className = `banner ${kind}`;
  el.textContent = message;
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = a.label;
    b.addEventListener('click', a.fn);
    el.appendChild(b);
  }
  el.hidden = false;
}

/* ---------- Links tab ---------- */

function blockLength(items, i) {
  let n = 1;
  if (items[i].type === 'header') {
    while (i + n < items.length && items[i + n].type !== 'header') n += 1;
  }
  return n;
}

function iconOptions(selected, allowNone) {
  const none = allowNone ? `<option value=""${selected ? '' : ' selected'}>No icon</option>` : '';
  return none + ICON_CHOICES.map((n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${n.replace(/^brand-/, '')}</option>`).join('');
}

function thumbEditor(it) {
  const src = it.thumbnail ? assetUrl(it.thumbnail) : '';
  return `<div class="thumb-edit">
    ${src ? `<img src="${esc(src)}" alt="">` : '<span class="none">No image</span>'}
    <button class="btn" type="button" data-act="thumb-upload">${src ? 'Replace image' : 'Add image'}</button>
    ${src ? '<button class="btn quiet" type="button" data-act="thumb-remove">Remove</button>' : ''}
  </div>`;
}

function editForm(it) {
  if (it.type === 'header') {
    return `<label>Section title<input data-field="title" value="${esc(it.title)}"></label>
      <label>Small note under the section (optional)<textarea data-field="footnote" rows="2">${esc(it.footnote || '')}</textarea></label>`;
  }
  if (it.type === 'icon-link') {
    return `<label>Label (for screen readers)<input data-field="label" value="${esc(it.label || '')}"></label>
      <label>URL<input data-field="url" inputmode="url" value="${esc(it.url || '')}"></label>
      <label>Icon<select data-field="icon">${iconOptions(it.icon, false)}</select></label>`;
  }
  return `<label>Title<input data-field="title" value="${esc(it.title || '')}"></label>
    <label>URL<input data-field="url" inputmode="url" placeholder="https://" value="${esc(it.url || '')}"></label>
    <label>Description (optional)<textarea data-field="description" rows="2">${esc(it.description || '')}</textarea></label>
    ${thumbEditor(it)}
    <label>Icon (used when there is no image)<select data-field="icon">${iconOptions(it.icon || '', true)}</select></label>
    <label class="check"><input type="checkbox" data-field="featured"${it.featured ? ' checked' : ''}> Featured card (large 16:9 image on top)</label>`;
}

function rowHtml(it, invalid) {
  const isHeader = it.type === 'header';
  const title = it.type === 'icon-link' ? it.label : it.title;
  const open = S.ui.open.has(it.id);
  const off = it.enabled === false;
  const thumb = it.thumbnail && assetUrl(it.thumbnail)
    ? `<img class="row-thumb" src="${esc(assetUrl(it.thumbnail))}" alt="" style="vertical-align:middle">` : '';
  const caret = isHeader
    ? `<button class="btn icon sm quiet" type="button" data-act="collapse" aria-expanded="${!S.ui.collapsed.has(it.id)}" aria-label="${S.ui.collapsed.has(it.id) ? 'Expand' : 'Collapse'} ${esc(title)}">${ico(S.ui.collapsed.has(it.id) ? 'chevron-right' : 'chevron-down')}</button>` : '';
  return `<li class="row ${isHeader ? 'section' : 'link'}${off ? ' off' : ''}${invalid ? ' invalid' : ''}" data-id="${esc(it.id)}" data-type="${esc(it.type)}" data-label="${esc(title || 'Untitled')}">
    <button class="grip" type="button" data-grip aria-label="Drag to reorder ${esc(title || 'item')}">${ico('grip-vertical')}</button>
    <div class="row-main">
      <button class="row-title" type="button" data-act="edit" aria-expanded="${open}">${thumb}${esc(title || 'Untitled')}</button>
      ${it.url && !isHeader ? `<span class="row-url">${esc(it.url)}</span>` : ''}
    </div>
    <div class="row-actions">
      ${caret}
      <label class="switch" title="Show on the page"><input type="checkbox" data-act="enabled"${off ? '' : ' checked'} aria-label="Show ${esc(title || 'item')} on the page"></label>
      <button class="btn icon sm quiet" type="button" data-act="up" aria-label="Move ${esc(title || 'item')} up">${ico('arrow-up')}</button>
      <button class="btn icon sm quiet" type="button" data-act="down" aria-label="Move ${esc(title || 'item')} down">${ico('arrow-down')}</button>
      <button class="btn icon sm quiet" type="button" data-act="archive" aria-label="Archive ${esc(title || 'item')}" title="Archive">${ico('archive')}</button>
      <button class="btn icon sm quiet danger" type="button" data-act="delete" aria-label="Delete ${esc(title || 'item')}" title="Delete">${ico('trash')}</button>
    </div>
    <div class="row-edit"${open ? '' : ' hidden'}>${open ? editForm(it) : ''}</div>
  </li>`;
}

function renderItems() {
  const invalidIds = new Set(S.ui.errors.filter((e) => e.level === 'error').map((e) => idOf(e.path)));
  let html = '';
  let current = null; // id of the section being emitted, or 'top'
  let collapsed = false;
  let emittedAny = false;
  const closeSection = () => {
    if (current && !collapsed && (current !== 'top' || emittedAny)) {
      html += `<li class="row-add"><button class="btn quiet add-here" type="button" data-act="add-here" data-section="${esc(current)}">+ Add link here</button></li>`;
    }
  };
  for (const it of S.data.items) {
    if (it.archived) continue;
    if (it.type === 'header') {
      closeSection();
      current = it.id;
      collapsed = S.ui.collapsed.has(it.id);
      html += rowHtml(it, invalidIds.has(it.id));
      continue;
    }
    if (current === null) { current = 'top'; }
    emittedAny = true;
    if (!collapsed) html += rowHtml(it, invalidIds.has(it.id));
  }
  closeSection();
  if (!html) html = '<li class="hint">Nothing here yet. Add a section, then add links to it.</li>';
  $('#items').innerHTML = html;
  const hasHeaders = S.data.items.some((i) => i.type === 'header' && !i.archived);
  $('#toggle-all').textContent = S.ui.collapsed.size ? 'Expand all' : 'Collapse all';
  $('#toggle-all').hidden = !hasHeaders;
  renderErrors();
}

function renderErrors() {
  let box = $('#err-box');
  const errs = S.ui.errors.filter((e) => e.level === 'error');
  if (!errs.length) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'err-box';
    box.className = 'errors';
    $('#panel-links').prepend(box);
  }
  box.innerHTML = `<strong>Fix these before saving:</strong><ul>${errs.map((e) => {
    const id = idOf(e.path);
    return `<li>${id ? `<button type="button" data-goto="${esc(id)}">${esc(e.message)}</button>` : esc(e.message)}</li>`;
  }).join('')}</ul>`;
}

/* ---------- moving ---------- */

function expandSectionOf(id) {
  const items = S.data.items;
  for (let i = itemIndex(id); i >= 0; i -= 1) {
    if (items[i].type === 'header' && !items[i].archived) { S.ui.collapsed.delete(items[i].id); return; }
  }
}

function moveBlock(id, beforeId) {
  const focus = S.focus;
  mutate((d) => {
    const items = d.items;
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return;
    const block = items.splice(i, blockLength(items, i));
    const j = beforeId ? items.findIndex((x) => x.id === beforeId) : items.length;
    items.splice(j < 0 ? items.length : j, 0, ...block);
  });
  expandSectionOf(id);
  S.focus = focus;
  renderAll();
}

function moveBy(id, dir) {
  const items = S.data.items;
  const i = itemIndex(id);
  if (i < 0) return;
  S.focus = { id, act: dir < 0 ? 'up' : 'down' };
  if (items[i].type !== 'header') {
    let j = i + dir;
    while (j >= 0 && j < items.length && items[j].archived) j += dir;
    if (j < 0 || j >= items.length) return;
    const focus = S.focus;
    mutate((d) => { const [x] = d.items.splice(i, 1); d.items.splice(j, 0, x); });
    expandSectionOf(id);
    S.focus = focus;
    renderAll();
    return;
  }
  const visibleHeader = (x) => x.type === 'header' && !x.archived;
  if (dir < 0) {
    let j = i - 1;
    while (j >= 0 && !visibleHeader(items[j])) j -= 1;
    if (j < 0) return;
    moveBlock(id, items[j].id);
  } else {
    let k = i + blockLength(items, i);
    while (k < items.length && !visibleHeader(items[k])) k += 1; // skip archived sections and their links
    if (k >= items.length) return;
    let n = k + blockLength(items, k);
    while (n < items.length && !visibleHeader(items[n])) n += 1;
    moveBlock(id, n < items.length ? items[n].id : null);
  }
}

/* ---------- item actions ---------- */

function addItem(item, sectionId) {
  mutate((d) => {
    if (sectionId === undefined) { d.items.push(item); return; }
    if (sectionId === 'top') {
      const first = d.items.findIndex((x) => x.type === 'header');
      d.items.splice(first < 0 ? d.items.length : first, 0, item);
      return;
    }
    const s = d.items.findIndex((x) => x.id === sectionId);
    if (s < 0) { d.items.push(item); return; }
    d.items.splice(s + blockLength(d.items, s), 0, item);
  });
  S.ui.open.add(item.id);
  S.focus = { id: item.id, field: item.type === 'icon-link' ? 'label' : 'title' };
  renderAll();
}

function removeItem(id, mode) {
  const i = itemIndex(id);
  if (i < 0) return;
  const it = S.data.items[i];
  const len = blockLength(S.data.items, i);
  const name = (it.type === 'icon-link' ? it.label : it.title) || 'item';
  mutate((d) => {
    if (mode === 'archive') {
      for (let k = i; k < i + len; k += 1) d.items[k].archived = true;
    } else {
      d.items.splice(i, len);
    }
  });
  const extra = len > 1 ? ` and ${len - 1} link${len > 2 ? 's' : ''}` : '';
  toast(`${mode === 'archive' ? 'Archived' : 'Deleted'} "${name}"${extra}.`, {
    action: { label: 'Undo', fn: () => restore(S.undo, S.redo) },
    ms: 8000,
  });
}

function onItemsClick(e) {
  const goto = e.target.closest('[data-goto]');
  if (goto) { openItem(goto.dataset.goto); return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.row');
  const id = row ? row.dataset.id : '';
  const act = btn.dataset.act;
  if (act === 'edit') {
    if (S.ui.open.has(id)) S.ui.open.delete(id); else S.ui.open.add(id);
    S.focus = { id, act: 'edit' };
    renderAll();
  } else if (act === 'up') moveBy(id, -1);
  else if (act === 'down') moveBy(id, 1);
  else if (act === 'archive') removeItem(id, 'archive');
  else if (act === 'delete') removeItem(id, 'delete');
  else if (act === 'collapse') {
    if (S.ui.collapsed.has(id)) S.ui.collapsed.delete(id); else S.ui.collapsed.add(id);
    S.focus = { id, act: 'collapse' };
    renderAll();
  } else if (act === 'add-here') {
    addItem({ id: newId('lnk'), type: 'link', title: '', url: '', enabled: true }, btn.dataset.section);
  } else if (act === 'thumb-upload') pickImage({ kind: 'thumb', id });
  else if (act === 'thumb-remove') {
    mutate((d) => { delete d.items[itemIndex(id)].thumbnail; });
  }
}

function onItemsInput(e) {
  const el = e.target;
  const row = el.closest('.row');
  if (!row) return;
  const id = row.dataset.id;
  if (el.dataset.act === 'enabled') {
    mutate((d) => { d.items[itemIndex(id)].enabled = el.checked; });
    return;
  }
  const field = el.dataset.field;
  if (!field) return;
  const value = el.type === 'checkbox' ? el.checked : el.value;
  const isText = el.type !== 'checkbox' && el.tagName !== 'SELECT';
  if (e.type === 'change' && isText) return;
  mutate((d) => {
    const it = d.items[itemIndex(id)];
    if (el.type === 'checkbox') { if (value) it[field] = true; else delete it[field]; }
    else if (value === '' && ['description', 'icon', 'footnote'].includes(field)) delete it[field];
    else it[field] = value;
  }, { key: `${id}:${field}`, render: !isText });
  if (field === 'url') el.setAttribute('aria-invalid', String(Boolean(value) && !safeUrl(value)));
  if (isText && (field === 'title' || field === 'label')) {
    const t = $('.row-title', row);
    if (t) t.lastChild.textContent = value || 'Untitled';
    row.dataset.label = value || 'Untitled';
  }
  if (isText && field === 'url') {
    const u = $('.row-url', row);
    if (u) u.textContent = value;
  }
}

function openItem(id) {
  if (S.data.header.some((h) => h.id === id)) { S.ui.tab = 'profile'; applyTab(); return; }
  const target = S.data.items.find((x) => x.id === id);
  if (target && target.archived) { S.ui.tab = 'archive'; applyTab(); return; }
  S.ui.tab = 'links';
  S.ui.open.add(id);
  const it = S.data.items.find((x) => x.id === id);
  if (it && it.type !== 'header') {
    for (let i = itemIndex(id) - 1; i >= 0; i -= 1) {
      if (S.data.items[i].type === 'header') { S.ui.collapsed.delete(S.data.items[i].id); break; }
    }
  }
  S.focus = { id, field: 'title' };
  renderAll();
}

/* ---------- images ---------- */

let pickTarget = null;
const filePick = document.createElement('input');
filePick.type = 'file';
filePick.accept = 'image/*';
filePick.hidden = true;
document.body.appendChild(filePick);

function pickImage(target) {
  pickTarget = target;
  filePick.value = '';
  filePick.click();
}

async function processImage(file, { max, square }) {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  const bmp = await createImageBitmap(file);
  let sx = 0; let sy = 0; let sw = bmp.width; let sh = bmp.height;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2; sy = (sh - s) / 2; sw = s; sh = s;
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { dataUrl, base64: dataUrl.split(',')[1] };
}

const stamp = () => Date.now().toString(36);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';

filePick.addEventListener('change', async () => {
  const file = filePick.files && filePick.files[0];
  if (!file || !pickTarget) return;
  const t = pickTarget;
  try {
    if (t.kind === 'avatar') {
      const img = await processImage(file, { max: 512, square: true });
      const path = `assets/avatar-${stamp()}.jpg`;
      S.pending.set(path, img);
      mutate((d) => { d.profile.avatar = path; });
    } else {
      const it = S.data.items[itemIndex(t.id)];
      const img = await processImage(file, { max: it && it.featured ? 1200 : 640 });
      const path = `assets/thumbs/${slug(t.id)}-${stamp()}.jpg`;
      S.pending.set(path, img);
      mutate((d) => { d.items[itemIndex(t.id)].thumbnail = path; });
    }
  } catch (err) {
    toast(err.message || 'Could not read that image.', { kind: 'err' });
  }
});

/* ---------- Profile tab ---------- */

function renderProfile() {
  const p = S.data.profile;
  const avatar = p.avatar && assetUrl(p.avatar);
  const hdr = S.data.header.map((h) => `<li class="row" data-id="${esc(h.id)}" data-label="${esc(h.label || 'Icon')}">
      <button class="grip" type="button" data-grip aria-label="Drag to reorder ${esc(h.label || 'icon')}">${ico('grip-vertical')}</button>
      <div class="row-main">
        <div class="grid2">
          <label>Label<input data-hfield="label" value="${esc(h.label || '')}"></label>
          <label>Icon<select data-hfield="icon">${iconOptions(h.icon, false)}</select></label>
        </div>
        <label>URL<input data-hfield="url" inputmode="url" value="${esc(h.url || '')}"></label>
      </div>
      <div class="row-actions">
        <label class="switch" title="Show"><input type="checkbox" data-hact="enabled"${h.enabled === false ? '' : ' checked'} aria-label="Show ${esc(h.label)}"></label>
        <button class="btn icon sm quiet danger" type="button" data-hact="delete" aria-label="Delete ${esc(h.label)}">${ico('trash')}</button>
      </div>
    </li>`).join('');
  $('#panel-profile').innerHTML = `
    <h3>Avatar</h3>
    <div class="thumb-edit avatar-edit">
      ${avatar ? `<img src="${esc(avatar)}" alt="Current avatar">` : '<span class="none">No avatar</span>'}
      <button class="btn" type="button" data-pact="avatar-upload">${avatar ? 'Change avatar' : 'Add avatar'}</button>
      ${avatar ? '<button class="btn quiet" type="button" data-pact="avatar-remove">Remove</button>' : ''}
    </div>
    <h3>Profile</h3>
    <label>Name<input data-pfield="name" value="${esc(p.name)}"></label>
    <label>Bio<textarea data-pfield="bio" rows="3">${esc(p.bio)}</textarea></label>
    <h3>Search and sharing</h3>
    <label>Page title<input data-pfield="title" value="${esc(p.title)}"></label>
    <label>Description<textarea data-pfield="description" rows="2">${esc(p.description)}</textarea></label>
    <label>Site URL<input data-pfield="url" inputmode="url" value="${esc(p.url)}"></label>
    <p class="hint">Used for the canonical link and share previews. Set it to https://nomaditsu.com/ when the custom domain goes live.</p>
    <h3>Icon row under your bio</h3>
    <ul id="hdr-rows" class="rows">${hdr}</ul>
    <div class="toolbar" style="margin-top:.75rem"><button class="btn" type="button" data-hact="add">+ Add icon</button></div>`;
}

function onProfileInput(e) {
  const el = e.target;
  const textual = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox');
  if (e.type === 'change' && textual) return;
  if (el.dataset.pfield) {
    const f = el.dataset.pfield;
    mutate((d) => { d.profile[f] = el.value; }, { key: `p:${f}`, render: false });
    if (f === 'url') el.setAttribute('aria-invalid', String(Boolean(el.value) && !/^https:\/\//i.test(el.value)));
    return;
  }
  const row = el.closest('.row');
  if (!row) return;
  const id = row.dataset.id;
  const at = () => S.data.header.findIndex((h) => h.id === id);
  if (el.dataset.hact === 'enabled') {
    mutate((d) => { d.header[at()].enabled = el.checked; }, { render: false });
  } else if (el.dataset.hfield) {
    const f = el.dataset.hfield;
    mutate((d) => { d.header[at()][f] = el.value; }, { key: `h:${id}:${f}`, render: false });
    if (f === 'url') el.setAttribute('aria-invalid', String(Boolean(el.value) && !safeUrl(el.value)));
    if (f === 'label') row.dataset.label = el.value || 'Icon';
  }
}

function onProfileClick(e) {
  const b = e.target.closest('[data-pact],[data-hact]');
  if (!b) return;
  if (b.dataset.pact === 'avatar-upload') pickImage({ kind: 'avatar' });
  else if (b.dataset.pact === 'avatar-remove') mutate((d) => { d.profile.avatar = ''; });
  else if (b.dataset.hact === 'add') {
    mutate((d) => { d.header.push({ id: newId('hdr'), type: 'icon-link', icon: 'link', label: 'New icon', url: '', enabled: true }); });
  } else if (b.dataset.hact === 'delete') {
    const id = b.closest('.row').dataset.id;
    mutate((d) => { d.header = d.header.filter((h) => h.id !== id); });
    toast('Icon deleted.', { action: { label: 'Undo', fn: () => restore(S.undo, S.redo) }, ms: 8000 });
  }
}

/* ---------- Appearance tab ---------- */

const seg = (name, value, options) => `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([v, label]) => `<button type="button" data-theme-key="${esc(name)}" data-theme-val="${esc(v)}" aria-pressed="${v === value}">${esc(label)}</button>`).join('')}</div>`;

function renderTheme() {
  const t = { ...DEFAULT_THEME, ...S.data.theme };
  const swatches = Object.entries(PRESETS).map(([key, p]) => `<button type="button" class="swatch" role="radio" aria-checked="${t.preset === key}" data-theme-key="preset" data-theme-val="${key}">
      <span class="chips">
        <span style="background:${p.light.bg};color:${p.light.text}">Aa</span>
        <span style="background:${p.dark.bg};color:${p.dark.text}">Aa</span>
      </span>
      <span>${esc(p.label)}</span>
    </button>`).join('');
  const preset = PRESETS[t.preset] || PRESETS.classic;
  $('#panel-theme').innerHTML = `
    <h3>Theme</h3>
    <div class="swatches" role="radiogroup" aria-label="Theme preset">${swatches}</div>
    <div class="opt-label">Light or dark</div>
    ${seg('mode', t.mode, [['auto', 'Follow device'], ['light', 'Always light'], ['dark', 'Always dark']])}
    <div class="opt-label">Accent color</div>
    <div class="field-row">
      <input type="color" id="accent" value="${/^#[0-9a-f]{6}$/i.test(t.accent) ? t.accent : preset.accent}" aria-label="Accent color">
      <button class="btn quiet" type="button" data-theme-key="accent" data-theme-val="">Use theme's accent</button>
    </div>
    <div class="opt-label">Button shape</div>
    ${seg('buttonShape', t.buttonShape, Object.keys(SHAPES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]))}
    <div class="opt-label">Button style</div>
    ${seg('buttonStyle', t.buttonStyle, [['filled', 'Filled'], ['outline', 'Outline'], ['soft', 'Tinted']])}
    <div class="opt-label">Background</div>
    ${seg('background', t.background, [['solid', 'Solid'], ['gradient', 'Gradient']])}
    <div class="opt-label">Font</div>
    ${seg('font', t.font, Object.keys(FONT_STACKS).map((k) => [k, { sans: 'Sans', serif: 'Serif', mono: 'Mono' }[k]]))}`;
}

function onThemeClick(e) {
  const b = e.target.closest('[data-theme-key]');
  if (!b) return;
  mutate((d) => { d.theme[b.dataset.themeKey] = b.dataset.themeVal; });
}

/* ---------- Archive tab ---------- */

function renderArchive() {
  const items = S.data.items;
  let section = 'Top of page';
  const rows = [];
  items.forEach((it) => {
    if (it.type === 'header') section = it.title || 'Untitled section';
    if (!it.archived) return;
    const label = it.type === 'icon-link' ? it.label : it.title;
    rows.push(`<li class="row${it.type === 'header' ? ' section' : ''}" data-id="${esc(it.id)}">
      <span></span>
      <div class="row-main"><span class="row-title" style="cursor:default">${esc(label || 'Untitled')}</span>
        <span class="row-url">${it.type === 'header' ? 'Section' : `in ${esc(section)}`}</span></div>
      <div class="row-actions">
        <button class="btn" type="button" data-aact="restore">Restore</button>
        <button class="btn danger" type="button" data-aact="delete">Delete forever</button>
      </div></li>`);
  });
  $('#panel-archive').innerHTML = rows.length
    ? `<p class="hint">Archived items are hidden from your page and keep their place. Restore puts them back where they were.</p><ul class="rows">${rows.join('')}</ul>`
    : '<p class="hint">Nothing archived. Use the archive button on a link or section to tuck it away without deleting it.</p>';
}

function onArchiveClick(e) {
  const b = e.target.closest('[data-aact]');
  if (!b) return;
  const id = b.closest('.row').dataset.id;
  if (b.dataset.aact === 'restore') {
    mutate((d) => {
      const i = d.items.findIndex((x) => x.id === id);
      if (i < 0) return;
      delete d.items[i].archived;
      // restoring a link whose section is archived would leave it invisible: restore the section too
      if (d.items[i].type !== 'header') {
        for (let k = i - 1; k >= 0; k -= 1) {
          if (d.items[k].type === 'header') { delete d.items[k].archived; break; }
        }
      }
    });
  } else {
    mutate((d) => { d.items = d.items.filter((x) => x.id !== id); });
    toast('Deleted.', { action: { label: 'Undo', fn: () => restore(S.undo, S.redo) }, ms: 8000 });
  }
}

/* ---------- tabs, preview, render ---------- */

function renderAll() {
  if (!S.data) return;
  renderItems();
  renderProfile();
  renderTheme();
  renderArchive();
  applyTab();
  updateChrome();
  restoreFocus();
}

function restoreFocus() {
  const f = S.focus;
  S.focus = null;
  if (!f) return;
  let target = null;
  const row = $(`#items .row[data-id="${CSS.escape(f.id)}"]`);
  if (row) {
    if (f.field) target = $(`[data-field="${f.field}"]`, row);
    else if (f.act) target = $(`[data-act="${f.act}"]`, row);
  }
  if (target) { target.focus({ preventScroll: false }); target.scrollIntoView({ block: 'nearest' }); }
}

function applyTab() {
  const wide = matchMedia('(min-width:1000px)').matches;
  if (wide && S.ui.tab === 'preview') S.ui.tab = 'links';
  for (const t of $$('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === S.ui.tab));
  for (const p of $$('.panel')) p.hidden = p.id !== `panel-${S.ui.tab}`;
  placePreview();
}

function placePreview() {
  const phone = $('.phone');
  const wide = matchMedia('(min-width:1000px)').matches;
  const host = wide ? $('#preview-aside') : $('#panel-preview .preview-slot');
  if (phone.parentElement !== host) { host.appendChild(phone); renderPreview(); }
}

function renderPreview() {
  if (!S.data) return;
  const data = JSON.parse(ser());
  if (S.ui.previewMode) data.theme.mode = S.ui.previewMode;
  const assetMap = {};
  for (const [p, v] of S.pending) assetMap[p] = v.dataUrl;
  $('#preview').srcdoc = renderPage(data, { base: '../', preview: true, assetMap });
}

/* ---------- save ---------- */

function ghClient() {
  const s = readSettings();
  return new GitHub({ owner: s.owner, repo: s.repo, branch: s.branch, token: S.ui.token });
}

function askConflict() {
  const dlg = $('#dlg-conflict');
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue || 'cancel'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

async function reloadFromRemote() {
  const file = await ghClient().getFile('links.json');
  if (!file) throw new GhError('notfound', 'links.json was not found on the branch.');
  adoptData(JSON.parse(file.text), file.sha);
}

function adoptData(raw, sha) {
  S.data = normalize(raw);
  S.saved = ser();
  S.savedRefs = refs(S.data);
  S.loadedSha = sha || null;
  S.undo = [];
  S.redo = [];
  S.pending.clear();
  S.ui.errors = [];
  renderAll();
  renderPreview();
}

async function save({ overwrite = false } = {}) {
  if (S.ui.saving || !S.data) return;
  S.ui.errors = validate(S.data);
  const blocking = S.ui.errors.filter((e) => e.level === 'error');
  renderErrors();
  renderItems();
  if (blocking.length) {
    S.ui.tab = 'links';
    applyTab();
    toast(`Fix ${blocking.length} problem${blocking.length > 1 ? 's' : ''} before saving.`, { kind: 'err' });
    return;
  }
  if (S.ui.demo) { toast('Demo mode: sign in to save.'); return; }
  if (!S.ui.token) { openSettings('Add your GitHub token to save.'); return; }
  if (S.ui.readOnly) {
    toast('This is a read-only copy because GitHub could not be reached. Reload to try again.', { kind: 'err' });
    return;
  }

  S.ui.saving = true;
  $('#btn-save').disabled = true;
  setStatus('busy', 'Saving…');
  try {
    const gh = ghClient();
    if (!overwrite) {
      // Always re-read the latest links.json sha right before committing.
      const remote = await gh.getFile('links.json');
      if (remote && remote.sha !== S.loadedSha) {
        S.ui.saving = false;
        const choice = await askConflict();
        if (choice === 'reload') { await reloadFromRemote(); toast('Reloaded the latest version from GitHub.'); return; }
        if (choice !== 'overwrite') { updateChrome(); return; }
        S.ui.saving = true;
      }
    }
    const snapshot = ser(); // what is committed; edits made while the save runs stay "unsaved"
    const data = JSON.parse(snapshot);
    const now = refs(data);
    const files = [
      { path: 'links.json', text: `${JSON.stringify(data, null, 2)}\n` },
      { path: 'index.html', text: renderPage(data) },
      { path: '404.html', text: renderNotFound(data) },
    ];
    const uploaded = [];
    for (const path of now) {
      const img = S.pending.get(path);
      if (img) { files.push({ path, base64: img.base64 }); uploaded.push(path); }
    }
    // Never delete a file an undo/redo step could bring back.
    const history = S.undo.concat(S.redo).join('\n');
    const deletes = [...S.savedRefs].filter((p) => !now.has(p) && safeAsset(p) && !history.includes(JSON.stringify(p)));
    let result;
    let removed = deletes;
    try {
      result = await gh.commit({ files, deletes, message: 'Update links' });
    } catch (e) {
      if (e.kind === 'validation' && deletes.length) {
        removed = [];
        result = await gh.commit({ files, deletes: [], message: 'Update links' });
      } else throw e;
    }
    S.loadedSha = result.shas['links.json'];
    S.saved = snapshot;
    // Files we chose not to delete yet (undo could restore them) stay tracked so a later save cleans them up.
    S.savedRefs = new Set([...now, ...[...S.savedRefs].filter((p) => !now.has(p) && !removed.includes(p))]);
    uploaded.forEach((p) => S.pending.delete(p));
    S.ui.saving = false;
    updateChrome();
    toast('Saved. Live in ~1 min.', { ms: 7000, action: { label: 'View site', fn: () => window.open(data.profile.url || '../', '_blank', 'noopener') } });
  } catch (e) {
    S.ui.saving = false;
    const msg = e instanceof GhError ? e.message : `Unexpected error: ${e.message || e}`;
    setStatus('err', 'Not saved');
    toast(msg, { kind: 'err', ms: 10000 });
    if (e instanceof GhError && e.kind === 'auth') openSettings(msg);
    if (e instanceof GhError && e.kind === 'conflict') {
      const choice = await askConflict();
      if (choice === 'reload') await reloadFromRemote().catch((err) => toast(err.message, { kind: 'err' }));
      else if (choice === 'overwrite') { await save({ overwrite: true }); return; }
    }
    updateChrome();
  }
}

/* ---------- settings dialog ---------- */

function openSettings(message = '', { signin = false } = {}) {
  const s = readSettings();
  const dlg = $('#dlg-settings');
  dlg.classList.toggle('signin', signin);
  $('#settings-title').textContent = signin ? 'Sign in' : 'GitHub connection';
  $('#set-token-label').textContent = signin ? 'Password' : 'Token';
  $('#set-encrypt-text').textContent = signin ? 'Lock with a passphrase (asked on each visit)' : 'Encrypt the token with a passphrase (asked once per browser session)';
  $('#set-save').textContent = signin ? 'Sign in' : 'Save settings';
  $('#set-cancel').textContent = signin ? 'Cancel' : 'Close';
  $('#set-owner').value = s.owner;
  $('#set-repo').value = s.repo;
  $('#set-branch').value = s.branch;
  $('#set-token').value = '';
  $('#set-token').placeholder = signin ? '' : s.token || s.tokenEnc ? 'Token saved. Paste a new one to replace it.' : 'github_pat_…';
  $('#set-encrypt').checked = Boolean(s.tokenEnc);
  $('#set-pass-wrap').hidden = !$('#set-encrypt').checked;
  $('#set-pass').value = '';
  setSettingsMsg(message, message ? 'err' : '');
  if (!dlg.open) dlg.showModal();
}

function setSettingsMsg(text, kind = '') {
  const el = $('#settings-msg');
  el.textContent = text;
  el.className = `msg ${kind}`;
}

async function testConnection() {
  const s = { owner: $('#set-owner').value.trim(), repo: $('#set-repo').value.trim(), branch: $('#set-branch').value.trim() || 'main' };
  const token = $('#set-token').value.trim() || S.ui.token;
  if (!token) { setSettingsMsg('Paste a token first.', 'err'); return; }
  setSettingsMsg('Testing…');
  const gh = new GitHub({ ...s, token });
  try {
    await gh.getRepo();
    const file = await gh.getFile('links.json');
    await gh.probeWrite();
    setSettingsMsg(`Connected to ${s.owner}/${s.repo}@${s.branch}. Write access confirmed${file ? '' : ' (links.json does not exist yet, it will be created on first save)'}.`, 'ok');
  } catch (e) {
    setSettingsMsg(e.message || String(e), 'err');
  }
}

async function saveSettings(ev) {
  ev.preventDefault();
  const old = readSettings();
  const token = $('#set-token').value.trim();
  const encrypt = $('#set-encrypt').checked;
  const pass = $('#set-pass').value;
  const signingIn = S.ui.demo;
  if (signingIn && !token) { setSettingsMsg('Enter your password.', 'err'); return; }
  if (encrypt && token && !pass) { setSettingsMsg(signingIn ? 'Enter a passphrase to lock it.' : 'Enter a passphrase to encrypt the token.', 'err'); return; }
  if (token && !/^(github_pat_|ghp_)/.test(token)) {
    setSettingsMsg(signingIn ? 'That password did not work.' : 'That does not look like a GitHub token (expected github_pat_…).', 'err');
    return;
  }
  const base = { owner: $('#set-owner').value, repo: $('#set-repo').value, branch: $('#set-branch').value };
  if (!base.owner.trim() || !base.repo.trim()) { setSettingsMsg('Owner and repository are required.', 'err'); return; }
  if (signingIn) {
    // Verify before storing or showing anything. This is the only GitHub request a sign-in makes.
    setSettingsMsg('Checking…');
    try {
      await new GitHub({ owner: base.owner.trim(), repo: base.repo.trim(), branch: (base.branch || 'main').trim(), token }).getRepo();
    } catch {
      setSettingsMsg('That password did not work.', 'err');
      return;
    }
  }
  try {
    if (token) {
      await writeSettings({ ...base, token, passphrase: encrypt ? pass : '' });
      S.ui.token = token;
    } else if (encrypt && pass && old.token) {
      // Token was saved in plain text earlier: re-store it encrypted and drop the plaintext.
      await writeSettings({ ...base, token: old.token, passphrase: pass });
      S.ui.token = old.token;
    } else {
      localStorage.setItem('linkparty.settings.v1', JSON.stringify({ ...old, owner: base.owner.trim(), repo: base.repo.trim(), branch: (base.branch || 'main').trim() }));
    }
  } catch {
    setSettingsMsg('Could not store settings (browser storage is blocked).', 'err');
    return;
  }
  if (S.ui.demo && S.ui.token) setDemo(false);
  $('#dlg-settings').close();
  await loadFromBestSource();
}

/* ---------- boot ---------- */


async function fetchLocal() {
  const res = await fetch('../links.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`links.json: HTTP ${res.status}`);
  return res.json();
}

async function loadFromBestSource() {
  if (S.ui.token) {
    try {
      const file = await ghClient().getFile('links.json');
      if (file) {
        S.ui.readOnly = false;
        banner('');
        adoptData(JSON.parse(file.text), file.sha);
        return;
      }
      banner('links.json was not found in the repository, so the local copy is shown. Saving will create it.', { kind: 'err' });
      S.ui.readOnly = false;
      adoptData(await fetchLocal(), null);
      return;
    } catch (e) {
      banner(`Could not load from GitHub: ${e.message} Showing the published copy, read only.`, {
        kind: 'err', actions: [{ label: 'Settings', fn: () => openSettings() }],
      });
    }
  } else {
    banner('Demo mode: edit anything, nothing is saved or sent anywhere. Reload to reset.');
  }
  S.ui.readOnly = true;
  try {
    adoptData(await fetchLocal(), null);
  } catch (e) {
    banner(`Could not load links.json: ${e.message}`, { kind: 'err' });
  }
}

// Each prompt resolves with the token, or '' when the viewer cancels (they stay in demo mode).
function askPassphrase(settings) {
  const dlg = $('#dlg-unlock');
  const input = $('#unlock-pass');
  const msg = $('#unlock-msg');
  return new Promise((resolve) => {
    msg.textContent = '';
    input.value = '';
    const form = $('#unlock-form');
    const cancel = $('#unlock-cancel');
    let done = false;
    const finish = (token) => {
      if (done) return;
      done = true;
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      if (dlg.open) dlg.close();
      resolve(token);
    };
    const onCancel = () => finish('');
    const onSubmit = async (e) => {
      e.preventDefault();
      try { finish(await unlock(settings, input.value)); } catch (err) { msg.textContent = err.message; }
    };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onCancel, { once: true });
    dlg.showModal();
    input.focus();
  });
}

// Demo mode (no token): the editor on the published links.json, no GitHub request, nothing persisted.
// Settings (and the full GitHub dialog) only appear after signing in.
function setDemo(demo) {
  S.ui.demo = demo;
  $('#btn-save').hidden = demo;
  $('#btn-settings').hidden = demo;
  $('#tab-archive').hidden = demo;
  const auth = $('#btn-auth');
  auth.textContent = demo ? 'Sign in' : 'Sign out';
  auth.className = demo ? 'btn primary' : 'btn primary signout';
  if (demo && S.ui.tab === 'archive') { S.ui.tab = 'links'; applyTab(); }
}

async function signIn() {
  const s = readSettings();
  if (!s.tokenEnc) { openSettings('', { signin: true }); return; }
  const token = await askPassphrase(s);
  if (!token) return;
  S.ui.token = token;
  setDemo(false);
  await loadFromBestSource();
}

function signOut() {
  if (isDirty() && !window.confirm('Sign out and discard unsaved changes?')) return;
  clearToken(); // the saved token (plain or encrypted) is removed from this browser
  location.reload();
}

async function boot() {
  const s = readSettings();
  if (s.tokenEnc) S.ui.token = await askPassphrase(s);
  else S.ui.token = s.token || '';
  setDemo(!S.ui.token);
  await loadFromBestSource();
}

/* ---------- wiring ---------- */

$('#items').addEventListener('click', onItemsClick);
$('#items').addEventListener('input', onItemsInput);
$('#items').addEventListener('change', onItemsInput);
$('#panel-links').addEventListener('click', (e) => { if (e.target.closest('[data-goto]')) onItemsClick(e); });
$('#panel-profile').addEventListener('click', onProfileClick);
$('#panel-profile').addEventListener('input', onProfileInput);
$('#panel-profile').addEventListener('change', onProfileInput);
$('#panel-theme').addEventListener('click', onThemeClick);
$('#panel-theme').addEventListener('input', (e) => {
  if (e.target.id === 'accent') mutate((d) => { d.theme.accent = e.target.value; }, { key: 'accent', render: false });
});
$('#panel-archive').addEventListener('click', onArchiveClick);

makeSortable($('#items'), {
  isSection: (row) => row.dataset.type === 'header',
  onDrop: (id, beforeId) => { S.focus = { id, act: 'edit' }; moveBlock(id, beforeId); },
});
makeSortable($('#panel-profile'), {
  rowSelector: '#hdr-rows .row',
  onDrop: (id, beforeId) => {
    mutate((d) => {
      const i = d.header.findIndex((h) => h.id === id);
      const [x] = d.header.splice(i, 1);
      const j = beforeId ? d.header.findIndex((h) => h.id === beforeId) : d.header.length;
      d.header.splice(j < 0 ? d.header.length : j, 0, x);
    });
  },
});

$('#add-link').addEventListener('click', () => {
  if (!S.data) return;
  const sections = S.data.items.filter((i) => i.type === 'header' && !i.archived);
  addItem({ id: newId('lnk'), type: 'link', title: '', url: '', enabled: true }, sections.length ? sections[sections.length - 1].id : 'top');
});
$('#add-section').addEventListener('click', () => {
  if (S.data) addItem({ id: newId('sec'), type: 'header', title: '', enabled: true }, undefined);
});
$('#toggle-all').addEventListener('click', () => {
  const headers = S.data.items.filter((i) => i.type === 'header' && !i.archived).map((i) => i.id);
  if (S.ui.collapsed.size) S.ui.collapsed.clear(); else headers.forEach((h) => S.ui.collapsed.add(h));
  renderAll();
});

for (const t of $$('.tab')) {
  t.addEventListener('click', () => { S.ui.tab = t.dataset.tab; applyTab(); });
}
matchMedia('(min-width:1000px)').addEventListener('change', applyTab);

$('#btn-save').addEventListener('click', () => save());
$('#btn-undo').addEventListener('click', () => restore(S.undo, S.redo));
$('#btn-redo').addEventListener('click', () => restore(S.redo, S.undo));
$('#btn-settings').innerHTML = ico('settings');
$('#btn-settings').addEventListener('click', () => openSettings());
$('#btn-auth').addEventListener('click', () => (S.ui.demo ? signIn() : signOut()));
$('#preview-mode').addEventListener('change', (e) => { S.ui.previewMode = e.target.value; renderPreview(); });

$('#set-encrypt').addEventListener('change', (e) => { $('#set-pass-wrap').hidden = !e.target.checked; });
$('#set-cancel').addEventListener('click', () => $('#dlg-settings').close());
$('#set-test').addEventListener('click', testConnection);
$('#settings-form').addEventListener('submit', saveSettings);
$('#set-clear').addEventListener('click', () => {
  clearToken();
  S.ui.token = '';
  S.ui.readOnly = true;
  $('#set-token').value = '';
  $('#set-encrypt').checked = false;
  setSettingsMsg('Token removed from this browser.', 'ok');
  updateChrome();
  location.reload();
});
$('#set-export').addEventListener('click', () => {
  if (!S.data) return;
  const blob = new Blob([`${JSON.stringify(S.data, null, 2)}\n`], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'links.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#set-import').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const next = normalize(JSON.parse(await file.text()));
    const problems = validate(next).filter((p) => p.level === 'error');
    if (problems.length && !confirm(`${problems.length} validation problem(s) in that file. Import anyway?`)) return;
    mutate((d) => { Object.assign(d, next); });
    $('#dlg-settings').close();
    toast('Imported. Review the changes, then Save.');
  } catch {
    setSettingsMsg('That file is not valid JSON.', 'err');
  }
});

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  else if (e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) restore(S.redo, S.undo); else restore(S.undo, S.redo);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('online', () => updateChrome());

boot();
