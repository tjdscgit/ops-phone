// Routines — data layer. A port of packages/shared/src/routine-stats.ts
// (streak + completion-rate math, pure functions) and routines/routines-data.ts
// (the /routines summary band's analytics). No DB access here — callers pass
// in completion dates and the device's own "today".

export const PART_ORDER = ['morning', 'afternoon', 'evening', 'anytime'];
export const PART_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', anytime: 'Anytime' };

// Within a part: specific_time ascending (6am before 9am), then position.
export function sortRoutines(a, b) {
  if (a.specific_time && b.specific_time) return a.specific_time.localeCompare(b.specific_time);
  if (a.specific_time) return -1;
  if (b.specific_time) return 1;
  return (a.position ?? 0) - (b.position ?? 0);
}

export function formatTime(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mn = m[2];
  const period = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h <= 12 ? h : h - 12;
  return `${display}:${mn} ${period}`;
}

// A routine is "currently missed" only if today's cron flagged it AND it
// still isn't done — same rule the Today widget uses.
export function isMissed(r, today) {
  return !r.stats.done_today && r.last_missed_sent_date === today;
}

// ─── Streak + rate math (exact port of routine-stats.ts) ──────────────────

function daysBetween(fromIso, toIso) {
  const from = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const to = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((to - from) / 86_400_000);
}

function isoOf(year, month0, day) {
  return new Date(Date.UTC(year, month0, day)).toISOString().slice(0, 10);
}

function yesterday(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1, d = +iso.slice(8, 10);
  return new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10);
}

// Given a set of completion dates (any order) and "today", compute:
// current_streak, longest_streak, completions_7d/30d, total, done_today.
export function computeRoutineStats(completionDates, todayIso) {
  const set = new Set(completionDates);

  // Current streak: walk backwards from today. If today isn't done, start
  // from yesterday — a streak isn't broken until you miss a full day.
  let current = 0;
  let cursor = todayIso;
  if (!set.has(cursor)) {
    const prev = yesterday(cursor);
    if (!set.has(prev)) return finish(0);
    cursor = prev;
  }
  while (set.has(cursor)) { current += 1; cursor = yesterday(cursor); }
  return finish(current);

  function finish(current) {
    const sorted = [...completionDates].sort();
    let longest = 0, run = 0, prev = null;
    for (const d of sorted) {
      run = (prev !== null && daysBetween(prev, d) === 1) ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = d;
    }
    let completions_7d = 0, completions_30d = 0;
    for (const d of completionDates) {
      const gap = daysBetween(d, todayIso);
      if (gap >= 0 && gap < 7) completions_7d += 1;
      if (gap >= 0 && gap < 30) completions_30d += 1;
    }
    return {
      current_streak: current, longest_streak: longest,
      completions_7d, completions_30d, total: completionDates.length,
      done_today: set.has(todayIso),
    };
  }
}

// Last N day-isos (oldest first) ending at todayIso, for the detail page's
// GitHub-contributions-style heatmap.
export function recentDaysGrid(completionDates, todayIso, days = 30) {
  const set = new Set(completionDates);
  const y = +todayIso.slice(0, 4), m = +todayIso.slice(5, 7) - 1, d = +todayIso.slice(8, 10);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const cell = new Date(Date.UTC(y, m, d - i));
    const iso = isoOf(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate());
    out.push({ date: iso, done: set.has(iso), isToday: iso === todayIso });
  }
  return out;
}

// ─── Summary-band analytics (30-day month block on the list screen) ───────

function lastNDays(todayIso, n) {
  const y = +todayIso.slice(0, 4), m = +todayIso.slice(5, 7) - 1, d = +todayIso.slice(8, 10);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(isoOf(y, m, d - i));
  return out;
}

// Per-day done/eligible across all active routines. Eligibility = the
// routine existed by that day, so a newly-added routine doesn't retroactively
// inflate "missed".
export function computeDailyRates(routines, todayIso, days) {
  const dates = lastNDays(todayIso, days);
  const completionSets = routines.map((r) => new Set(r.recent_completions));
  const createdOn = routines.map((r) => r.created_at.slice(0, 10));
  return dates.map((date) => {
    let done = 0, eligible = 0;
    for (let i = 0; i < routines.length; i++) {
      if (createdOn[i] > date) continue;
      eligible += 1;
      if (completionSets[i].has(date)) done += 1;
    }
    return { date, done, eligible, rate: eligible === 0 ? 0 : done / eligible };
  });
}

export function buildSummary(routines, todayIso) {
  const daily = computeDailyRates(routines, todayIso, 30);
  const t30 = daily.reduce((a, d) => ({ done: a.done + d.done, eligible: a.eligible + d.eligible }), { done: 0, eligible: 0 });
  const rate30 = t30.eligible === 0 ? 0 : t30.done / t30.eligible;
  const last7 = daily.slice(-7);
  const t7 = last7.reduce((a, d) => ({ done: a.done + d.done, eligible: a.eligible + d.eligible }), { done: 0, eligible: 0 });
  const rate7 = t7.eligible === 0 ? 0 : t7.done / t7.eligible;
  const bestStreak = routines.reduce(
    (best, r) => (r.stats.current_streak > best.streak ? { streak: r.stats.current_streak, name: r.name } : best),
    { streak: 0, name: '' },
  );
  return { daily, rate30, rate7, bestStreak };
}

// Month-block cell fill: recessed for a 0% day, else an ink wash that
// darkens with the day's completion rate.
export function monthCellBg(rate) {
  if (rate === 0) return 'var(--surface-2)';
  return `color-mix(in srgb, var(--ink) ${Math.round(8 + rate * 44)}%, transparent)`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function rangeLabel(daily) {
  if (!daily.length) return '';
  const fmt = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };
  return `${fmt(daily[0].date)} — ${fmt(daily[daily.length - 1].date)}`;
}

// 0 = Sunday … 6 = Saturday, for the first day of a series — pads the month
// block / heatmap so each day lands under its weekday column.
export function firstWeekday(daily) {
  if (!daily.length) return 0;
  return new Date(`${daily[0].date}T12:00:00Z`).getUTCDay();
}
