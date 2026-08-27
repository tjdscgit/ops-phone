// Shared detail-page shell — a port of components/detail/DetailShell.tsx +
// EditDrawer.tsx. The anatomy every operational detail page (Content ·
// Company · Person) inherits: header band → stat strip → two-column read
// layout, with configuration behind an Edit action.
//
// EditDrawer is adapted, not copied line-for-line: the dashboard's is a
// fixed 440px right-side slide-over, which doesn't fit a phone width. This
// reuses the app's existing bottom sheet (app.js's openSheet/closeSheet —
// the same mobile-drawer pattern Work's Filters and the More menu already
// use) at every width, rather than building a second drawer primitive.

import { el } from './ui.js';
import { openSheet, closeSheet } from '../app.js';

export function detailHeader({ crumb, name, color, state, actions, below, titleClass }) {
  return el('div', { class: 'detail-header' },
    el('div', { class: 'detail-crumb' }, ...crumb),
    el('div', { class: 'detail-title-row' },
      el('h1', { class: `detail-title ${titleClass || ''}` },
        color ? el('span', { class: 'detail-title-dot', style: `background:${color}` }) : null,
        el('span', {}, name),
        state,
      ),
      actions ? el('div', { class: 'detail-actions' }, ...actions) : null,
    ),
    below ? el('div', { class: 'detail-below' }, below) : null,
  );
}

export function crumbDot() {
  return el('span', { class: 'dim' }, '·');
}

const BTN_CLASS = { ghost: 'detail-btn ghost', solid: 'detail-btn solid', accent: 'detail-btn accent' };

export function actionButton({ href, onClick, variant = 'ghost' }, ...children) {
  return el('button', {
    class: BTN_CLASS[variant], type: 'button',
    onclick: onClick || (() => { if (href) location.hash = href; }),
  }, ...children);
}

export function statStrip(...stats) {
  return el('div', { class: 'stat-strip' }, ...stats);
}

export function stat({ label, value, unit, sub, tone, badge, body }) {
  return el('div', { class: `stat-tile ${tone ? `tone-${tone}` : ''}` },
    el('div', { class: 'stat-label' }, label, badge ?? null),
    body ?? el('div', { class: 'stat-value' },
      el('span', {}, value ?? '—'),
      unit ? el('span', { class: 'stat-unit' }, unit) : null,
    ),
    sub ? el('div', { class: 'stat-sub' }, sub) : null,
  );
}

export function workCounts({ open, overdue, waiting }) {
  const count = (n, label, accent) => el('span', { class: 'stat-count' },
    el('b', { class: accent ? 'over' : (n === 0 ? 'dim' : '') }, String(n)),
    el('span', { class: 'stat-count-label' }, label),
  );
  return el('div', { style: 'display:flex; align-items:baseline; gap:10px' },
    count(open, 'open'), count(overdue, 'overdue', overdue > 0), count(waiting, 'waiting', waiting > 0),
  );
}

export function detailBody(main, rail) {
  return el('div', { class: 'detail-body' },
    el('div', { class: 'detail-main' }, ...main),
    el('div', { class: 'detail-rail' }, ...rail),
  );
}

export function detailSection({ label, count, action }, ...children) {
  return el('section', { class: 'detail-section' },
    el('div', { class: 'detail-section-head' },
      el('div', { style: 'display:flex; align-items:baseline; gap:10px' },
        el('span', { class: 'eyebrow' }, label),
        count != null ? el('span', { class: 'dim mono-10' }, String(count)) : null,
      ),
      action ?? null,
    ),
    ...children,
  );
}

export function railBlock(label, ...children) {
  return el('div', { class: 'rail-block' },
    el('div', { class: 'rail-block-label' }, label),
    ...children,
  );
}

export function kv(k, v, tone) {
  return el('div', { class: 'kv-row' },
    el('span', { class: 'kv-key' }, k),
    el('span', { class: `kv-val ${tone ? 'over' : ''}` }, v),
  );
}

// The Edit action opens the app's shared bottom sheet with the form inside.
export function editDrawer(title, formNode) {
  return actionButton({
    variant: 'solid',
    onClick: () => openSheet(el('div', { class: 'edit-drawer' },
      el('div', { class: 'sheet-head' },
        el('div', { class: 'eyebrow' }, title),
      ),
      el('div', { style: 'padding:16px 20px 24px' }, formNode),
    ), { dialog: true }),
  }, 'Edit');
}

export { closeSheet };
