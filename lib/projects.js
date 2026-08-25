// Project detail — data layer. Ports the small pure-math pieces
// projects/[id]/page.tsx and its sub-components need: the retainer-cycle
// calculator, the milestone/due-window task grouping (Addendum 08 §10), the
// activity-log hours parser, and the recurring-checklist "currently done"
// window math from packages/shared/src/recurrence.ts.

export const PROJECT_COLOR_PALETTE = [
  '#B8442B', '#3F5B47', '#3A4663', '#C9A063', '#7A2E36', '#3F6968', '#7A6A8E', '#7A726B',
];

// ─── Retainer cycle ─────────────────────────────────────────────────────

function daysInMonth(y, m1) { return new Date(Date.UTC(y, m1, 0)).getUTCDate(); }

// Position within the anchor-day billing cycle, clamped to month end
// (anchor 31 -> Feb 28/29). Day 1 = the anchor date.
export function retainerCycle(anchorDay, todayYmd) {
  const [y, m, d] = todayYmd.split('-').map(Number);
  const clamp = (yy, mm1) => Math.min(anchorDay, daysInMonth(yy, mm1));
  let ay = y, am = m, aDay = clamp(y, m);
  if (d < aDay) { am = m - 1; if (am < 1) { am = 12; ay = y - 1; } aDay = clamp(ay, am); }
  let ny = ay, nm = am + 1; if (nm > 12) { nm = 1; ny = ay + 1; }
  const nDay = clamp(ny, nm);
  const start = Date.UTC(ay, am - 1, aDay);
  const next = Date.UTC(ny, nm - 1, nDay);
  const todayUTC = Date.UTC(y, m - 1, d);
  return { day: Math.floor((todayUTC - start) / 86_400_000) + 1, length: Math.round((next - start) / 86_400_000) };
}

// ─── Task grouping (Addendum 08 §10) ───────────────────────────────────

function sortPool(list) {
  return [...list].sort((a, b) => {
    const aw = a.status === 'waiting' ? 1 : 0;
    const bw = b.status === 'waiting' ? 1 : 0;
    if (aw !== bw) return aw - bw;
    return (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99');
  });
}

export function buildMilestoneGroups(pool, milestones) {
  const ordered = [...milestones].sort((a, b) => a.position - b.position);
  const currentId = ordered.find((m) => m.status === 'open')?.id ?? null;
  const groups = [];
  for (const m of ordered) {
    const t = sortPool(pool.filter((x) => x.milestone_id === m.id));
    if (t.length === 0) continue;
    const meta = m.status === 'done' ? `done · weight ${m.weight}` : m.id === currentId ? `in progress · weight ${m.weight}` : `weight ${m.weight}`;
    groups.push({ key: m.id, title: m.title, meta, tasks: t, muted: m.status === 'done' });
  }
  const general = sortPool(pool.filter((t) => !t.milestone_id));
  if (general.length > 0) groups.push({ key: 'general', title: 'General', meta: 'no milestone', tasks: general });
  return groups;
}

export function buildDueGroups(pool, today) {
  const plus7 = new Date(new Date(`${today}T00:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const open = pool.filter((t) => t.status === 'open');
  const waiting = pool.filter((t) => t.status === 'waiting');
  const buckets = [
    { key: 'overdue', title: 'Overdue', accent: true, tasks: open.filter((t) => t.due_date && t.due_date < today) },
    { key: 'today', title: 'Today', tasks: open.filter((t) => t.due_date === today) },
    { key: 'week', title: 'This week', tasks: open.filter((t) => t.due_date && t.due_date > today && t.due_date <= plus7) },
    { key: 'later', title: 'Later', tasks: open.filter((t) => t.due_date && t.due_date > plus7) },
    { key: 'undated', title: 'Undated', tasks: open.filter((t) => !t.due_date) },
    { key: 'waiting', title: 'Waiting', muted: true, tasks: waiting },
  ].map((g) => ({ ...g, meta: String(g.tasks.length), tasks: sortPool(g.tasks) }));
  return buckets.filter((g) => g.tasks.length > 0);
}

// ─── Activity-log hours parser ─────────────────────────────────────────
// "1.5", "1h", "1h30m", "90m", "45 min" — anything reasonable a human
// would type. Empty/unparseable -> null.

export function parseHours(raw) {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(?:([0-9]+(?:\.[0-9]+)?)\s*h)?\s*(?:([0-9]+)\s*m)?$/);
  if (m && (m[1] !== undefined || m[2] !== undefined)) {
    const h = m[1] ? parseFloat(m[1]) : 0;
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return h + min / 60;
  }
  const minOnly = s.match(/^([0-9]+)\s*(?:m|min)$/);
  if (minOnly) return parseInt(minOnly[1], 10) / 60;
  return null;
}

// ─── Recurring checklist items (packages/shared/src/recurrence.ts) ────

export const RECURRENCE_PATTERNS = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'semiannually', 'yearly'];
export const RECURRENCE_LABELS = {
  daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', semiannually: 'Every 6 months', yearly: 'Yearly',
};

function periodStart(rule, nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  switch (rule) {
    case 'daily': return Date.UTC(y, m, day);
    case 'weekdays': {
      const dow = d.getUTCDay();
      if (dow === 6) return Date.UTC(y, m, day - 1);
      if (dow === 0) return Date.UTC(y, m, day - 2);
      return Date.UTC(y, m, day);
    }
    case 'weekly': {
      const dow = d.getUTCDay();
      return Date.UTC(y, m, day - (dow === 0 ? 6 : dow - 1));
    }
    case 'biweekly': return nowMs - 14 * 86_400_000;
    case 'monthly': return Date.UTC(y, m, 1);
    case 'semiannually': return Date.UTC(y, m < 6 ? 0 : 6, 1);
    case 'yearly': return Date.UTC(y, 0, 1);
    default: return 0;
  }
}

// Whether a recurring checklist item currently reads as done — true only
// if its last done_at falls within the rule's current period. Non-recurring
// items just use the plain `done` column (caller's job).
export function isCurrentlyDoneRecurring(done, doneAtIso, rule, nowMs = Date.now()) {
  if (!done || !doneAtIso) return false;
  const doneMs = Date.parse(doneAtIso);
  if (Number.isNaN(doneMs)) return false;
  return doneMs >= periodStart(rule, nowMs);
}
