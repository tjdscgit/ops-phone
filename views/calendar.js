// Calendar — day / week / 2 weeks / month, with dragging.
//
// One screen over two data sources: `calendar_events` (real appointments) and
// `tasks` (which carry due_date + due_time, so a dated task is already a thing
// with a place on a grid). Both are normalised to one item shape in
// lib/calendar.js; everything below is layout, pointer handling and writes.
//
// Two decisions worth knowing before reading:
//
// 1. The calendar never moves a row it doesn't own. Planner-mirrored tasks and
//    Google-synced events are written by a sync that would overwrite a local
//    drag on its next pass, so they render and open but don't drag, and the
//    chip says why. See taskLock/eventLock in lib/calendar.js.
//
// 2. Dragging is pointer events, not HTML5 drag-and-drop. HTML5 DnD does not
//    fire on touch at all, and this app is a phone app first. Mouse drags start
//    after 4px of movement; touch drags start after a 320ms hold, so a scroll
//    that begins on top of a chip is still a scroll.

import { sb, refName } from '../lib/db.js';
import {
  el, hint, spinner, toast, fail, confirmDelete,
  ymd, addDays, today, niceDate,
} from '../lib/ui.js';
import { go, currentPath } from '../lib/router.js';
import { openSheet, closeSheet } from '../app.js';
import {
  VIEWS, VIEW_ORDER, DAY_MS, HOUR_MS, MIN_MS, SNAP_MIN,
  DEFAULT_TASK_MIN, MIN_ITEM_MIN,
  startOfWeek, addDaysTo, rangeFor, stepAnchor, rangeTitle,
  snapMinutes, timeLabel, detectColumns,
  taskItem, eventItem, timedForDay, layoutOverlaps,
  timedPatch, dayPatch, inversePatch, tableFor,
} from '../lib/calendar.js';

// Pixels per hour on the time grid. Deliberately generous — a 30-minute chip
// has to be a comfortable thumb target, not a hairline.
const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;

const VIEW_PREF_KEY = 'ops-cal-view';

// ─── Screen state ────────────────────────────────────────────────────────
// The hash is the source of truth (#/calendar/week/2026-08-27) so Back walks
// the weeks you actually looked at, and a link to a date is shareable.

let lastMove = null;      // { table, id, patch, undo, label } — for `z`
let liveKeyHandler = null;

export async function calendarView(mount, params = {}) {
  const viewKey = VIEWS[params.view] ? params.view : loadViewPref();
  const anchor = parseDate(params.date) || new Date();
  saveViewPref(viewKey);

  const { start, days } = rangeFor(viewKey, anchor);
  const end = addDaysTo(start, days);

  mount.replaceChildren(spinner('Loading calendar…'));

  let data;
  try {
    data = await loadRange(start, end);
  } catch (err) {
    mount.replaceChildren(hint(err?.message || String(err)));
    return;
  }

  const refresh = () => calendarView(mount, params);

  const built = VIEWS[viewKey].grid === 'time'
    ? timeGrid(start, days, data, refresh)
    : dayGrid(start, days, anchor, data, viewKey, refresh);

  const root = el('div', { class: `cal cal-${viewKey}` },
    header(viewKey, anchor, data, refresh),
    built.node,
  );

  mount.replaceChildren(root);
  // After mounting, not before: the dragger delegates from the root and
  // hit-tests against real element rects, and the initial scroll needs a
  // laid-out scroller — none of which exists while the tree is detached.
  installDragger(root, { ...built.ctx, refresh });
  built.afterMount?.();
  bindKeys(viewKey, anchor, refresh);
}

function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function loadViewPref() {
  try { return VIEWS[localStorage.getItem(VIEW_PREF_KEY)] ? localStorage.getItem(VIEW_PREF_KEY) : 'week'; }
  catch { return 'week'; }
}
function saveViewPref(v) {
  try { localStorage.setItem(VIEW_PREF_KEY, v); } catch { /* private mode */ }
}

const hashFor = (viewKey, date) => `#/calendar/${viewKey}/${ymd(date)}`;

// ─── Data ────────────────────────────────────────────────────────────────

async function loadRange(start, end) {
  const fromYmd = ymd(start);
  const toYmd = ymd(addDaysTo(end, -1));

  // `select('*')` rather than a column list: migration 0046 (the planner-sync
  // columns) and duration_minutes are not applied everywhere yet, and naming a
  // column PostgREST doesn't have fails the whole query. detectColumns() reads
  // what actually came back and switches the dependent features on or off.
  const [events, tasks, unscheduled] = await Promise.all([
    sb.from('calendar_events').select('*')
      .lt('start_at', end.toISOString())
      .gt('end_at', start.toISOString())
      .order('start_at'),
    sb.from('tasks').select('*')
      .gte('due_date', fromYmd).lte('due_date', toYmd)
      .order('due_date'),
    sb.from('tasks').select('*')
      .is('due_date', null).in('status', ['open', 'waiting'])
      .order('priority').order('created_at', { ascending: false })
      .limit(60),
  ]);

  for (const r of [events, tasks, unscheduled]) if (r.error) throw r.error;

  detectColumns(tasks.data.length ? tasks.data : unscheduled.data);

  const items = [
    ...events.data.map(eventItem),
    ...tasks.data.filter((t) => t.status !== 'done').map(taskItem),
  ];

  return { items, unscheduled: unscheduled.data.map(taskItem) };
}

// ─── Header ──────────────────────────────────────────────────────────────

function header(viewKey, anchor, data, refresh) {
  const nav = (dir, label, glyph) => el('button', {
    class: 'cal-nav', type: 'button', 'aria-label': label,
    onclick: () => go(hashFor(viewKey, stepAnchor(viewKey, anchor, dir))),
  }, glyph);

  const counts = data.items.reduce((acc, it) => {
    acc[it.kind] = (acc[it.kind] || 0) + 1;
    if (it.lock) acc.locked++;
    return acc;
  }, { locked: 0 });

  return el('header', { class: 'cal-head' },
    el('div', { class: 'cal-head-left' },
      el('div', { class: 'eyebrow' },
        'Calendar',
        counts.locked ? ` · ${counts.locked} synced` : '',
      ),
      el('h1', {}, rangeTitle(viewKey, anchor)),
    ),
    el('div', { class: 'cal-head-right' },
      el('div', { class: 'cal-navgroup' },
        nav(-1, 'Previous', '‹'),
        el('button', {
          class: 'cal-today', type: 'button',
          onclick: () => go(hashFor(viewKey, new Date())),
        }, 'Today'),
        nav(1, 'Next', '›'),
      ),
      el('div', { class: 'cal-views' },
        ...VIEW_ORDER.map((k) => el('button', {
          class: 'cal-viewbtn', type: 'button',
          'aria-pressed': String(k === viewKey),
          title: `${VIEWS[k].label}  (${VIEWS[k].short})`,
          onclick: () => go(hashFor(k, anchor)),
        }, VIEWS[k].label)),
      ),
      el('button', {
        class: 'cal-unsched-btn', type: 'button',
        onclick: () => openUnscheduledSheet(data.unscheduled, refresh),
      }, `Unscheduled ${data.unscheduled.length}`),
    ),
  );
}

// ─── Time grid (day, week) ───────────────────────────────────────────────

function timeGrid(start, days, data, refresh) {
  const dayStarts = Array.from({ length: days }, (_, i) => addDaysTo(start, i));
  const todayYmd = today();

  // Drop targets, collected as the grid is built and handed to the dragger.
  const timeCols = [];
  const alldayStrips = [];

  // Header row: a corner over the hour gutter, then one cell per day.
  const head = el('div', { class: 'cal-tg-head' },
    el('div', { class: 'cal-gutter-cell' }),
    ...dayStarts.map((d) => el('button', {
      class: `cal-daycell ${ymd(d) === todayYmd ? 'is-today' : ''}`,
      type: 'button',
      title: 'Open this day',
      onclick: () => go(hashFor('day', d)),
    },
      el('span', { class: 'dow' }, d.toLocaleDateString(undefined, { weekday: 'short' })),
      el('span', { class: 'dnum' }, String(d.getDate())),
    )),
  );

  // All-day strip: dated tasks with no time, and all-day events.
  const alldayRow = el('div', { class: 'cal-allday' },
    el('div', { class: 'cal-gutter-cell' }, el('span', { class: 'eyebrow' }, 'All day')),
  );
  for (const d of dayStarts) {
    const key = ymd(d);
    const strip = el('div', { class: `cal-allday-cell ${key === todayYmd ? 'is-today' : ''}` });
    for (const it of data.items.filter((i) => i.placement === 'allday' && i.dayKey === key)) {
      strip.append(chip(it, { compact: true, refresh }));
    }
    alldayRow.append(strip);
    alldayStrips.push({ el: strip, dayKey: key });
  }

  // Hour gutter.
  const gutter = el('div', { class: 'cal-gutter' });
  for (let h = 0; h < 24; h++) {
    gutter.append(el('div', { class: 'cal-gutter-hour', style: `height:${HOUR_PX}px` },
      h === 0 ? '' : el('span', {}, formatHour(h))));
  }

  const cols = el('div', { class: 'cal-cols' });
  for (const d of dayStarts) {
    const key = ymd(d);
    const col = el('div', {
      class: `cal-col ${key === todayYmd ? 'is-today' : ''}`,
      style: `height:${24 * HOUR_PX}px`,
      'data-day': key,
    });

    // Hour lines, drawn as backgrounds rather than elements so a chip can sit
    // above them without the lines needing their own stacking context.
    col.append(el('div', { class: 'cal-hourlines', style: `background-size:100% ${HOUR_PX}px` }));

    const dayItems = layoutOverlaps(timedForDay(data.items, d));
    for (const it of dayItems) col.append(timedChip(it, d, refresh));

    if (key === todayYmd) col.append(nowLine());

    cols.append(col);
    timeCols.push({ el: col, dayStart: d, dayKey: key });
  }

  const scroll = el('div', { class: 'cal-tg-scroll' },
    el('div', { class: 'cal-tg-body' }, gutter, cols));

  const wrap = el('div', { class: 'cal-tg', style: `--cal-days:${days}` }, head, alldayRow, scroll);

  // Open on the working day, not on midnight. Run after mounting, not in a
  // requestAnimationFrame: the scroller is only scrollable once it is in the
  // document with its height resolved, and setting scrollTop before that
  // silently clamps to zero — and rAF never fires at all in a background tab
  // (the same trap openSheet in app.js documents).
  const afterMount = () => {
    void scroll.scrollHeight;   // force layout before measuring
    const n = new Date();
    const nowMin = n.getHours() * 60 + n.getMinutes();
    const target = dayStarts.some((d) => ymd(d) === todayYmd) ? nowMin - 90 : 7 * 60;
    scroll.scrollTop = Math.max(0, target * PX_PER_MIN);
  };

  installSlotDraw(timeCols, refresh);

  return {
    node: wrap, afterMount,
    ctx: { timeCols, alldayStrips, dayCells: [], scroller: scroll },
  };
}

const formatHour = (h) => new Date(2000, 0, 1, h)
  .toLocaleTimeString(undefined, { hour: 'numeric' })
  .replace(/\s/g, '');

function nowLine() {
  const line = el('div', { class: 'cal-now' }, el('span', { class: 'cal-now-dot' }));
  const place = () => {
    const n = new Date();
    line.style.top = `${(n.getHours() * 60 + n.getMinutes()) * PX_PER_MIN}px`;
  };
  place();
  // Cleared when the node leaves the document, which happens on every
  // navigation — the router replaces the whole mount.
  const timer = setInterval(() => {
    if (!line.isConnected) { clearInterval(timer); return; }
    place();
  }, 60000);
  return line;
}

// A chip on the hour grid: absolutely positioned, sized by duration.
function timedChip(it, dayStart, refresh) {
  const topMin = (it.clipStart - dayStart.getTime()) / MIN_MS;
  const mins = Math.max(MIN_ITEM_MIN, (it.clipEnd - it.clipStart) / MIN_MS);
  const cols = it.cols || 1;
  const col = it.col || 0;

  const node = chip(it, { refresh });
  node.classList.add('cal-timed');
  node.style.top = `${topMin * PX_PER_MIN}px`;
  node.style.height = `${mins * PX_PER_MIN - 2}px`;
  // Overlapping items share the width, with a slight overlap so a stack of
  // three is still readable rather than three slivers.
  node.style.left = `${(col / cols) * 100}%`;
  node.style.width = `calc(${(1 / cols) * 100}% - 3px)`;
  node.style.zIndex = String(10 + col);
  if (mins <= 30) node.classList.add('is-short');

  node.prepend(el('div', { class: 'cal-chip-time' }, timeLabel(it.startMs)));

  if (it.resizable) {
    node.append(el('div', { class: 'cal-resize', 'data-resize': '1', 'aria-hidden': 'true' }));
  }
  return node;
}

// ─── Day grid (2 weeks, month) ───────────────────────────────────────────

const narrow = () => window.matchMedia('(max-width: 640px)').matches;

function dayGrid(start, days, anchor, data, viewKey, refresh) {
  const todayYmd = today();
  const dayCells = [];
  const weeks = Math.ceil(days / 7);
  const focusMonth = viewKey === 'month' ? anchor.getMonth() : null;

  const head = el('div', { class: 'cal-dg-head' },
    ...Array.from({ length: 7 }, (_, i) =>
      el('div', { class: 'cal-dow' },
        addDaysTo(startOfWeek(start), i).toLocaleDateString(undefined, { weekday: 'short' }))),
  );

  const body = el('div', {
    class: 'cal-dg-body',
    style: `grid-template-rows:repeat(${weeks}, minmax(96px, 1fr))`,
  });

  for (let i = 0; i < days; i++) {
    const d = addDaysTo(start, i);
    const key = ymd(d);
    const outside = focusMonth !== null && d.getMonth() !== focusMonth;

    const list = el('div', { class: 'cal-cell-list' });
    const dayItems = data.items
      .filter((it) => it.dayKey === key)
      .sort((a, b) => (a.placement === 'allday' ? -1 : 0) - (b.placement === 'allday' ? -1 : 0)
        || (a.startMs ?? 0) - (b.startMs ?? 0));

    // Past a few, a cell of chips stops being readable — the rest collapse
    // into a link that opens the day. A phone-width cell is a seventh of 375px,
    // so it holds fewer before that happens.
    const shown = dayItems.slice(0, narrow() ? 2 : 4);
    for (const it of shown) list.append(chip(it, { compact: true, refresh }));
    if (dayItems.length > shown.length) {
      list.append(el('button', {
        class: 'cal-more', type: 'button',
        onclick: () => go(hashFor('day', d)),
      }, `+${dayItems.length - shown.length} more`));
    }

    const cell = el('div', {
      class: `cal-cell ${key === todayYmd ? 'is-today' : ''} ${outside ? 'is-outside' : ''}`,
      'data-day': key,
    },
      el('div', { class: 'cal-cell-head' },
        el('button', {
          class: 'cal-cell-num', type: 'button', title: 'Open this day',
          onclick: () => go(hashFor('day', d)),
        }, d.getDate() === 1
          ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
          : String(d.getDate())),
        el('button', {
          class: 'cal-cell-add', type: 'button', 'aria-label': `New event on ${key}`,
          onclick: () => openEventSheet({ dayKey: key, allDay: true }, refresh),
        }, '+'),
      ),
      list,
    );

    body.append(cell);
    dayCells.push({ el: cell, dayKey: key });
  }

  return {
    node: el('div', { class: 'cal-dg' }, head, body),
    ctx: { timeCols: [], alldayStrips: [], dayCells, scroller: null },
  };
}

// ─── Chips ───────────────────────────────────────────────────────────────

function chip(it, { compact = false, refresh } = {}) {
  const node = el('div', {
    class: [
      'cal-chip',
      `is-${it.kind}`,
      compact ? 'is-compact' : '',
      it.lock ? 'is-locked' : '',
      it.done ? 'is-done' : '',
      it.waiting ? 'is-waiting' : '',
      it.placement === 'allday' ? 'is-allday' : '',
    ].filter(Boolean).join(' '),
    style: `--chip:${it.color}`,
    tabindex: '0',
    role: 'button',
    title: it.lock ? `${it.title} — ${it.lock}` : it.title,
  });
  node.__item = it;

  node.append(el('div', { class: 'cal-chip-title' },
    it.lock ? el('span', { class: 'cal-lockmark', 'aria-hidden': 'true' }, '⇄') : null,
    it.title,
  ));

  if (!compact && it.kind === 'event' && it.location) {
    node.append(el('div', { class: 'cal-chip-sub' }, it.location));
  }
  if (!compact && it.kind === 'task') {
    const where = refName('project', it.row.project_id) || refName('domain', it.row.domain_id);
    if (where) node.append(el('div', { class: 'cal-chip-sub' }, where));
  }

  // A plain click opens it. Suppressed by the dragger when the pointer moved,
  // so a drag never also opens the thing it just moved.
  node.onclick = () => {
    if (node.dataset.justDragged) return;
    if (it.kind === 'task') go(it.href);
    else openEventSheet({ item: it }, refresh);
  };
  node.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); node.onclick(); }
  };

  return node;
}

// ─── Dragging ────────────────────────────────────────────────────────────
// One controller for every target kind on the page. A drag is: pick up a chip
// (or an unscheduled task), hit-test the pointer against the time columns, the
// all-day strips and then the month cells, draw a snapped ghost, and on
// release write the patch the target implies.

function installDragger(root, ctx) {
  root.addEventListener('pointerdown', (e) => onPointerDown(e, ctx));
  // Stashed on the root so a chip picked out of the Unscheduled sheet — which
  // lives outside this tree — can reuse the same drop targets.
  root.__calCtx = ctx;
}

function currentCtx() {
  return document.querySelector('.cal')?.__calCtx ?? null;
}

function onPointerDown(e, ctx) {
  if (e.button !== undefined && e.button !== 0) return;
  const node = e.target.closest?.('.cal-chip');
  if (!node?.__item) return;

  const it = node.__item;
  if (it.lock) {
    // Explain rather than do nothing — a chip that silently refuses to move
    // reads as a bug.
    if (e.pointerType !== 'mouse') toast(it.lock, 'err');
    return;
  }
  const resizing = !!e.target.closest?.('[data-resize]');
  startDrag(e, { node, item: it, resizing, ctx });
}

// Public: used by the Unscheduled sheet, where the source is a list row rather
// than a chip already on the grid.
export function startDragFrom(e, item, node) {
  const ctx = currentCtx();
  if (!ctx) return;
  startDrag(e, { node, item, resizing: false, ctx, fromRail: true });
}

function startDrag(e, { node, item, resizing, ctx, fromRail = false }) {
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerType = e.pointerType || 'mouse';
  // Touch holds before it drags, so a scroll that starts on a chip is still a
  // scroll. A mouse just needs to actually move.
  const holdMs = pointerType === 'mouse' ? 0 : 320;
  const moveThreshold = pointerType === 'mouse' ? 4 : 8;

  let armed = holdMs === 0;
  let dragging = false;
  let ghost = null;
  let drop = null;
  let lastTarget = null;

  const durationMin = item.placement === 'timed'
    ? Math.max(MIN_ITEM_MIN, (item.endMs - item.startMs) / MIN_MS)
    : (item.kind === 'event' ? 60 : DEFAULT_TASK_MIN);

  // Where inside the chip the pointer grabbed it, so the block doesn't jump
  // its own height the moment it starts moving.
  const rect = node.getBoundingClientRect();
  const grabOffsetMin = item.placement === 'timed' && !fromRail
    ? (startY - rect.top) / PX_PER_MIN
    : Math.min(durationMin / 2, 15);

  const holdTimer = holdMs
    ? setTimeout(() => { armed = true; node.classList.add('armed'); navigator.vibrate?.(8); }, holdMs)
    : null;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < moveThreshold) return;
      if (!armed) { cleanup(); return; }   // moved before the hold — let it be a scroll
      dragging = true;
      node.classList.add('dragging');
      node.setPointerCapture?.(ev.pointerId);
      ghost = makeGhost(item);
      document.body.append(ghost);
      document.body.classList.add('cal-dragging');
    }
    autoScroll(ctx.scroller, ev);
    drop = hitTest(ev, ctx, { item, durationMin, grabOffsetMin, resizing });
    paintGhost(ghost, drop, item, ev);
    if (lastTarget && lastTarget !== drop?.el) lastTarget.classList.remove('drop-on');
    if (drop?.kind === 'day' && drop.el) { drop.el.classList.add('drop-on'); lastTarget = drop.el; }
  };

  const onUp = async () => {
    const wasDragging = dragging;
    const target = drop;
    cleanup();
    if (!wasDragging) return;

    // Swallow the click that a pointerup synthesises, so the chip doesn't also
    // open the row that was just moved.
    node.dataset.justDragged = '1';
    setTimeout(() => { delete node.dataset.justDragged; }, 0);

    if (!target) { toast('Dropped outside the calendar — nothing changed'); return; }
    await commit(item, target, ctx.refresh);
  };

  const onKey = (ev) => { if (ev.key === 'Escape') { drop = null; cleanup(); } };

  function cleanup() {
    if (holdTimer) clearTimeout(holdTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', cleanup);
    window.removeEventListener('keydown', onKey);
    node.classList.remove('dragging', 'armed');
    lastTarget?.classList.remove('drop-on');
    ghost?.remove();
    ghost = null;
    dragging = false;
    document.body.classList.remove('cal-dragging');
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
  window.addEventListener('pointercancel', cleanup);
  window.addEventListener('keydown', onKey);
}

// Dragging to 6am when the grid opened at 9am has to be possible without
// letting go, so the scroller creeps once the pointer is within 40px of an
// edge. Speed is proportional to how far past the edge it is.
function autoScroll(scroller, ev) {
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  const zone = 40;
  let dy = 0;
  if (ev.clientY < r.top + zone) dy = -(r.top + zone - ev.clientY) / 4;
  else if (ev.clientY > r.bottom - zone) dy = (ev.clientY - (r.bottom - zone)) / 4;
  if (dy) scroller.scrollTop += dy;
}

// Which target is under the pointer, and what time that implies.
function hitTest(ev, ctx, { item, durationMin, grabOffsetMin, resizing }) {
  const { clientX: x, clientY: y } = ev;

  for (const col of ctx.timeCols) {
    const r = col.el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;

    const rawMin = (y - r.top) / PX_PER_MIN;
    if (resizing) {
      const startMs = item.startMs;
      const endMin = snapMinutes(rawMin);
      const endMs = Math.max(
        startMs + MIN_ITEM_MIN * MIN_MS,
        col.dayStart.getTime() + endMin * MIN_MS,
      );
      return { kind: 'time', el: col.el, col, startMs, endMs, resizing: true };
    }
    const startMin = Math.max(0, Math.min(
      24 * 60 - durationMin,
      snapMinutes(rawMin - grabOffsetMin),
    ));
    const startMs = col.dayStart.getTime() + startMin * MIN_MS;
    return { kind: 'time', el: col.el, col, startMs, endMs: startMs + durationMin * MIN_MS };
  }

  if (resizing) return null;   // a resize only ever means something on the hour grid

  for (const strip of ctx.alldayStrips) {
    const r = strip.el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { kind: 'day', el: strip.el, dayKey: strip.dayKey, clearTime: true };
    }
  }
  for (const cell of ctx.dayCells) {
    const r = cell.el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { kind: 'day', el: cell.el, dayKey: cell.dayKey, clearTime: false };
    }
  }
  return null;
}

function makeGhost(item) {
  return el('div', { class: `cal-ghost is-${item.kind}`, style: `--chip:${item.color}` },
    el('div', { class: 'cal-ghost-time' }, ''),
    el('div', { class: 'cal-ghost-title' }, item.title),
  );
}

function paintGhost(ghost, drop, item, ev) {
  if (!ghost) return;
  if (!drop) {
    ghost.classList.add('is-loose');
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 12}px`;
    ghost.style.width = '180px';
    ghost.style.height = 'auto';
    ghost.querySelector('.cal-ghost-time').textContent = 'No slot';
    return;
  }
  ghost.classList.remove('is-loose');

  if (drop.kind === 'time') {
    const r = drop.el.getBoundingClientRect();
    const dayMs = drop.col.dayStart.getTime();
    const topMin = (drop.startMs - dayMs) / MIN_MS;
    const mins = Math.max(MIN_ITEM_MIN, (drop.endMs - drop.startMs) / MIN_MS);
    ghost.style.left = `${r.left + 2}px`;
    ghost.style.top = `${r.top + topMin * PX_PER_MIN}px`;
    ghost.style.width = `${r.width - 6}px`;
    ghost.style.height = `${mins * PX_PER_MIN}px`;
    ghost.querySelector('.cal-ghost-time').textContent =
      `${timeLabel(drop.startMs)} – ${timeLabel(drop.endMs)}`;
    return;
  }

  const r = drop.el.getBoundingClientRect();
  ghost.style.left = `${r.left + 4}px`;
  ghost.style.top = `${r.top + 4}px`;
  ghost.style.width = `${Math.min(r.width - 8, 220)}px`;
  ghost.style.height = 'auto';
  ghost.querySelector('.cal-ghost-time').textContent =
    drop.clearTime ? 'All day' : niceDate(drop.dayKey);
}

// ─── Writing a drop ──────────────────────────────────────────────────────

async function commit(item, drop, refresh) {
  const patch = drop.kind === 'time'
    ? timedPatch(item, drop.startMs, drop.endMs)
    : dayPatch(item, drop.dayKey, { clearTime: drop.clearTime });

  // Nothing actually changed — a drag back to where it started.
  if (Object.entries(patch).every(([k, v]) => (item.row[k] ?? null) === (v ?? null))) return;

  const undo = inversePatch(item, patch);
  const table = tableFor(item);

  const { error } = await sb.from(table).update(patch).eq('id', item.id);
  if (error) { fail(error); refresh(); return; }

  Object.assign(item.row, patch);
  lastMove = { table, id: item.id, undo, label: item.title };

  toast(drop.kind === 'time'
    ? `Moved to ${timeLabel(drop.startMs)} · Z to undo`
    : `Moved to ${niceDate(drop.dayKey)} · Z to undo`);
  refresh();
}

async function undoLastMove(refresh) {
  if (!lastMove) { toast('Nothing to undo'); return; }
  const { table, id, undo, label } = lastMove;
  lastMove = null;
  const { error } = await sb.from(table).update(undo).eq('id', id);
  if (error) { fail(error); return; }
  toast(`Put “${label}” back`);
  refresh();
}

// ─── Drawing a new event on empty grid ───────────────────────────────────
// Press on empty grid and drag to sweep out a range, exactly the way every
// calendar does it. A plain click (no sweep) means one hour.

function installSlotDraw(timeCols, refresh) {
  for (const col of timeCols) {
    col.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cal-chip')) return;
      if (e.button !== undefined && e.button !== 0) return;

      const r = col.el.getBoundingClientRect();
      const anchorMin = snapMinutes((e.clientY - r.top) / PX_PER_MIN, 30);
      const band = el('div', { class: 'cal-draw' });
      col.el.append(band);

      let endMin = anchorMin + 60;
      const paint = () => {
        const a = Math.min(anchorMin, endMin);
        const b = Math.max(anchorMin + SNAP_MIN, endMin);
        band.style.top = `${a * PX_PER_MIN}px`;
        band.style.height = `${(b - a) * PX_PER_MIN}px`;
        band.textContent = `${timeLabel(col.dayStart.getTime() + a * MIN_MS)} – ${timeLabel(col.dayStart.getTime() + b * MIN_MS)}`;
      };
      paint();

      const move = (ev) => {
        endMin = snapMinutes((ev.clientY - r.top) / PX_PER_MIN);
        paint();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        band.remove();
        const a = Math.max(0, Math.min(anchorMin, endMin));
        const b = Math.max(a + SNAP_MIN, Math.max(anchorMin, endMin));
        openEventSheet({
          startMs: col.dayStart.getTime() + a * MIN_MS,
          endMs: col.dayStart.getTime() + b * MIN_MS,
        }, refresh);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    });
  }
}

// ─── Event editor ────────────────────────────────────────────────────────
// A small purpose-built sheet rather than the generic engine form: it needs to
// open prefilled from a swept-out range and refresh the grid in place, neither
// of which the descriptor-driven form does.

function openEventSheet({ item = null, startMs = null, endMs = null, dayKey = null, allDay = false }, refresh) {
  const row = item?.row ?? null;
  const isNew = !row;

  const start = row ? new Date(row.start_at) : new Date(startMs ?? (dayKey ? new Date(dayKey + 'T09:00:00') : Date.now()));
  const end = row?.end_at ? new Date(row.end_at) : new Date(endMs ?? (start.getTime() + HOUR_MS));

  const title = el('input', { type: 'text', value: row?.title ?? '', placeholder: 'What is it?' });
  const dayInput = el('input', { type: 'date', value: ymd(start) });
  const startInput = el('input', { type: 'time', value: clockOf(start), step: '900' });
  const endInput = el('input', { type: 'time', value: clockOf(end), step: '900' });
  const allDayInput = el('input', { type: 'checkbox' });
  allDayInput.checked = row ? !!row.all_day : allDay;
  const location = el('input', { type: 'text', value: row?.location ?? '', placeholder: 'Where' });
  const description = el('textarea', { rows: 3, placeholder: 'Notes' });
  description.value = row?.description ?? '';

  const times = el('div', { class: 'cal-sheet-times' },
    el('label', {}, el('span', {}, 'From'), startInput),
    el('label', {}, el('span', {}, 'To'), endInput),
  );
  const syncAllDay = () => { times.style.display = allDayInput.checked ? 'none' : ''; };
  allDayInput.onchange = syncAllDay;
  syncAllDay();

  const lock = row ? item.lock : null;

  const save = el('button', { class: 'primary', onclick: onSave },
    isNew ? 'Add event' : 'Save');

  openSheet(el('div', { class: 'cal-sheet' },
    el('div', { class: 'sheet-head' },
      el('div', { class: 'eyebrow' }, isNew ? 'New event' : 'Event')),
    el('div', { class: 'cal-sheet-body' },
      lock ? el('div', { class: 'cal-lockbanner' }, lock) : null,
      el('label', { class: 'cal-sheet-field' }, el('span', {}, 'Title'), title),
      el('label', { class: 'cal-sheet-field' }, el('span', {}, 'Day'), dayInput),
      el('label', { class: 'cal-sheet-check' }, allDayInput, el('span', {}, 'All day')),
      times,
      el('label', { class: 'cal-sheet-field' }, el('span', {}, 'Location'), location),
      el('label', { class: 'cal-sheet-field' }, el('span', {}, 'Notes'), description),
      el('div', { class: 'form-actions' },
        save,
        isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete'),
      ),
    ),
  ), { dialog: true });

  requestAnimationFrame(() => title.focus());

  async function onSave() {
    if (!title.value.trim()) { toast('Title required', 'err'); return; }
    const day = dayInput.value || ymd(start);
    const payload = {
      title: title.value.trim(),
      location: location.value.trim() || null,
      description: description.value.trim() || null,
      all_day: allDayInput.checked,
    };
    if (allDayInput.checked) {
      const s = new Date(day + 'T00:00:00');
      payload.start_at = s.toISOString();
      payload.end_at = addDaysTo(s, 1).toISOString();
    } else {
      const s = new Date(`${day}T${startInput.value || '09:00'}:00`);
      let e2 = new Date(`${day}T${endInput.value || '10:00'}:00`);
      // An end before the start means it runs past midnight, not backwards.
      if (e2 <= s) e2 = new Date(e2.getTime() + DAY_MS);
      payload.start_at = s.toISOString();
      payload.end_at = e2.toISOString();
    }
    if (isNew) payload.source = 'created_here';

    save.disabled = true;
    const res = isNew
      ? await sb.from('calendar_events').insert(payload)
      : await sb.from('calendar_events').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }

    closeSheet();
    toast(isNew ? 'Event added' : 'Saved');
    refresh();
  }

  async function onDelete() {
    if (!confirmDelete('this event')) return;
    const { error } = await sb.from('calendar_events').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    closeSheet();
    toast('Deleted');
    refresh();
  }
}

const clockOf = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// ─── Unscheduled ─────────────────────────────────────────────────────────
// Open tasks with no due date. Drag one straight onto the grid, or — on a
// phone, where dragging out of a sheet is awkward — tap "Today" / "Tomorrow"
// to date it without leaving the calendar.

function openUnscheduledSheet(items, refresh) {
  const body = el('div', { class: 'cal-unsched' });

  if (!items.length) {
    body.append(hint('Nothing unscheduled. Every open task has a date.'));
  }

  for (const it of items) {
    const row = el('div', { class: 'cal-unsched-row' });
    const handle = chip(it, { compact: true, refresh });
    handle.classList.add('cal-unsched-chip');
    handle.onclick = () => { closeSheet(); go(it.href); };
    handle.addEventListener('pointerdown', (e) => {
      // Dragging out of the sheet needs the sheet out of the way.
      if (e.pointerType === 'mouse') closeSheet();
      startDragFrom(e, it, handle);
    });

    const place = (dayKey, label) => el('button', {
      class: 'ghost small', type: 'button',
      onclick: async () => {
        const { error } = await sb.from('tasks').update({ due_date: dayKey }).eq('id', it.id);
        if (error) { fail(error); return; }
        lastMove = { table: 'tasks', id: it.id, undo: { due_date: null }, label: it.title };
        toast(`Scheduled for ${label} · Z to undo`);
        closeSheet();
        refresh();
      },
    }, label);

    row.append(handle, el('div', { class: 'cal-unsched-actions' },
      place(today(), 'Today'),
      place(ymd(addDays(new Date(), 1)), 'Tomorrow'),
    ));
    body.append(row);
  }

  openSheet(el('div', {},
    el('div', { class: 'sheet-head' },
      el('div', { class: 'eyebrow' }, `Unscheduled · ${items.length}`)),
    el('div', { class: 'cal-sheet-body' },
      el('div', { class: 'hint', style: 'padding:0 0 10px' },
        'Drag one onto the grid, or date it here.'),
      body,
    ),
  ), { dialog: true });
}

// ─── Keyboard ────────────────────────────────────────────────────────────
// The shortcuts a calendar is expected to have: D/W/F/M switch view, T jumps
// to today, arrows page, Z undoes the last drag.

function bindKeys(viewKey, anchor, refresh) {
  if (liveKeyHandler) window.removeEventListener('keydown', liveKeyHandler);

  liveKeyHandler = (e) => {
    if (!currentPath().startsWith('/calendar')) {
      window.removeEventListener('keydown', liveKeyHandler);
      liveKeyHandler = null;
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable)) return;

    const k = e.key.toLowerCase();
    const jump = (v) => { e.preventDefault(); go(hashFor(v, anchor)); };

    if (k === 'd') return jump('day');
    if (k === 'w') return jump('week');
    if (k === 'f') return jump('fortnight');
    if (k === 'm') return jump('month');
    if (k === 't') { e.preventDefault(); return go(hashFor(viewKey, new Date())); }
    if (k === 'z') { e.preventDefault(); return undoLastMove(refresh); }
    if (e.key === 'ArrowLeft' || k === 'k') {
      e.preventDefault();
      return go(hashFor(viewKey, stepAnchor(viewKey, anchor, -1)));
    }
    if (e.key === 'ArrowRight' || k === 'j') {
      e.preventDefault();
      return go(hashFor(viewKey, stepAnchor(viewKey, anchor, 1)));
    }
  };

  window.addEventListener('keydown', liveKeyHandler);
}
