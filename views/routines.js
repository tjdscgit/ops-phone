// Routines — a port of the dashboard's routines-view.tsx (list: facet rail +
// 30-day summary band + part-of-day sections + Completed/Paused) and
// [id]/page.tsx (detail: lifetime stats, goal progress, a heatmap, and the
// edit/archive/delete form collapsed below). Runs client-side against
// Supabase directly — the streak/rate math is ported from
// packages/shared/src/routine-stats.ts into lib/routines.js.

import { sb } from '../lib/db.js';
import {
  el, hint, spinner, pill, chips, toast, fail, confirmDelete,
  svg, sectionLabel, today, ymd, addDays, humanise, screenHead, panel,
} from '../lib/ui.js';
import { go } from '../lib/router.js';
import { openSheet } from '../app.js';
import {
  PART_ORDER, PART_LABEL, sortRoutines, formatTime, isMissed,
  computeRoutineStats, recentDaysGrid, buildSummary, monthCellBg, rangeLabel, firstWeekday,
} from '../lib/routines.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Completions are only fetched back this far — enough for the 30-day summary
// band and every routine's current/longest streak in practice, without
// pulling the whole history down over mobile data. A routine on a streak
// longer than this reads as exactly this long, same trade-off the dashboard
// API doesn't make (it has no such cap) but acceptable for a phone list.
const HISTORY_DAYS = 400;

function checkSvg() { return svg('<path d="M3 8l3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/>', 12); }
function chevronSvg() { return svg('<path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>', 14); }

// ─── List ───────────────────────────────────────────────────────────────

export async function routinesList(mount) {
  mount.replaceChildren(spinner());

  const t = today();
  const since = ymd(addDays(new Date(), -HISTORY_DAYS));
  const [routinesRes, doneRes] = await Promise.all([
    sb.from('routines').select('*').order('position', { ascending: true, nullsFirst: false }).order('name'),
    sb.from('routine_completions').select('routine_id, completed_date').gte('completed_date', since),
  ]);
  if (routinesRes.error) { mount.lastChild.replaceWith(hint(routinesRes.error.message)); return; }

  const byRoutine = new Map();
  for (const c of doneRes.data ?? []) {
    if (!byRoutine.has(c.routine_id)) byRoutine.set(c.routine_id, []);
    byRoutine.get(c.routine_id).push(c.completed_date);
  }

  // Attach computed stats to each row, same shape RoutineListItem carries on
  // the dashboard, so lib/routines.js's helpers can stay a faithful port.
  const all = (routinesRes.data ?? []).map((r) => {
    const dates = byRoutine.get(r.id) ?? [];
    return { ...r, recent_completions: dates, stats: computeRoutineStats(dates, t) };
  });

  const active = all.filter((r) => r.active);
  const completed = all.filter((r) => !r.active && r.archived_at)
    .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''));
  const paused = all.filter((r) => !r.active && !r.archived_at);

  let parts = new Set();
  let state = null; // 'open' | 'done' | null

  const layout = el('div', { class: 'work-layout' });
  mount.replaceChildren(layout);

  function togPart(v) { parts.has(v) ? parts.delete(v) : parts.add(v); render(); }
  function reset() { parts = new Set(); state = null; render(); }

  function render() {
    const doneCount = active.filter((r) => r.stats.done_today).length;
    const summary = buildSummary(active, t);

    const visible = active.filter((r) => {
      const bucket = r.time_of_day || 'anytime';
      if (parts.size && !parts.has(bucket)) return false;
      if (state === 'done' && !r.stats.done_today) return false;
      if (state === 'open' && r.stats.done_today) return false;
      return true;
    });

    const activeFilters = parts.size + (state ? 1 : 0);

    function buildFacetGroups() {
      return [
        facetGroup('Part of day', activeFilters > 0 ? clearBtn('Reset', reset) : null,
          ...PART_ORDER.map((p) => {
            const n = active.filter((r) => (r.time_of_day || 'anytime') === p).length;
            return n ? facetRow({ on: parts.has(p), name: PART_LABEL[p], count: n, onClick: () => togPart(p) }) : null;
          }).filter(Boolean),
        ),
        el('div', { class: 'facet-sep' }),
        facetGroup('Today', null,
          facetRow({ on: state === 'open', name: 'Remaining', count: active.length - doneCount, onClick: () => { state = state === 'open' ? null : 'open'; render(); } }),
          facetRow({ on: state === 'done', name: 'Done', count: doneCount, onClick: () => { state = state === 'done' ? null : 'done'; render(); } }),
        ),
      ];
    }

    const sections = [];
    for (const part of PART_ORDER) {
      const rows = visible.filter((r) => (r.time_of_day || 'anytime') === part).sort(sortRoutines);
      if (!rows.length) continue;
      const partAll = active.filter((r) => (r.time_of_day || 'anytime') === part);
      const partDone = partAll.filter((r) => r.stats.done_today).length;
      sections.push(el('section', { style: 'margin-top:26px' },
        el('div', { class: 'rt-part-head' },
          el('span', { class: 'rt-part-name' }, PART_LABEL[part]),
          el('span', { class: 'rt-part-count' }, `${partDone}/${partAll.length}`),
        ),
        el('div', {}, ...rows.map((r) => routineRow(r, t, refresh))),
      ));
    }

    const body = el('div', { class: 'work-body' },
      el('header', { class: 'screen-head', style: 'padding-top:0' },
        el('div', { class: 'row-actions' },
          el('div', {},
            el('div', { class: 'eyebrow' }, `Routines · ${doneCount}/${active.length} today`),
            el('h1', {}, 'Daily habits'),
          ),
          el('button', { class: 'work-cta', type: 'button', onclick: () => go('#/routines/new') }, '+ Add routine'),
        ),
      ),
      active.length > 0 ? summaryBand(summary) : null,
      active.length === 0 ? el('p', { class: 'briefing-empty', style: 'max-width:520px' },
        'No routines yet. Tap + Add routine to start tracking things like "read the Bible", "take meds", or "check email". Daily reset is automatic — your streak builds with each consecutive day.',
      ) : [
        ...sections,
        visible.length === 0 ? el('div', { class: 'work-empty' },
          el('div', { class: 'work-empty-title' }, 'Nothing in this view.'),
          el('p', { class: 'item-meta plain' }, 'Clear a filter on the left.'),
        ) : null,
      ],
      completed.length > 0 ? collapsibleSection(`Completed (${completed.length})`, completed.map((r) => archivedRow(r, true))) : null,
      paused.length > 0 ? collapsibleSection(`Paused (${paused.length})`, paused.map((r) => archivedRow(r, false))) : null,
    );

    const desktopRail = el('aside', { class: 'facet-rail' }, ...buildFacetGroups());
    const filtersBtn = el('button', {
      class: 'filters-fab', type: 'button',
      onclick: () => openSheet(el('div', {},
        el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'Filters')),
        el('div', { style: 'padding-top:8px' }, ...buildFacetGroups()),
      )),
    }, `Filters${activeFilters ? ` · ${activeFilters}` : ''}`);

    layout.replaceChildren(desktopRail, filtersBtn, body);
  }

  function refresh() { routinesList(mount); }

  render();
}

function summaryBand(summary) {
  const { daily, rate30, rate7, bestStreak } = summary;
  const pad = firstWeekday(daily);
  return el('div', { class: 'rt-summary' },
    el('div', {},
      el('div', { class: 'rt-monthblock' },
        ...WEEKDAYS.map((w, i) => el('span', { class: 'rt-weekday' }, w)),
        ...Array.from({ length: pad }, () => el('span', { class: 'rt-cell pad' })),
        ...daily.map((c, i) => el('span', {
          class: `rt-cell ${i === daily.length - 1 ? 'today' : ''}`,
          style: `background:${monthCellBg(c.rate)}`,
          title: `${c.date} — ${c.done} of ${c.eligible} kept`,
        })),
      ),
      el('div', { class: 'rt-range-label' }, `${rangeLabel(daily)} · darker is more kept`),
    ),
    el('div', { class: 'rt-stats' },
      el('div', {}, el('div', { class: 'rt-stat-value' }, `${Math.round(rate30 * 100)}%`), el('div', { class: 'rt-stat-label' }, 'Kept · 30d')),
      el('div', {}, el('div', { class: 'rt-stat-value' }, `${Math.round(rate7 * 100)}%`), el('div', { class: 'rt-stat-label' }, 'Last 7')),
      el('div', {},
        el('div', { class: `rt-stat-value ${bestStreak.streak ? 'accent' : 'dim'}` }, String(bestStreak.streak)),
        el('div', { class: 'rt-stat-label' }, bestStreak.streak ? `Day streak · ${bestStreak.name}` : 'Day streak'),
      ),
    ),
  );
}

function routineRow(r, t, refresh) {
  const isDone = r.stats.done_today;
  const missed = isMissed(r, t);
  const timeLabel = formatTime(r.specific_time);
  const streak = r.stats.current_streak;

  const tickBtn = el('button', {
    type: 'button', class: `tick ${isDone ? 'on' : ''}`, 'aria-label': isDone ? `Uncheck ${r.name}` : `Check off ${r.name}`,
    onclick: async () => {
      const { error } = isDone
        ? await sb.from('routine_completions').delete().eq('routine_id', r.id).eq('completed_date', t)
        : await sb.from('routine_completions').insert({ routine_id: r.id, completed_date: t });
      if (error) { fail(error); return; }
      refresh();
    },
  });
  if (isDone) tickBtn.append(checkSvg());

  return el('div', { class: 'rt-row' },
    tickBtn,
    el('button', { class: 'rt-row-main', type: 'button', onclick: () => go(`#/routines/${r.id}`) },
      el('span', { class: `rt-row-name ${isDone ? 'done' : missed ? 'missed' : ''}` }, r.name),
      missed ? el('span', { class: 'rt-row-badge', title: "A missed-routine push was sent today and it's still unchecked." }, '⚠ missed') : null,
      timeLabel ? el('span', { class: 'rt-row-time' }, timeLabel, r.reminder_enabled ? ' · 🔔' : '') : null,
      el('span', { class: 'rt-row-streak' }, el('b', { class: streak ? '' : 'dim' }, String(streak)), el('span', {}, streak === 1 ? 'day' : 'days')),
      el('span', { class: 'rt-row-chevron' }, chevronSvg()),
    ),
  );
}

function archivedRow(r, completed) {
  const archivedDate = completed && r.archived_at
    ? new Date(r.archived_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const streakLine = r.stats.longest_streak > 0 ? `Longest streak: ${r.stats.longest_streak} · ${r.stats.total} total` : null;
  const meta = [archivedDate ? `Archived ${archivedDate}` : null, streakLine].filter(Boolean).join(' · ');
  return el('div', { class: 'rt-archived' },
    el('div', { style: 'flex:1; min-width:0' },
      el('button', { class: 'rt-archived-name', type: 'button', onclick: () => go(`#/routines/${r.id}`) },
        r.name, completed && r.goal_days ? el('span', { style: 'margin-left:8px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent)' }, `✓ ${r.goal_days}d goal`) : null),
      meta ? el('div', { class: 'rt-archived-meta' }, meta) : null,
    ),
    el('button', {
      class: 'linkish', type: 'button', style: 'text-decoration:none; flex:0 0 auto',
      onclick: async () => {
        const { error } = await sb.from('routines').update({ active: true, archived_at: null }).eq('id', r.id);
        if (error) { fail(error); return; }
        toast('Reactivated');
        go('#/routines');
      },
    }, 'Reactivate'),
  );
}

function collapsibleSection(label, rows) {
  const details = el('details', { style: 'margin-top:30px' },
    el('summary', { class: 'eyebrow', style: 'cursor:pointer; list-style:none; padding-bottom:8px; border-bottom:1px solid var(--line)' }, label),
    el('div', {}, ...rows),
  );
  return details;
}

// Small local copies of the facet-rail row/group builders (see
// views/content.js's precedent — every ported list view keeps its own).
function facetGroup(label, action, ...children) { return el('div', { class: 'facet-group' }, el('div', { class: 'facet-group-head' }, el('span', { class: 'eyebrow' }, label), action ? el('div', {}, action) : null), ...children); }
function facetRow({ on, name, count, onClick }) { return el('button', { class: `facet-row ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, el('span', { class: 'facet-row-name' }, name), count != null ? el('span', { class: 'facet-row-count' }, String(count)) : null); }
function clearBtn(label, onClick) { return el('button', { class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.09em; text-decoration:none', onclick }, label); }

// ─── Detail ─────────────────────────────────────────────────────────────

export async function routineDetail(mount, { id }) {
  mount.replaceChildren(spinner());

  const t = today();
  const [routineRes, doneRes] = await Promise.all([
    sb.from('routines').select('*').eq('id', id).single(),
    sb.from('routine_completions').select('completed_date').eq('routine_id', id),
  ]);
  if (routineRes.error) { mount.replaceChildren(hint(routineRes.error.message)); return; }

  const routine = routineRes.data;
  const dates = (doneRes.data ?? []).map((c) => c.completed_date);
  const stats = computeRoutineStats(dates, t);
  const rate30 = stats.completions_30d / 30;
  const rate7 = stats.completions_7d / 7;

  function refresh() { routineDetail(mount, { id }); }

  // Heatmap window: active routine → 90 days back from today. Archived with
  // a goal → the goal-length window anchored at the archive date (shows the
  // run that earned it). Archived without a goal → 90 days through archive.
  let heatmapAnchor = t;
  let heatmapDays = 90;
  if (routine.archived_at) {
    heatmapAnchor = routine.archived_at.slice(0, 10);
    if (routine.goal_days) heatmapDays = routine.goal_days;
  }
  const grid = recentDaysGrid(dates, heatmapAnchor, heatmapDays);
  const heatmapLabel = routine.archived_at
    ? (routine.goal_days ? `Goal period (${routine.goal_days} days through ${heatmapAnchor})` : `Last 90 days through ${heatmapAnchor}`)
    : 'Last 90 days';
  const gridPad = new Date(`${grid[0].date}T12:00:00Z`).getUTCDay();

  const goalProgress = routine.active && routine.goal_days ? Math.min(stats.current_streak / routine.goal_days, 1) : null;

  const toggleBtn = el('button', {
    type: 'button', class: `tick ${stats.done_today ? 'on' : ''}`, style: 'width:32px; height:32px',
    'aria-label': stats.done_today ? 'Uncheck today' : 'Check off today',
    onclick: async () => {
      const { error } = stats.done_today
        ? await sb.from('routine_completions').delete().eq('routine_id', id).eq('completed_date', t)
        : await sb.from('routine_completions').insert({ routine_id: id, completed_date: t });
      if (error) { fail(error); return; }
      refresh();
    },
  });
  if (stats.done_today) toggleBtn.append(svg('<path d="M3 8l3 3 7-7" stroke-linecap="round" stroke-linejoin="round"/>', 16));

  mount.replaceChildren(el('div', { class: 'lib-reader' },
    el('div', { class: 'lib-crumb' }, el('button', { class: 'linkish', type: 'button', onclick: () => go('#/routines') }, '← Routines')),
    el('div', { style: 'margin-top:10px; display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:12px 20px' },
      el('div', {},
        el('div', { class: 'eyebrow' }, routine.active ? `Routine · ${PART_LABEL[routine.time_of_day] ?? humanise(routine.time_of_day)}` : 'Routine · Archived'),
        el('h1', { class: 'lib-reader-title' }, routine.name),
      ),
      routine.active ? pill(stats.done_today ? 'ok' : 'due', stats.done_today ? 'Done today' : 'Not done yet today') : null,
    ),
    routine.description ? el('div', { style: 'margin-top:14px; max-width:640px; font-family:var(--sans); font-size:14px; line-height:1.55; color:var(--ink-2); white-space:pre-wrap' }, routine.description) : null,

    routine.active ? el('div', { style: 'margin-top:22px; display:flex; align-items:center; gap:12px' },
      toggleBtn,
      el('span', { style: 'font-family:var(--sans); font-size:14px; color:var(--ink)' }, stats.done_today ? 'Done today' : 'Mark done for today'),
    ) : null,

    sectionShell('Stats',
      el('div', { style: 'display:grid; grid-template-columns:repeat(2,1fr); gap:16px' },
        detailStat('Current streak', `${stats.current_streak}d`, stats.current_streak > 0),
        detailStat('Longest streak', `${stats.longest_streak}d`),
        detailStat('7-day rate', `${Math.round(rate7 * 100)}%`),
        detailStat('30-day rate', `${Math.round(rate30 * 100)}%`),
      ),
      el('div', { style: 'margin-top:12px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' },
        `${stats.total} total ${stats.total === 1 ? 'completion' : 'completions'}`),
    ),

    goalProgress != null && routine.goal_days ? sectionShell('Goal progress',
      el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; margin-bottom:8px' },
        el('span', { class: 'rt-goal-value' }, String(stats.current_streak), el('small', {}, ` / ${routine.goal_days} days`)),
        el('span', { style: 'font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, `${Math.round(goalProgress * 100)}%`),
      ),
      el('div', { class: 'progress-bar' }, el('div', { class: 'progress-fill', style: `width:${Math.round(goalProgress * 100)}%; background:var(--ink)` })),
      stats.current_streak === 0 ? el('div', { style: 'margin-top:8px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' },
        'Streak reset. Mark today done to start counting toward the goal again.') : null,
    ) : null,

    sectionShell(heatmapLabel,
      el('div', { style: 'overflow-x:auto; padding-bottom:2px' },
        el('div', { class: 'rt-heatmap' },
          ...Array.from({ length: gridPad }, () => el('span', { class: 'rt-cell pad' })),
          ...grid.map((c) => el('span', {
            class: `rt-cell ${c.done ? 'done' : ''} ${c.isToday ? 'today' : ''}`,
            title: `${c.date}${c.isToday ? ' (today)' : ''} — ${c.done ? 'done' : 'missed'}`,
          })),
        ),
      ),
      el('div', { style: 'margin-top:8px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' },
        'Filled = done. Outlined = missed. Sun is top, Sat is bottom.'),
    ),

    el('section', { style: 'margin-top:36px' },
      (() => {
        const d = el('details', { style: 'border:1px solid var(--line)' },
          el('summary', { style: 'cursor:pointer; padding:10px 14px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); list-style:none' }, 'Edit routine ▾'),
          el('div', { style: 'padding:4px 16px 16px; border-top:1px solid var(--line)' }, routineForm(routine, refresh)),
        );
        return d;
      })(),
    ),
  ));
}

function sectionShell(label, ...children) {
  return el('section', { style: 'margin-top:30px' }, sectionLabel(label), el('div', { style: 'margin-top:2px' }, ...children));
}

function detailStat(label, value, accent) {
  return el('div', {},
    el('div', { style: `font-family:var(--serif); font-size:26px; line-height:1; color:${accent ? 'var(--accent)' : 'var(--ink)'}` }, value),
    el('div', { style: 'margin-top:5px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, label),
  );
}

// ─── Form (shared by the detail page's collapsed editor and /routines/new) ─

const GOAL_PRESETS = [
  { value: '', label: 'Ongoing (no end)' }, { value: '21', label: '21 days' }, { value: '30', label: '30 days' },
  { value: '60', label: '60 days' }, { value: '90', label: '90 days' }, { value: '100', label: '100 days' }, { value: '365', label: '365 days' },
];

function routineForm(row, onSaved) {
  const isNew = !row?.id;
  const v = {
    name: row?.name ?? '', description: row?.description ?? '', time_of_day: row?.time_of_day ?? 'anytime',
    specific_time: row?.specific_time ? String(row.specific_time).slice(0, 5) : '',
    reminder_enabled: row?.reminder_enabled ?? false, goal_days: row?.goal_days ?? null,
  };

  const name = el('input', { type: 'text', placeholder: 'Read the Bible', oninput: (e) => { v.name = e.target.value; } }); name.value = v.name;
  const desc = el('textarea', { rows: 3, placeholder: "Optional — context, what counts, why you're tracking it…", oninput: (e) => { v.description = e.target.value; } }); desc.value = v.description;
  const timeInput = el('input', { type: 'time', oninput: (e) => { v.specific_time = e.target.value; paintReminder(); } }); timeInput.value = v.specific_time;

  const reminderCb = el('input', { type: 'checkbox', checked: v.reminder_enabled, onchange: (e) => { v.reminder_enabled = e.target.checked; } });
  const reminderRow = el('label', { class: 'check' }, reminderCb, el('span', {}, 'Send a push reminder at this time'));
  function paintReminder() {
    const has = Boolean(v.specific_time.trim());
    reminderCb.disabled = !has;
    if (!has) { v.reminder_enabled = false; reminderCb.checked = false; }
    reminderRow.style.opacity = has ? '1' : '0.5';
  }
  paintReminder();

  const partSlot = el('div', {});
  const paintPart = () => partSlot.replaceChildren(chips(
    PART_ORDER.map((p) => ({ value: p, label: PART_LABEL[p] })), v.time_of_day,
    (p) => { v.time_of_day = p; paintPart(); }));
  paintPart();

  const initialGoal = v.goal_days != null ? String(v.goal_days) : '';
  const initialPreset = GOAL_PRESETS.some((p) => p.value === initialGoal) ? initialGoal : '';
  let presetGoal = initialPreset;
  let customGoal = initialGoal && !initialPreset ? initialGoal : '';
  const presetSel = el('select', {
    onchange: (e) => { presetGoal = e.target.value; if (presetGoal) { customGoal = ''; customInput.value = ''; } paintGoalNote(); },
  });
  for (const p of GOAL_PRESETS) presetSel.append(el('option', { value: p.value }, p.label));
  presetSel.value = presetGoal;
  const customInput = el('input', {
    type: 'number', min: '1', step: '1', inputmode: 'numeric', placeholder: 'Custom (days)',
    oninput: (e) => { customGoal = e.target.value; if (customGoal) { presetGoal = ''; presetSel.value = ''; } paintGoalNote(); },
  });
  customInput.value = customGoal;
  const goalNote = el('div', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' });
  function paintGoalNote() {
    const eff = (customGoal || '').trim() || presetGoal;
    goalNote.textContent = eff ? `Auto-archive when streak hits ${eff} day${eff === '1' ? '' : 's'}.` : 'No goal — keeps running indefinitely.';
  }
  paintGoalNote();

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Create routine' : 'Save changes');
  const wrap = el('div', {},
    field('Name', name),
    field('Description', desc),
    el('div', { class: 'row' }, field('Time of day', partSlot), field('Specific time (optional)', timeInput)),
    reminderRow,
    field('Streak goal', el('div', { class: 'row' }, presetSel, customInput)),
    goalNote,
    el('div', { class: 'form-actions', style: 'margin-top:14px' }, save),
  );

  if (!isNew) {
    wrap.append(el('div', { style: 'margin-top:20px; padding-top:14px; border-top:1px solid var(--line)' },
      el('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Archive or delete'),
      el('p', { style: 'font-family:var(--sans); font-size:12.5px; color:var(--ink-3); line-height:1.5; margin-bottom:10px' },
        "Archiving keeps the streak history but hides the routine from today's list. Deleting wipes everything, including completion history."),
      el('div', { class: 'row' },
        el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: onArchive }, 'Archive'),
        el('button', { class: 'ghost danger', style: 'width:auto', type: 'button', onclick: onDelete }, 'Delete forever'),
      ),
    ));
  }

  async function onSave() {
    if (!v.name.trim()) { toast('Name is required.', 'err'); return; }
    save.disabled = true;
    const effGoal = (customGoal || '').trim() || presetGoal;
    const goalNum = effGoal ? Number(effGoal) : NaN;
    const payload = {
      name: v.name.trim(), description: v.description.trim() || null, time_of_day: v.time_of_day,
      specific_time: v.specific_time || null,
      reminder_enabled: v.specific_time ? v.reminder_enabled : false,
      goal_days: Number.isFinite(goalNum) && goalNum > 0 ? Math.floor(goalNum) : null,
    };
    const res = isNew ? await sb.from('routines').insert(payload).select('id').single() : await sb.from('routines').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Routine created' : 'Saved');
    if (isNew) go(`#/routines/${res.data.id}`); else onSaved?.();
  }
  async function onArchive() {
    const { error } = await sb.from('routines').update({ active: false, archived_at: new Date().toISOString() }).eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Archived');
    go('#/routines');
  }
  async function onDelete() {
    if (!confirmDelete('this routine and its completion history')) return;
    const { error } = await sb.from('routines').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/routines');
  }
  return wrap;
}

function field(label, node) { return el('div', { class: 'field' }, el('label', {}, label), node); }

// A port of /routines/new/page.tsx: the same "← Routines" crumb + ScreenHeader
// + hairline pattern every other create/edit page uses (task-form.tsx's
// /tasks/new, notably) — not the Library-only reader style.
export async function routineNew(mount) {
  mount.replaceChildren(
    el('div', { class: 'lib-crumb' }, el('button', { class: 'linkish', type: 'button', onclick: () => go('#/routines') }, '← Routines')),
    screenHead('Routines', 'New routine'),
    el('div', { class: 'hairline', style: 'margin-bottom:16px' }),
    panel(routineForm(null)),
  );
}
