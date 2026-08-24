// Shared rendering helpers. Deliberately tiny and framework-free: the whole
// app is served as static files with no build step, so anything imported here
// has to be plain ES modules the browser can run as-is.

export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─── Dates ───────────────────────────────────────────────────────────────
// Everything date-shaped uses the phone's own clock. "Today" has to mean
// today where the phone is, not wherever Postgres thinks it is.

export const ymd = (d = new Date()) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const addDays = (d, n) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

export const today = () => ymd(new Date());

// Short human date: "today", "tomorrow", "Mon 3 Mar". Used in list metadata
// where a bare ISO string reads as noise.
export function niceDate(value) {
  if (!value) return '';
  const iso = String(value).slice(0, 10);
  const t = today();
  if (iso === t) return 'today';
  if (iso === ymd(addDays(new Date(), 1))) return 'tomorrow';
  if (iso === ymd(addDays(new Date(), -1))) return 'yesterday';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

// Timestamps come back as ISO with a zone; show them in local time.
export function niceStamp(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${niceDate(ymd(d))} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// <input type="datetime-local"> wants local time with no zone, and rejects the
// ISO string Postgres hands back. These two convert both ways.
export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

// ─── Elements ────────────────────────────────────────────────────────────

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Inline SVG, since there is no icon font and no build step to inline assets.
export function svg(paths, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.5');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
}

export const panel = (...children) => el('div', { class: 'panel' }, ...children);

export const hint = (text) => el('div', { class: 'hint' }, text);

// ─── Editorial header ────────────────────────────────────────────────────
// Mono eyebrow over a Newsreader display title. Every screen uses this; it is
// the single strongest signal that the phone and the dashboard are one app.

export function screenHead(eyebrow, title, opts = {}) {
  const { meta, actions } = opts;
  const left = el('div', {},
    el('div', { class: 'eyebrow' }, eyebrow),
    el('h1', {}, title),
    meta ? el('div', { class: 'meta' }, meta) : null,
  );
  return el('header', { class: 'screen-head' },
    actions?.length
      ? el('div', { class: 'row-actions' }, left, ...actions)
      : left,
  );
}

// Eyebrow rule between blocks within a screen.
export function sectionLabel(text, ...actions) {
  return el('div', { class: 'section-label' },
    el('div', { class: 'eyebrow' }, text), ...actions);
}

// ─── Pills ───────────────────────────────────────────────────────────────
// The one place the palette leaves monochrome. `state` is one of
// over / due / ok / quiet / solid / plain.

export function pill(state, label, dot = true) {
  return el('span', { class: `pill ${state}` },
    dot && ['over', 'due', 'ok', 'quiet'].includes(state)
      ? el('span', { class: 'dot' }) : null,
    label);
}

// Maps a due date to the design's four urgency states.
export function urgencyOf(dueDate, status) {
  if (status === 'done') return null;
  if (!dueDate) return null;
  const iso = String(dueDate).slice(0, 10);
  const t = today();
  if (iso < t) return 'over';
  if (iso === t) return 'due';
  return 'ok';
}

// ─── Checkbox ────────────────────────────────────────────────────────────
// 20px, square, hairline border — matches the dashboard's TaskItem exactly.

export function tickBox({ done = false, waiting = false, label, onClick }) {
  const b = el('button', {
    class: `tick ${done ? 'on' : ''} ${waiting ? 'waiting' : ''}`,
    type: 'button',
    'aria-label': label,
    onclick: onClick,
  });
  b.append(svg('<path d="M4 12l5 5 11-11"/>', 12));
  return b;
}

// ─── Chips ───────────────────────────────────────────────────────────────

export function chips(options, selected, onPick) {
  const wrap = el('div', { class: 'chips' });
  for (const opt of options) {
    wrap.append(
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(opt.value === selected),
        onclick: () => onPick(opt.value),
      }, opt.label),
    );
  }
  return wrap;
}

// ─── Feedback ────────────────────────────────────────────────────────────

let toastTimer;
export function toast(text, kind = 'ok') {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'err' ? 5000 : 2200);
}

export const fail = (e) => toast(e?.message || String(e), 'err');

// Destructive actions get a confirm. Deleting is the one thing in here that
// can't be undone — there's no trash table.
export const confirmDelete = (what) =>
  window.confirm(`Delete ${what}? This can't be undone.`);

export function spinner(text = 'Loading…') {
  return el('div', { class: 'hint' }, text);
}

// ─── Misc ────────────────────────────────────────────────────────────────

// Turn a snake_case enum value into something readable: 'want_to_read' →
// 'Want to read'. Every status/type column in this database is snake_case.
export function humanise(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Theme ───────────────────────────────────────────────────────────────
// Dark by default — unlike the dashboard — because the phone gets used
// outdoors and before dawn. The choice is remembered per device.

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(next) {
  if (next === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('ops-theme', next); } catch { /* private mode */ }
  // Keep the Android status bar in step with the canvas.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f6f2ea' : '#131211');
}
