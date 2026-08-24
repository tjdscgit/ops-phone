// Routines — a daily tick list.
//
// Hand-built because completion is a row in a second table keyed by date, not
// a column on the routine, so "done today" is a join the generic list view
// has no way to express.

import { sb } from '../lib/db.js';
import {
  el, panel, hint, chips, toast, fail, confirmDelete, spinner,
  screenHead, sectionLabel, tickBox, pill,
  today, ymd, addDays, humanise,
} from '../lib/ui.js';
import { go } from '../lib/router.js';

const SLOTS = ['morning', 'afternoon', 'evening', 'anytime'];

export async function routinesList(mount) {
  mount.replaceChildren(
    screenHead('Daily', 'Routines', {
      actions: [el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'New routine',
        onclick: () => go('#/routines/new'),
      }, '+')],
    }),
    spinner(),
  );

  const t = today();
  // A fortnight of history is enough to show a streak without pulling the
  // whole completion log down over mobile data.
  const since = ymd(addDays(new Date(), -30));

  const [routinesRes, doneRes] = await Promise.all([
    sb.from('routines').select('*').is('archived_at', null)
      .order('position', { ascending: true, nullsFirst: false }).order('name'),
    sb.from('routine_completions').select('routine_id, completed_date').gte('completed_date', since),
  ]);

  if (routinesRes.error) {
    mount.lastChild.replaceWith(hint(routinesRes.error.message));
    return;
  }

  const routines = routinesRes.data ?? [];
  const completions = doneRes.data ?? [];

  // routine_id → Set of ISO dates
  const byRoutine = new Map();
  for (const c of completions) {
    if (!byRoutine.has(c.routine_id)) byRoutine.set(c.routine_id, new Set());
    byRoutine.get(c.routine_id).add(c.completed_date);
  }

  if (!routines.length) {
    mount.lastChild.replaceWith(hint('No routines yet.'));
    return;
  }

  const body = el('div', {});
  // Grouped by time of day so the morning list isn't buried under the
  // evening one at 5am.
  for (const slot of SLOTS) {
    const inSlot = routines.filter((r) => (r.time_of_day || 'anytime') === slot);
    if (!inSlot.length) continue;

    const list = el('div', { class: 'list' });
    for (const r of inSlot) list.append(routineRow(r, byRoutine.get(r.id) ?? new Set(), t));
    const doneCount = inSlot.filter((r) => (byRoutine.get(r.id) ?? new Set()).has(t)).length;
    body.append(
      sectionLabel(humanise(slot),
        pill(doneCount === inSlot.length ? 'ok' : 'quiet', `${doneCount}/${inSlot.length}`, false)),
      list,
    );
  }

  mount.lastChild.replaceWith(body);
}

// Counts back from today. Today not being done yet doesn't break the streak —
// it just isn't counted, otherwise every streak reads as zero until evening.
export function streakOf(dates, t) {
  let n = 0;
  let cursor = dates.has(t) ? new Date(t + 'T00:00:00') : addDays(new Date(t + 'T00:00:00'), -1);
  while (dates.has(ymd(cursor))) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

function routineRow(r, dates, t) {
  const done = dates.has(t);
  const streak = streakOf(dates, t);

  const tick = tickBox({
    done,
    label: done ? 'Undo' : 'Mark done',
    onClick: async () => {
      if (done) {
        const { error } = await sb.from('routine_completions').delete()
          .eq('routine_id', r.id).eq('completed_date', t);
        if (error) { fail(error); return; }
        toast('Undone');
      } else {
        const { error } = await sb.from('routine_completions')
          .insert({ routine_id: r.id, completed_date: t });
        if (error) { fail(error); return; }
        toast('Done');
      }
      go('#/routines');
      // go() re-renders in place when the hash already matches, which is the
      // case here — so the list reloads with fresh completions.
    },
  });

  const bits = [
    streak > 0 && `${streak} day streak`,
    r.goal_days && `goal ${r.goal_days}`,
    r.specific_time && String(r.specific_time).slice(0, 5),
  ].filter(Boolean);

  return el('div', { class: `item row-item ${done ? 'done' : ''}` },
    tick,
    el('button', {
      class: 'item-body', type: 'button', onclick: () => go(`#/routines/${r.id}`),
    },
      el('div', { class: 'item-title serif' }, r.name),
      bits.length ? el('div', { class: 'item-meta' }, bits.join(' · ')) : null,
    ),
  );
}

// ─── Routine form ────────────────────────────────────────────────────────

export async function routineForm(mount, { id }) {
  const isNew = !id || id === 'new';
  let row = null;

  if (!isNew) {
    mount.replaceChildren(spinner());
    const { data, error } = await sb.from('routines').select('*').eq('id', id).single();
    if (error) { mount.replaceChildren(hint(error.message)); return; }
    row = data;
  }

  const v = {
    name: row?.name ?? '',
    description: row?.description ?? '',
    time_of_day: row?.time_of_day ?? 'anytime',
    specific_time: row?.specific_time ? String(row.specific_time).slice(0, 5) : '',
    goal_days: row?.goal_days ?? '',
    active: row ? row.active !== false : true,
    position: row?.position ?? '',
  };

  const name = el('input', {
    type: 'text', placeholder: 'Routine name', autocapitalize: 'sentences',
    oninput: (e) => { v.name = e.target.value; },
  });
  name.value = v.name;

  const desc = el('textarea', {
    rows: 3, placeholder: 'What does it involve?', autocapitalize: 'sentences',
    oninput: (e) => { v.description = e.target.value; },
  });
  desc.value = v.description;

  const time = el('input', { type: 'time', oninput: (e) => { v.specific_time = e.target.value; } });
  time.value = v.specific_time;

  const goal = el('input', {
    type: 'number', min: '1', placeholder: 'e.g. 30',
    oninput: (e) => { v.goal_days = e.target.value; },
  });
  goal.value = v.goal_days;

  const activeBox = el('input', { type: 'checkbox', onchange: (e) => { v.active = e.target.checked; } });
  activeBox.checked = v.active;

  const slot = el('div', {});
  const paint = () => slot.replaceChildren(chips(
    SLOTS.map((s) => ({ value: s, label: humanise(s) })), v.time_of_day,
    (s) => { v.time_of_day = s; paint(); }));
  paint();

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add routine' : 'Save');

  mount.replaceChildren(
    screenHead('Routine', isNew ? 'New routine' : (row?.name || 'Edit routine'), {
      actions: [el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Back',
        onclick: () => go('#/routines'),
      }, '‹')],
    }),
    panel(
      el('div', { class: 'field' }, el('label', {}, 'Name'), name),
      el('div', { class: 'field' }, el('label', {}, 'Time of day'), slot),
      el('div', { class: 'field' }, el('label', {}, 'Specific time'), time),
      el('div', { class: 'field' }, el('label', {}, 'Goal (days)'), goal),
      el('div', { class: 'field' }, el('label', {}, 'Description'), desc),
      el('div', { class: 'field' },
        el('label', { class: 'check' }, activeBox, el('span', {}, 'Active'))),
    ),
    el('div', { style: 'padding: 0 20px' },
      save,
      isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete'),
    ),
  );

  async function onSave() {
    if (!v.name.trim()) { toast('Name required', 'err'); return; }
    save.disabled = true;

    const payload = {
      name: v.name.trim(),
      description: v.description.trim() || null,
      time_of_day: v.time_of_day,
      specific_time: v.specific_time || null,
      goal_days: v.goal_days === '' ? null : Number(v.goal_days),
      active: v.active,
      position: v.position === '' ? null : Number(v.position),
    };

    const res = isNew
      ? await sb.from('routines').insert(payload)
      : await sb.from('routines').update(payload).eq('id', id);

    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Routine added' : 'Saved');
    go('#/routines');
  }

  async function onDelete() {
    // Completions are the streak history; deleting the routine takes them
    // with it via the foreign key, so this is worth confirming.
    if (!confirmDelete('this routine and its history')) return;
    const { error } = await sb.from('routines').delete().eq('id', id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/routines');
  }
}
