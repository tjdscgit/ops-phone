// Tasks — hand-built rather than descriptor-driven, because a task list is
// the one screen where you act on rows instead of opening them: ticking
// something off has to be one tap, from the list, without a round trip
// through a form.

import { sb, ref, refOptions, refName } from '../lib/db.js';
import {
  el, panel, hint, chips, toast, fail, confirmDelete, spinner,
  screenHead, sectionLabel, pill, tickBox, urgencyOf,
  today, ymd, addDays, niceDate, hhmm, humanise,
} from '../lib/ui.js';
import { go } from '../lib/router.js';

const PRIORITIES = [1, 2, 3, 4];

// Offsets are stored as minutes-before in a jsonb array; 0 means "at the due
// time". Only tasks with a due_time and at least one offset ever produce a
// push — see scripts/send-reminders.mjs.
const REMINDERS = [
  { value: 0, label: 'At time' },
  { value: 10, label: '10m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 180, label: '3h' },
  { value: 1440, label: '1 day' },
];

const FILTERS = [
  {
    label: 'Today',
    apply: (q) => q.eq('status', 'open').not('due_date', 'is', null).lte('due_date', today()),
    order: ['due_date', true],
  },
  {
    label: 'Open',
    apply: (q) => q.eq('status', 'open'),
    order: ['created_at', false],
  },
  {
    label: 'Waiting',
    apply: (q) => q.eq('status', 'waiting'),
    order: ['waiting_since', true],
  },
  {
    label: 'Someday',
    apply: (q) => q.eq('status', 'open').is('due_date', null),
    order: ['created_at', false],
  },
  {
    label: 'Done',
    apply: (q) => q.eq('status', 'done'),
    order: ['completed_at', false],
  },
];

export async function tasksList(mount) {
  const state = { filter: 0, q: '', limit: 50 };
  const body = el('div', {});
  const controls = el('div', { class: 'controls' });

  let timer;
  controls.append(el('input', {
    type: 'search', placeholder: 'Search tasks',
    autocapitalize: 'none', autocorrect: 'off',
    oninput: (e) => {
      clearTimeout(timer);
      const v = e.target.value.trim();
      timer = setTimeout(() => { state.q = v; state.limit = 50; load(); }, 250);
    },
  }));

  const paintFilters = () => {
    const next = chips(
      FILTERS.map((f, i) => ({ value: i, label: f.label })),
      state.filter,
      (i) => { state.filter = i; state.limit = 50; paintFilters(); load(); },
    );
    const old = controls.querySelector('.chips');
    if (old) old.replaceWith(next); else controls.append(next);
  };
  paintFilters();

  mount.replaceChildren(
    screenHead('Work', 'Tasks', {
      actions: [el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'New task',
        onclick: () => go('#/tasks/new'),
      }, '+')],
    }),
    controls,
    body,
  );

  async function load() {
    body.replaceChildren(spinner());
    const f = FILTERS[state.filter];

    let q = f.apply(sb.from('tasks').select(
      'id, title, status, due_date, due_time, priority, domain_id, project_id, waiting_on, completed_at',
    ));
    if (state.q) {
      const safe = state.q.replace(/[,()]/g, ' ');
      q = q.or(`title.ilike.%${safe}%,notes.ilike.%${safe}%`);
    }
    const { data, error } = await q
      .order(f.order[0], { ascending: f.order[1], nullsFirst: false })
      .limit(state.limit);

    if (error) { body.replaceChildren(hint(error.message)); return; }
    if (!data.length) { body.replaceChildren(hint('Nothing here.')); return; }

    const list = el('div', { class: 'list' });
    for (const t of data) list.append(taskRow(t, load));

    body.replaceChildren(
      list,
      data.length >= state.limit
        ? el('div', { class: 'controls', style: 'padding-top:16px' },
            el('button', { class: 'ghost', onclick: () => { state.limit += 50; load(); } }, 'Load more'))
        : null,
    );
  }

  await load();
}

// A row is a tick box plus a tappable body. The two are separate controls so
// that completing a task can never be mistaken for opening it.
export function taskRow(t, refresh) {
  const done = t.status === 'done';
  const waiting = t.status === 'waiting';
  const urgency = urgencyOf(t.due_date, t.status);

  const box = tickBox({
    done,
    waiting,
    label: done ? 'Mark task open' : 'Mark task done',
    onClick: async (e) => {
      e.stopPropagation();
      const { error } = await sb.from('tasks').update(
        done
          ? { status: 'open', completed_at: null }
          : { status: 'done', completed_at: new Date().toISOString() },
      ).eq('id', t.id);
      if (error) { fail(error); return; }
      toast(done ? 'Reopened' : 'Done');
      refresh?.();
    },
  });

  // The due state is a pill; everything else is plain mono meta. Keeping the
  // colour to one element per row is what stops the list looking like tinsel.
  const duePill = done
    ? null
    : urgency === 'over' ? pill('over', `Overdue ${niceDate(t.due_date)}`)
    : urgency === 'due' ? pill('due', t.due_time ? hhmm(t.due_time) : 'Today')
    : urgency === 'ok' ? pill('ok', niceDate(t.due_date))
    : null;

  const bits = [
    done && (t.completed_at ? `done ${niceDate(t.completed_at)}` : 'done'),
    !done && urgency === 'over' && hhmm(t.due_time),
    `P${t.priority ?? 4}`,
    refName('project', t.project_id) || refName('domain', t.domain_id),
    waiting && t.waiting_on && `waiting on ${t.waiting_on}`,
  ].filter(Boolean);

  const meta = el('div', { class: 'item-meta' });
  if (duePill) meta.append(duePill);
  for (const b of bits) meta.append(el('span', {}, b));

  return el('div', { class: `item row-item ${done ? 'done' : ''}` },
    box,
    el('button', {
      class: 'item-body', type: 'button',
      onclick: () => go(`#/tasks/${t.id}`),
    },
      el('div', {
        class: 'item-title serif',
        style: done ? 'color:var(--ink-3); text-decoration:line-through' : null,
      }, t.title),
      meta,
    ),
  );
}

// ─── Task form ───────────────────────────────────────────────────────────

export async function taskForm(mount, { id }) {
  const isNew = !id || id === 'new';
  let row = null;

  if (!isNew) {
    mount.replaceChildren(spinner());
    const { data, error } = await sb.from('tasks').select('*').eq('id', id).single();
    if (error) { mount.replaceChildren(hint(error.message)); return; }
    row = data;
  }

  const v = {
    title: row?.title ?? '',
    notes: row?.notes ?? '',
    status: row?.status ?? 'open',
    domain_id: row?.domain_id ?? null,
    project_id: row?.project_id ?? null,
    milestone_id: row?.milestone_id ?? null,
    due_date: row?.due_date ?? '',
    due_time: row?.due_time ? hhmm(row.due_time) : '',
    priority: row?.priority ?? 4,
    waiting_on: row?.waiting_on ?? '',
    reminder_offsets: Array.isArray(row?.reminder_offsets) ? row.reminder_offsets : [],
  };

  const title = el('textarea', {
    rows: 2, placeholder: 'What needs doing?', autocapitalize: 'sentences',
    oninput: (e) => { v.title = e.target.value; },
  });
  title.value = v.title;

  const notes = el('textarea', {
    rows: 4, placeholder: 'Notes', autocapitalize: 'sentences',
    oninput: (e) => { v.notes = e.target.value; },
  });
  notes.value = v.notes;

  const dateInput = el('input', {
    type: 'date',
    oninput: (e) => { v.due_date = e.target.value; paint(); },
  });
  dateInput.value = v.due_date;

  const timeInput = el('input', {
    type: 'time',
    oninput: (e) => { v.due_time = e.target.value; paint(); },
  });
  timeInput.value = v.due_time;

  const waiting = el('input', {
    type: 'text', placeholder: 'Who or what?', autocapitalize: 'sentences',
    oninput: (e) => { v.waiting_on = e.target.value; },
  });
  waiting.value = v.waiting_on;

  const slots = {
    when: el('div', {}), prio: el('div', {}), status: el('div', {}),
    folder: el('div', {}), project: el('div', {}), milestone: el('div', {}),
    reminders: el('div', {}), waitingField: el('div', { class: 'field' },
      el('label', {}, 'Waiting on'), waiting),
  };

  function paint() {
    const now = new Date();
    slots.when.replaceChildren(chips([
      { value: '', label: 'None' },
      { value: today(), label: 'Today' },
      { value: ymd(addDays(now, 1)), label: 'Tomorrow' },
      { value: ymd(addDays(now, (6 - now.getDay() + 7) % 7 || 7)), label: 'Weekend' },
      { value: ymd(addDays(now, 7)), label: 'Next week' },
    ], v.due_date, (d) => {
      v.due_date = d;
      dateInput.value = d;
      // A time with no date can never fire a reminder and reads as a bug in
      // the list, so clearing the date clears the time too.
      if (!d) { v.due_time = ''; timeInput.value = ''; }
      paint();
    }));

    slots.prio.replaceChildren(chips(
      PRIORITIES.map((p) => ({ value: p, label: `P${p}` })), v.priority,
      (p) => { v.priority = p; paint(); }));

    slots.status.replaceChildren(chips(
      ['open', 'waiting', 'done'].map((s) => ({ value: s, label: humanise(s) })), v.status,
      (s) => { v.status = s; paint(); }));

    slots.waitingField.classList.toggle('hidden', v.status !== 'waiting');

    slots.folder.replaceChildren(chips([
      { value: null, label: 'Inbox' },
      ...refOptions.domain(),
    ], v.domain_id, (d) => { v.domain_id = d; paint(); }));

    const projSel = el('select', {
      onchange: (e) => { v.project_id = e.target.value || null; v.milestone_id = null; paint(); },
    });
    projSel.append(el('option', { value: '' }, '—'));
    for (const o of refOptions.project()) projSel.append(el('option', { value: o.value }, o.label));
    projSel.value = v.project_id ?? '';
    slots.project.replaceChildren(projSel);

    // Milestones only make sense within a project, so the picker appears once
    // one is chosen and lists only that project's milestones.
    slots.milestone.replaceChildren();
    if (v.project_id) {
      const msSel = el('select', { onchange: (e) => { v.milestone_id = e.target.value || null; } });
      msSel.append(el('option', { value: '' }, '—'));
      for (const m of ref.milestones.filter((m) => m.project_id === v.project_id)) {
        msSel.append(el('option', { value: m.id }, m.title));
      }
      msSel.value = v.milestone_id ?? '';
      slots.milestone.replaceChildren(el('label', {}, 'Milestone'), msSel);
    }

    slots.reminders.replaceChildren(
      chipsMulti(REMINDERS, v.reminder_offsets, (next) => { v.reminder_offsets = next; paint(); }),
      v.reminder_offsets.length && !v.due_time
        ? hint('Reminders only fire for tasks with a due time — set one above.')
        : null,
    );
  }

  paint();

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add task' : 'Save');

  mount.replaceChildren(
    screenHead('Task', isNew ? 'New task' : (row?.title || 'Edit task'), {
      actions: [el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Back',
        onclick: () => go('#/tasks'),
      }, '‹')],
    }),
    panel(
      el('div', { class: 'field' }, el('label', {}, 'Task'), title),
      el('div', { class: 'field' }, el('label', {}, 'When'), slots.when,
        el('div', { class: 'row', style: 'margin-top:8px' }, dateInput, timeInput)),
      el('div', { class: 'field' }, el('label', {}, 'Remind me'), slots.reminders),
      el('div', { class: 'field' }, el('label', {}, 'Priority'), slots.prio),
      el('div', { class: 'field' }, el('label', {}, 'Folder'), slots.folder),
      el('div', { class: 'field' }, el('label', {}, 'Project'), slots.project),
      slots.milestone,
      el('div', { class: 'field' }, el('label', {}, 'Status'), slots.status),
      slots.waitingField,
      el('div', { class: 'field' }, el('label', {}, 'Notes'), notes),
    ),
    el('div', { style: 'padding: 0 20px' },
      save,
      isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete'),
    ),
  );

  async function onSave() {
    if (!v.title.trim()) { toast('Type something first.', 'err'); return; }
    save.disabled = true;

    const payload = {
      title: v.title.trim(),
      notes: v.notes.trim() || null,
      status: v.status,
      // domain_id is NOT NULL; no folder chosen means Inbox.
      domain_id: v.domain_id || ref.inbox?.id || ref.domains[0]?.id || null,
      project_id: v.project_id,
      milestone_id: v.milestone_id,
      due_date: v.due_date || null,
      due_time: v.due_time || null,
      priority: v.priority,
      waiting_on: v.status === 'waiting' ? (v.waiting_on.trim() || null) : null,
      waiting_since: v.status === 'waiting' ? (row?.waiting_since ?? today()) : null,
      reminder_offsets: v.reminder_offsets.length ? v.reminder_offsets : null,
      completed_at: v.status === 'done'
        ? (row?.completed_at ?? new Date().toISOString())
        : null,
    };
    if (isNew) payload.source = 'manual';

    // Changing when a task is due invalidates any reminder already recorded as
    // sent, otherwise the duplicate-guard suppresses the reminder for the new
    // time. Compared on normalised values — Postgres hands back '07:30:00'
    // where the form holds '07:30', which would otherwise read as a change on
    // every save and re-fire reminders that had already gone out.
    if (!isNew && (hhmm(row.due_time) !== (payload.due_time || '') ||
                   (row.due_date || null) !== payload.due_date)) {
      payload.reminders_sent = {};
    }

    const res = isNew
      ? await sb.from('tasks').insert(payload)
      : await sb.from('tasks').update(payload).eq('id', id);

    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Task added' : 'Saved');
    go('#/tasks');
  }

  async function onDelete() {
    if (!confirmDelete('this task')) return;
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/tasks');
  }
}

// Multi-select chips. The shared `chips` helper is single-select; reminders
// are the only place in the app that needs several values at once.
function chipsMulti(options, selected, onChange) {
  const wrap = el('div', { class: 'chips' });
  for (const opt of options) {
    const on = selected.includes(opt.value);
    wrap.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(on),
      onclick: () => onChange(
        on ? selected.filter((x) => x !== opt.value)
           : [...selected, opt.value].sort((a, b) => a - b),
      ),
    }, opt.label));
  }
  return wrap;
}
