// Calendar logic — dates, ranges, item normalisation, overlap layout and the
// patches that write a move back. Kept apart from views/calendar.js so the
// arithmetic (which is where a calendar actually goes wrong) is readable on
// its own and has no DOM in it.
//
// Everything here works in the phone's local time, for the same reason
// lib/ui.js does: "Tuesday" has to mean Tuesday where the phone is.

import { ymd } from './ui.js';
import { domainColor, DOMAIN_COLOR_FALLBACK } from './domain-colors.js';
import { ref } from './db.js';

export const MIN_MS = 60000;
export const HOUR_MS = 3600000;
export const DAY_MS = 86400000;

// Drag granularity. 15 minutes is fine enough to be useful and coarse enough
// that a shaky thumb still lands on a round number.
export const SNAP_MIN = 15;

// A task with a time but no duration column to read gets this much room on
// the grid. See `columns` below.
export const DEFAULT_TASK_MIN = 30;
export const MIN_ITEM_MIN = 15;

// ─── Views ───────────────────────────────────────────────────────────────
// `days` is the span. `grid` is how it's drawn: 'time' is the hour grid
// (day/week), 'days' is the month-style cell grid (fortnight/month), where a
// drag changes the date and leaves the time of day alone.

export const VIEWS = {
  day: { key: 'day', label: 'Day', short: 'D', days: 1, grid: 'time' },
  week: { key: 'week', label: 'Week', short: 'W', days: 7, grid: 'time' },
  fortnight: { key: 'fortnight', label: '2 weeks', short: 'F', days: 14, grid: 'days' },
  month: { key: 'month', label: 'Month', short: 'M', days: 0, grid: 'days' },
};

export const VIEW_ORDER = ['day', 'week', 'fortnight', 'month'];

// Monday. The working week here starts on a Monday and the Planner's own week
// windows do too, so a Sunday-first grid would put the two out of step.
export const WEEK_STARTS_ON = 1;

// ─── Date arithmetic ─────────────────────────────────────────────────────

export function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function startOfWeek(d) {
  const c = startOfDay(d);
  const shift = (c.getDay() - WEEK_STARTS_ON + 7) % 7;
  c.setDate(c.getDate() - shift);
  return c;
}

export function addDaysTo(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function addMonths(d, n) {
  const src = new Date(d);
  const c = startOfDay(src);
  // Clamp the day first, so 31 Jan + 1 month is 28 Feb rather than rolling
  // over into March.
  c.setDate(1);
  c.setMonth(c.getMonth() + n);
  const last = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  c.setDate(Math.min(src.getDate(), last));
  return c;
}

// The block of whole days a view shows for a given anchor date.
export function rangeFor(viewKey, anchor) {
  const v = VIEWS[viewKey] ?? VIEWS.week;
  if (v.key === 'day') return { start: startOfDay(anchor), days: 1 };
  if (v.key === 'week') return { start: startOfWeek(anchor), days: 7 };
  if (v.key === 'fortnight') return { start: startOfWeek(anchor), days: 14 };

  // Month: whole weeks, so the grid is always rectangular. Five rows unless
  // the month genuinely spills into a sixth.
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const end = addDaysTo(startOfWeek(lastDay), 7);
  return { start, days: Math.round((end - start) / DAY_MS) };
}

// Step one screenful in either direction.
export function stepAnchor(viewKey, anchor, dir) {
  if (viewKey === 'month') return addMonths(anchor, dir);
  return addDaysTo(anchor, dir * (VIEWS[viewKey]?.days || 7));
}

export function rangeTitle(viewKey, anchor) {
  const { start, days } = rangeFor(viewKey, anchor);
  if (viewKey === 'month') {
    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (viewKey === 'day') {
    return start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const end = addDaysTo(start, days - 1);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();

  // Composed rather than handed to Intl as a range: a plain
  // toLocaleDateString on each end reads "24 – Aug 30, 2026" under a US
  // locale, which is nobody's idea of a week label. Month names still come
  // from the locale; only the order is ours.
  const mon = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  const from = sameMonth ? `${start.getDate()}`
    : sameYear ? `${start.getDate()} ${mon(start)}`
    : `${start.getDate()} ${mon(start)} ${start.getFullYear()}`;
  return `${from} – ${end.getDate()} ${mon(end)} ${end.getFullYear()}`;
}

// Minutes since midnight, snapped.
export const snapMinutes = (min, snap = SNAP_MIN) => Math.round(min / snap) * snap;

export function timeLabel(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// 'HH:MM:SS', for a Postgres `time` column.
export function pgTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Local ms for a 'HH:MM[:SS]' on a given day.
export function msOnDay(dayStart, hhmmss) {
  const [h, m] = String(hhmmss).split(':').map(Number);
  return dayStart.getTime() + (h || 0) * HOUR_MS + (m || 0) * MIN_MS;
}

// ─── Feature detection ───────────────────────────────────────────────────
// tasks.duration_minutes and the planner-sync columns (migration 0046) are
// not applied on every deployment of this database yet. Rather than hard-fail
// or hard-code, the first task row that comes back says what exists, and the
// features needing a missing column stay switched off.

export const columns = { taskDuration: false, plannerSync: false };

export function detectColumns(taskRows) {
  const row = taskRows?.[0];
  if (!row) return;
  columns.taskDuration = 'duration_minutes' in row;
  columns.plannerSync = 'external_source' in row;
}

// ─── Ownership ───────────────────────────────────────────────────────────
// The one rule this calendar obeys: it never moves a row it doesn't own.
// A planner-mirrored task and a Google-synced event are both written by a
// sync that would overwrite whatever we did on its next pass, so dragging
// them would silently lose the change. They render, they open, they don't
// move — and the chip says why.

export function taskLock(t) {
  if (t.external_locked) return 'Locked by the Planner sync';
  if (t.external_source === 'planner' || t.source === 'planner') {
    return 'Owned by the Planner — reschedule it there';
  }
  return null;
}

export function eventLock(e) {
  if (e.google_event_id) return 'Owned by Google Calendar — move it there';
  if (e.source && e.source !== 'created_here') return `Synced from ${e.source} — move it at the source`;
  return null;
}

// ─── Item normalisation ──────────────────────────────────────────────────
// Events and tasks are different shapes with different scheduling columns;
// everything past this point deals in one shape.
//
//   kind       'event' | 'task'
//   placement  'timed' | 'allday' | 'unscheduled'
//   startMs    local ms — timed items only
//   dayKey     'YYYY-MM-DD' — everything but unscheduled
//   lock       null, or the reason it can't be dragged

const domainNameById = (id) => ref.domains.find((d) => d.id === id)?.name
  ?? (ref.inbox?.id === id ? 'Inbox' : '');

function taskColor(t) {
  const name = domainNameById(t.domain_id);
  return name ? domainColor(name) : DOMAIN_COLOR_FALLBACK;
}

export function taskItem(t) {
  const lock = taskLock(t);
  const base = {
    kind: 'task', id: t.id, row: t, title: t.title,
    color: taskColor(t), lock,
    done: t.status === 'done', waiting: t.status === 'waiting',
    priority: t.priority ?? 4,
    external: t.external_source || (t.source === 'planner' ? 'planner' : null),
    externalUrl: t.external_url || null,
    href: `#/tasks/${t.id}`,
  };
  if (!t.due_date) return { ...base, placement: 'unscheduled' };
  if (!t.due_time) return { ...base, placement: 'allday', dayKey: String(t.due_date).slice(0, 10) };

  const dayStart = new Date(String(t.due_date).slice(0, 10) + 'T00:00:00');
  const startMs = msOnDay(dayStart, t.due_time);
  const mins = Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : DEFAULT_TASK_MIN;
  return {
    ...base, placement: 'timed',
    dayKey: ymd(dayStart), startMs, endMs: startMs + mins * MIN_MS,
    resizable: columns.taskDuration && !lock,
  };
}

export function eventItem(e) {
  const lock = eventLock(e);
  const base = {
    kind: 'event', id: e.id, row: e, title: e.title || '(untitled)',
    color: 'var(--accent)', lock, external: e.google_event_id ? 'google' : null,
    location: e.location || '',
    href: `#/c/calendar/${e.id}`,
  };
  if (e.all_day) return { ...base, placement: 'allday', dayKey: ymd(new Date(e.start_at)) };

  const startMs = new Date(e.start_at).getTime();
  // end_at is NOT NULL in the schema, but a synced row with a bad end would
  // otherwise draw as a zero-height sliver nothing can grab.
  const rawEnd = e.end_at ? new Date(e.end_at).getTime() : startMs;
  const endMs = Math.max(rawEnd, startMs + MIN_ITEM_MIN * MIN_MS);
  return {
    ...base, placement: 'timed',
    dayKey: ymd(new Date(startMs)), startMs, endMs, resizable: !lock,
  };
}

// Timed items belonging to one calendar day of the grid. An item running past
// midnight is clipped into the day being drawn, so it appears on both days
// rather than overflowing one column.
export function timedForDay(items, dayStart) {
  const from = dayStart.getTime();
  const to = from + DAY_MS;
  const out = [];
  for (const it of items) {
    if (it.placement !== 'timed') continue;
    if (it.endMs <= from || it.startMs >= to) continue;
    out.push({
      ...it,
      clipStart: Math.max(it.startMs, from),
      clipEnd: Math.min(it.endMs, to),
      continuesBefore: it.startMs < from,
      continuesAfter: it.endMs > to,
    });
  }
  return out.sort((a, b) => a.clipStart - b.clipStart || b.clipEnd - a.clipEnd);
}

// ─── Overlap layout ──────────────────────────────────────────────────────
// Side-by-side columns for items sharing time, the way every calendar draws
// them: cluster items that transitively overlap, give each the first column
// that's free, and let the whole cluster share the width.

export function layoutOverlaps(dayItems) {
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    for (const it of cluster) {
      let c = colEnds.findIndex((endMs) => endMs <= it.clipStart);
      if (c === -1) { c = colEnds.length; colEnds.push(0); }
      colEnds[c] = it.clipEnd;
      it.col = c;
    }
    for (const it of cluster) it.cols = colEnds.length;
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const it of dayItems) {
    if (it.clipStart >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.clipEnd);
  }
  flush();
  return dayItems;
}

// ─── Writing a move back ─────────────────────────────────────────────────
// One function per kind of change, each returning a plain patch object, so
// the view can apply it optimistically and keep the inverse for undo.

export function timedPatch(item, startMs, endMs) {
  if (item.kind === 'event') {
    return {
      start_at: new Date(startMs).toISOString(),
      end_at: new Date(endMs).toISOString(),
      all_day: false,
    };
  }
  const patch = {
    due_date: ymd(new Date(startMs)),
    due_time: pgTime(startMs),
  };
  if (columns.taskDuration) patch.duration_minutes = Math.round((endMs - startMs) / MIN_MS);
  return patch;
}

// Dropped on an all-day strip, or on a month/fortnight cell with no time
// attached: keep the time of day if it had one, change the date.
export function dayPatch(item, dayKey, { clearTime = false } = {}) {
  if (item.kind === 'event') {
    if (clearTime || item.placement === 'allday') {
      const start = new Date(dayKey + 'T00:00:00');
      return {
        start_at: start.toISOString(),
        end_at: addDaysTo(start, 1).toISOString(),
        all_day: true,
      };
    }
    const shift = new Date(dayKey + 'T00:00:00').getTime()
      - startOfDay(new Date(item.startMs)).getTime();
    return {
      start_at: new Date(item.startMs + shift).toISOString(),
      end_at: new Date(item.endMs + shift).toISOString(),
      all_day: false,
    };
  }
  return { due_date: dayKey, due_time: clearTime ? null : (item.row.due_time ?? null) };
}

// The patch that puts a row back exactly where it was — kept so a mis-drag is
// one keystroke to undo, not a hunt for where it used to be.
export function inversePatch(item, patch) {
  const out = {};
  for (const k of Object.keys(patch)) out[k] = item.row[k] ?? null;
  return out;
}

export const tableFor = (item) => (item.kind === 'event' ? 'calendar_events' : 'tasks');
