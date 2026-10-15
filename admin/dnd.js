// Pointer-event drag to reorder. Works with mouse, pen and touch (the grip uses touch-action:none).
// Rows are <li class="row" data-id>. A "section" row drags together with the rows that follow
// it up to the next section row, and may only be dropped between sections.

export function makeSortable(container, { rowSelector = '.row', gripSelector = '[data-grip]', isSection = () => false, label = (row) => row.dataset.label || '', onDrop }) {
  container.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest(gripSelector);
    if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = grip.closest(rowSelector);
    if (!row || !container.contains(row)) return;
    e.preventDefault();
    begin(row, grip, e);
  });

  function begin(row, grip, startEvent) {
    const rows = [...container.querySelectorAll(rowSelector)];
    const at = rows.indexOf(row);
    const section = isSection(row);
    const block = [row];
    if (section) {
      for (let i = at + 1; i < rows.length && !isSection(rows[i]); i += 1) block.push(rows[i]);
    }
    const candidates = rows.filter((r) => !block.includes(r) && (!section || isSection(r)));
    const lastRow = rows[rows.length - 1];
    const rect = container.getBoundingClientRect();

    const line = document.createElement('li');
    line.className = 'drop-line';
    line.setAttribute('aria-hidden', 'true');

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = label(row) + (block.length > 1 ? `  (+${block.length - 1})` : '');
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    document.body.appendChild(ghost);

    block.forEach((r) => r.classList.add('dragging'));
    document.body.classList.add('is-dragging');
    try { grip.setPointerCapture(startEvent.pointerId); } catch { /* not capturable */ }

    let before = null;
    let y = startEvent.clientY;
    let raf = 0;

    const place = () => {
      ghost.style.top = `${y - 22}px`;
      before = null;
      for (const c of candidates) {
        const r = c.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = c; break; }
      }
      if (before) before.before(line);
      else lastRow.after(line);
    };

    const tick = () => {
      const edge = 70;
      const vh = window.innerHeight;
      if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 6));
      else if (y > vh - edge) window.scrollBy(0, Math.ceil((y - (vh - edge)) / 6));
      place();
      raf = requestAnimationFrame(tick);
    };

    const move = (e) => { y = e.clientY; };
    const finish = (commit) => {
      cancelAnimationFrame(raf);
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      try { grip.releasePointerCapture(startEvent.pointerId); } catch { /* already released */ }
      line.remove();
      ghost.remove();
      block.forEach((r) => r.classList.remove('dragging'));
      document.body.classList.remove('is-dragging');
      if (!commit) return;
      const nextAfterBlock = rows[at + block.length] || null;
      if (before === nextAfterBlock) return; // dropped where it already was
      onDrop(row.dataset.id, before ? before.dataset.id : null);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (e) => { if (e.key === 'Escape') finish(false); };

    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    tick();
  }
}
