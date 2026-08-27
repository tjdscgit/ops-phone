// Tasks — hand-built rather than descriptor-driven, because a task list is
// the one screen where you act on rows instead of opening them: ticking
// something off has to be one tap, from the list, without a round trip
// through a form.
//
// The list screen is a port of the dashboard's tasks-view.tsx: a facet rail
// (View / Domain / Priority), five date-window groups (Overdue / Today /
// Upcoming / No date / Waiting) or a by-project grouping, and a collapsible
// Completed-today section.
//
// Desktop (≥800px) additionally splits into a 3-pane workspace — nav rail
// (app.js) | this list pane, with a filter dropdown replacing the old
// permanent facet-rail sidebar | a detail pane for the selected task, read
// view with an Edit button rather than a page-navigating form. Phone stays
// exactly as it was: tapping a row still opens the full-page editor at
// /tasks/:id (taskForm, further down this file), and the mobile Filters
// bottom sheet is untouched.

import { sb, ref, refName } from '../lib/db.js';
import {
  el, panel, hint, toast, fail, confirmDelete, spinner,
  screenHead, pill, tickBox, openContextMenu,
  today, niceDate, hhmm, ymd, addDays, localDateOf,
} from '../lib/ui.js';
import { go, render as rerenderRoute } from '../lib/router.js';
import { domainColor } from '../lib/domain-colors.js';
import { openSheet, closeSheet } from '../app.js';

const REMINDERS = [
  { value: 0, label: 'At time' },
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
];

const RECURRENCE_OPTIONS = [
  { value: '', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays (Mon-Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'semiannually', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
];

const PRIORITIES = [[1, '1 · Urgent'], [2, '2 · High'], [3, '3 · Medium'], [4, '4 · Low (default)']];

const DESKTOP_MQ = '(min-width: 800px)';
const isDesktop = () => window.matchMedia(DESKTOP_MQ).matches;

// ─── Due-date grouping ─────────────────────────────────────────────────
// A port of tasks-view.tsx's dueInfo/groupOf — the same day-window logic
// that decides which of the five sections a task lands in.

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
function weekdayName(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
}
function dueInfo(due, t) {
  if (!due) return { state: 'none', text: '', group: 'No date' };
  if (due < t) return { state: 'over', text: `Overdue ${daysBetween(due, t)}d`, group: 'Overdue' };
  if (due === t) return { state: 'due', text: 'Due today', group: 'Today' };
  const ahead = daysBetween(t, due);
  const text = ahead === 1 ? 'Due tomorrow' : ahead < 7 ? `Due ${weekdayName(due)}` : `Due ${due.slice(5).replace('-', '/')}`;
  return { state: 'future', text, group: 'Upcoming' };
}
function groupOf(t, today_) {
  return t.status === 'waiting' ? 'Waiting' : dueInfo(t.due_date, today_).group;
}

const GROUPS = ['Overdue', 'Today', 'Upcoming', 'No date', 'Waiting'];
const VIEWS = [['all', 'All'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['project', 'Project']];

function fmtTime12(hm) {
  if (!hm) return '—';
  const [hStr, m] = hm.split(':');
  const h24 = parseInt(hStr, 10);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${m} ${ampm}`;
}

// ─── Shared field builders ─────────────────────────────────────────────
// Pulled out of taskForm so the full-page/dialog editor and the desktop
// inline detail pane build identical controls from one place. Each returns
// a DOM node and calls `onChange` with the new value(s) — callers own their
// own state and any side effects (e.g. resetting milestone_id when the
// project changes; there's no DB constraint tying milestones.project_id to
// tasks.project_id, so that reset has to happen explicitly at every call
// site that uses buildDomainProjectSelect).

function buildPrioritySelect(value, onChange) {
  const sel = el('select', { onchange: (e) => onChange(Number(e.target.value)) });
  for (const [val, label] of PRIORITIES) sel.append(el('option', { value: val }, label));
  sel.value = value;
  return sel;
}

function buildDomainProjectSelect({ projects, domains, inbox, domainId, projectId, onChange }) {
  const sel = el('select', {
    onchange: (e) => {
      const val = e.target.value;
      if (val.startsWith('project:')) onChange({ project_id: val.slice(8), domain_id: null });
      else if (val.startsWith('domain:')) onChange({ project_id: null, domain_id: val.slice(7) });
    },
  });
  const projectsByDomain = new Map();
  const orphanProjects = [];
  for (const p of projects) {
    if (p.domain_id) { const list = projectsByDomain.get(p.domain_id) ?? []; list.push(p); projectsByDomain.set(p.domain_id, list); }
    else orphanProjects.push(p);
  }
  if (inbox) sel.append(el('option', { value: `domain:${inbox.id}` }, '📥 Inbox (default — for unsorted tasks)'));
  for (const d of domains) {
    const grp = el('optgroup', { label: d.name });
    grp.append(el('option', { value: `domain:${d.id}` }, `${d.name} (domain)`));
    for (const p of projectsByDomain.get(d.id) ?? []) grp.append(el('option', { value: `project:${p.id}` }, p.name));
    sel.append(grp);
  }
  if (orphanProjects.length) {
    const grp = el('optgroup', { label: 'Other projects' });
    for (const p of orphanProjects) grp.append(el('option', { value: `project:${p.id}` }, p.name));
    sel.append(grp);
  }
  sel.value = projectId ? `project:${projectId}` : `domain:${domainId ?? inbox?.id ?? ''}`;
  return sel;
}

function buildMilestoneSlot({ milestones, projectId, milestoneId, onChange }) {
  const slot = el('div', {});
  if (!projectId) return slot;
  const opts = milestones.filter((m) => m.project_id === projectId);
  if (!opts.length) return slot;
  const sel = el('select', { onchange: (e) => onChange(e.target.value || null) });
  sel.append(el('option', { value: '' }, 'General (no milestone)'));
  for (const m of opts) sel.append(el('option', { value: m.id }, m.title));
  sel.value = milestoneId ?? '';
  slot.append(sel);
  return slot;
}

function buildContentItemSelect({ contentItems, value, onChange }) {
  const sel = el('select', { onchange: (e) => onChange(e.target.value || null) });
  sel.append(el('option', { value: '' }, '(none)'));
  for (const c of contentItems.filter((c) => c.status !== 'done' && c.status !== 'published')) {
    sel.append(el('option', { value: c.id }, c.title));
  }
  sel.value = value ?? '';
  return sel;
}

function buildReminderSelect({ value, onChange }) {
  const sel = el('select', { onchange: (e) => onChange(e.target.value === '' ? [] : [Number(e.target.value)]) });
  sel.append(el('option', { value: '' }, 'No reminder'));
  for (const r of REMINDERS) sel.append(el('option', { value: r.value }, r.value === 0 ? 'At due time' : `${r.label} before`));
  sel.value = value?.length ? String(Math.min(...value)) : '';
  return sel;
}

function buildRecurrenceSelect({ value, onChange }) {
  const sel = el('select', { onchange: (e) => onChange(e.target.value) });
  for (const r of RECURRENCE_OPTIONS) sel.append(el('option', { value: r.value }, r.label));
  sel.value = value ?? '';
  return sel;
}

// Builds the Supabase update payload from a `v`-shaped field bag, plus
// whether `reminders_sent` needs clearing (a due-date/time change
// invalidates any reminder already recorded as sent, otherwise the
// duplicate-guard suppresses the reminder for the new time — compared on
// normalised values since Postgres hands back '07:30:00' where the form
// holds '07:30').
function buildTaskSavePayload(v, { row, isNew }) {
  const payload = {
    title: v.title.trim(),
    notes: v.notes.trim() || null,
    domain_id: v.domain_id || ref.inbox?.id || ref.domains[0]?.id || null,
    project_id: v.project_id,
    milestone_id: v.milestone_id,
    content_item_id: v.content_item_id,
    due_date: v.due_date || null,
    due_time: v.due_time || null,
    priority: v.priority,
    reminder_offsets: v.reminder_offsets.length ? v.reminder_offsets : null,
    recurrence_rule: v.recurrence_rule || null,
  };
  if (isNew) { payload.source = 'manual'; payload.status = 'open'; }
  const clearReminders = !isNew && (hhmm(row.due_time) !== (payload.due_time || '') || (row.due_date || null) !== payload.due_date);
  return { payload, clearReminders };
}

// ─── Clock-dial time picker ─────────────────────────────────────────────
// A custom control rather than a native <input type="time"> — the native
// picker's UI (a scrolling number-column popup on most platforms) is
// entirely owned by the OS/browser and can't be restyled at all.

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function parseHHMM(hm) {
  if (!hm) return { hour: 9, minute: 0, ampm: 'AM' };
  const [hStr, mStr] = hm.split(':');
  const h24 = parseInt(hStr, 10);
  const minute = parseInt(mStr, 10) || 0;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let hour = h24 % 12; if (hour === 0) hour = 12;
  return { hour, minute, ampm };
}
function toHHMM(hour12, minute, ampm) {
  let h = hour12 % 12;
  if (ampm === 'PM') h += 12;
  return `${pad2(h)}:${pad2(minute)}`;
}
const DIAL_C = 110, DIAL_R = 82;
function dialPos(slot12) {
  const angle = (slot12 % 12) * 30 - 90;
  const rad = angle * Math.PI / 180;
  return { x: DIAL_C + DIAL_R * Math.cos(rad), y: DIAL_C + DIAL_R * Math.sin(rad) };
}
function svgEl(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function openClockDial({ initialHHMM, onConfirm }) {
  const start = parseHHMM(initialHHMM);
  const state = { mode: 'hour', hour: start.hour, minute: start.minute, ampm: start.ampm };

  const readoutHour = el('button', { class: 'tp-seg', type: 'button', onclick: () => { state.mode = 'hour'; paint(); } });
  const readoutMinute = el('button', { class: 'tp-seg', type: 'button', onclick: () => { state.mode = 'minute'; paint(); } });
  const amBtn = el('button', { type: 'button', onclick: () => { state.ampm = 'AM'; paint(); } }, 'AM');
  const pmBtn = el('button', { type: 'button', onclick: () => { state.ampm = 'PM'; paint(); } }, 'PM');

  const svg = svgEl('svg', { class: 'clock-svg', viewBox: '0 0 220 220', width: '220', height: '220' });
  svg.append(
    svgEl('circle', { cx: 110, cy: 110, r: 90, fill: 'var(--surface-2)', stroke: 'var(--line-strong)', 'stroke-width': 1 }),
    svgEl('circle', { cx: 110, cy: 110, r: 4, fill: 'var(--ink-3)' }),
  );
  const hand = svgEl('line', { x1: 110, y1: 110, x2: 110, y2: 28, stroke: 'var(--accent)', 'stroke-width': 2 });
  const handDot = svgEl('circle', { cx: 110, cy: 28, r: 17, fill: 'var(--accent)', opacity: 0.22 });
  svg.append(hand, handDot);

  const dial = el('div', { class: 'clock-dial' }, svg);
  const marksWrap = el('div', {});
  dial.append(marksWrap);

  function paintMarks() {
    marksWrap.replaceChildren();
    if (state.mode === 'hour') {
      for (let h = 1; h <= 12; h++) {
        const p = dialPos(h);
        marksWrap.append(el('button', {
          class: `dial-num ${h === state.hour ? 'active' : ''}`, type: 'button',
          style: `left:${p.x}px; top:${p.y}px`,
          onclick: () => { state.hour = h; state.mode = 'minute'; paint(); },
        }, String(h)));
      }
    } else {
      for (let k = 0; k < 12; k++) {
        const slot = k === 0 ? 12 : k;
        const p = dialPos(slot);
        const mv = k * 5;
        marksWrap.append(el('button', {
          class: `dial-num ${mv === state.minute ? 'active' : ''}`, type: 'button',
          style: `left:${p.x}px; top:${p.y}px`,
          onclick: () => { state.minute = mv; paint(); },
        }, pad2(mv)));
      }
    }
  }

  function paint() {
    readoutHour.textContent = String(state.hour);
    readoutHour.classList.toggle('active', state.mode === 'hour');
    readoutMinute.textContent = pad2(state.minute);
    readoutMinute.classList.toggle('active', state.mode === 'minute');
    amBtn.classList.toggle('active', state.ampm === 'AM');
    pmBtn.classList.toggle('active', state.ampm === 'PM');
    const target = state.mode === 'hour' ? dialPos(state.hour) : dialPos(state.minute === 0 ? 12 : Math.round(state.minute / 5));
    hand.setAttribute('x2', target.x); hand.setAttribute('y2', target.y);
    handDot.setAttribute('cx', target.x); handDot.setAttribute('cy', target.y);
    paintMarks();
  }
  paint();

  const panelNode = el('div', { class: 'time-picker-panel' },
    el('div', { class: 'time-picker-readout' },
      readoutHour, el('span', { class: 'tp-colon' }, ':'), readoutMinute,
      el('div', { class: 'tp-ampm' }, amBtn, pmBtn),
    ),
    dial,
    el('div', { class: 'time-picker-actions' },
      el('button', { class: 'ghost small', type: 'button', onclick: () => closeSheet() }, 'Cancel'),
      el('button', { class: 'detail-btn solid', type: 'button', onclick: () => { closeSheet(); onConfirm(toHHMM(state.hour, state.minute, state.ampm)); } }, 'OK'),
    ),
  );
  openSheet(panelNode, { dialog: true, compact: true });
}

// ─── List + detail workspace (desktop) / list screen (phone) ─────────────

export async function tasksList(mount) {
  mount.replaceChildren(spinner());

  const [tasksRes, projectsRes] = await Promise.all([
    sb.from('tasks').select(
      'id, title, notes, status, due_date, due_time, priority, domain_id, project_id, milestone_id, content_item_id, waiting_on, waiting_since, completed_at, top3_for_date, created_at, source, recurrence_rule, reminder_offsets',
    ),
    // ref.projects (loaded once for FK pickers app-wide) carries no
    // domain_id, so the domain/project grouped picker needs its own fetch —
    // hoisted here (once) rather than inside the field builder, so opening
    // the desktop detail pane's Edit mode never triggers a network round trip.
    sb.from('projects').select('id, name, domain_id').eq('status', 'active').order('name'),
  ]);
  if (tasksRes.error) { mount.lastChild.replaceWith(hint(tasksRes.error.message)); return; }

  const all = tasksRes.data ?? [];
  const projectsWithDomain = projectsRes.data ?? [];

  let view = 'all';
  const dsel = new Set();
  const psel = new Set();
  let showDone = false;
  let filterOpen = false;

  let selectedTaskId = null;
  let editMode = false;
  let draft = {};
  const rowNodesById = new Map();

  const t = today();
  const workspace = el('div', { class: 'tasks-workspace' });
  mount.lastChild.replaceWith(workspace);

  const listPane = el('section', { class: 'tasks-list-pane' });
  const detailPane = el('section', { class: 'tasks-detail-pane' });
  workspace.replaceChildren(listPane, detailPane);

  const findSelected = () => all.find((x) => x.id === selectedTaskId) ?? null;
  const isDirty = () => Object.keys(draft).length > 0;

  function selectTask(id) {
    if (editMode && isDirty() && !confirm('Discard unsaved changes?')) return;
    if (selectedTaskId != null) rowNodesById.get(selectedTaskId)?.classList.remove('selected');
    selectedTaskId = id;
    draft = {};
    editMode = false;
    rowNodesById.get(id)?.classList.add('selected');
    renderDetail();
  }

  function startEdit() { editMode = true; draft = {}; renderDetail(); }
  function cancelEdit() {
    if (isDirty() && !confirm('Discard unsaved changes?')) return;
    editMode = false; draft = {}; renderDetail();
  }

  async function saveEdit(saveBtn) {
    const row = findSelected();
    if (!row) return;
    const v = {
      title: draft.title ?? row.title,
      notes: draft.notes ?? (row.notes ?? ''),
      domain_id: draft.domain_id !== undefined ? draft.domain_id : row.domain_id,
      project_id: draft.project_id !== undefined ? draft.project_id : row.project_id,
      milestone_id: draft.milestone_id !== undefined ? draft.milestone_id : row.milestone_id,
      content_item_id: draft.content_item_id !== undefined ? draft.content_item_id : row.content_item_id,
      due_date: draft.due_date ?? (row.due_date ?? ''),
      due_time: draft.due_time ?? (row.due_time ? hhmm(row.due_time) : ''),
      priority: draft.priority ?? row.priority,
      reminder_offsets: draft.reminder_offsets ?? (Array.isArray(row.reminder_offsets) ? row.reminder_offsets : []),
      recurrence_rule: draft.recurrence_rule ?? (row.recurrence_rule ?? ''),
    };
    if (!v.title.trim()) { toast('Type something first.', 'err'); return; }
    saveBtn.disabled = true;
    const { payload, clearReminders } = buildTaskSavePayload(v, { row, isNew: false });
    if (clearReminders) payload.reminders_sent = {};
    const { error } = await sb.from('tasks').update(payload).eq('id', row.id);
    saveBtn.disabled = false;
    if (error) { fail(error); return; }
    Object.assign(row, payload);
    draft = {};
    editMode = false;
    toast('Saved');
    renderList();
    renderDetail();
  }

  async function quickStatus(row, patch) {
    const { error } = await sb.from('tasks').update(patch).eq('id', row.id);
    if (error) { fail(error); return; }
    Object.assign(row, patch);
    renderList();
    renderDetail();
  }

  const rowCtx = {
    selectedId: () => selectedTaskId,
    onSelect: (id) => { if (isDesktop()) selectTask(id); else go(`#/tasks/${id}`); },
    registerNode: (id, node) => rowNodesById.set(id, node),
  };

  // ── list pane ────────────────────────────────────────────────────────
  function renderList() {
    const active = all.filter((x) => x.status !== 'done');
    const completed = all.filter((x) => x.status === 'done' && localDateOf(x.completed_at) === t);

    const domainFacets = (() => {
      const m = new Map();
      for (const x of active) {
        if (!x.domain_id) continue;
        const name = refName('domain', x.domain_id) || '(domain)';
        const e = m.get(x.domain_id) ?? { name, count: 0 };
        e.count += 1;
        m.set(x.domain_id, e);
      }
      return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
    })();

    const isUpcoming = (x) => x.status === 'open' && x.due_date && x.due_date > t;
    const isTodayOrOver = (x) => x.status === 'open' && x.due_date && x.due_date <= t;

    const visible = active.filter((x) => {
      if (view === 'today' && !isTodayOrOver(x)) return false;
      if (view === 'upcoming' && !isUpcoming(x)) return false;
      if (dsel.size && (!x.domain_id || !dsel.has(x.domain_id))) return false;
      if (psel.size && !psel.has(x.priority)) return false;
      return true;
    });

    const inGroup = (g) => visible.filter((x) => groupOf(x, t) === g).sort((a, b) =>
      g === 'Waiting'
        ? (a.waiting_since ?? a.created_at ?? '').localeCompare(b.waiting_since ?? b.created_at ?? '')
        : (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99'));

    const projectKey = (x) => refName('project', x.project_id) || `${refName('domain', x.domain_id) || 'Domain'} · direct`;
    const byProject = (() => {
      const m = new Map();
      for (const x of visible) {
        const key = projectKey(x);
        m.set(key, [...(m.get(key) ?? []), x]);
      }
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    })();

    const counts = {
      open: active.filter((x) => x.status === 'open').length,
      overdue: active.filter((x) => x.status === 'open' && x.due_date && x.due_date < t).length,
      waiting: active.filter((x) => x.status === 'waiting').length,
    };
    const activeFilterCount = dsel.size + psel.size + (view !== 'all' ? 1 : 0);
    const viewCount = (v) =>
      v === 'all' ? active.length
        : v === 'today' ? active.filter(isTodayOrOver).length
        : v === 'upcoming' ? active.filter(isUpcoming).length
        : new Set(active.map(projectKey)).size;

    // A function, not a value — the mobile Filters sheet and the desktop
    // dropdown each need their OWN DOM nodes (a node can only live in one
    // parent at a time), so this is called once per place it renders.
    const buildFacetGroups = () => [
      facetGroup('View', activeFilterCount > 0 ? clearBtn('Reset', () => { view = 'all'; dsel.clear(); psel.clear(); renderList(); }) : null,
        ...VIEWS.map(([v, label]) => facetRow({ on: view === v, name: label, count: viewCount(v), onClick: () => { view = v; renderList(); } })),
      ),
      el('div', { class: 'facet-sep' }),
      domainFacets.length ? el('div', {},
        facetGroup('Domain', dsel.size ? clearBtn('Clear', () => { dsel.clear(); renderList(); }) : null,
          ...domainFacets.map((d) => facetRow({
            on: dsel.has(d.id), color: domainColor(d.name), name: d.name, count: d.count,
            onClick: () => { dsel.has(d.id) ? dsel.delete(d.id) : dsel.add(d.id); renderList(); },
          })),
        ),
        el('div', { class: 'facet-sep' }),
      ) : null,
      facetGroup('Priority', psel.size ? clearBtn('Clear', () => { psel.clear(); renderList(); }) : null,
        el('div', { class: 'facet-tags' }, ...[1, 2, 3, 4].map((p) => facetTag({
          on: psel.has(p), name: `P${p}`, count: active.filter((x) => x.priority === p).length,
          onClick: () => { psel.has(p) ? psel.delete(p) : psel.add(p); renderList(); },
        }))),
      ),
    ].filter(Boolean);

    const groupsToShow = view === 'today' ? ['Overdue', 'Today'] : view === 'upcoming' ? ['Upcoming'] : GROUPS;

    rowNodesById.clear();
    const sections = [];
    if (view === 'project') {
      if (!byProject.length) sections.push(emptyState(activeFilterCount > 0));
      else for (const [label, ts] of byProject) sections.push(taskGroup(label, ts, t, renderList, false, rowCtx));
    } else {
      for (const g of groupsToShow) {
        const ts = inGroup(g);
        if (ts.length) sections.push(taskGroup(g, ts, t, renderList, g === 'Overdue', rowCtx));
      }
      if (!visible.length) sections.push(emptyState(activeFilterCount > 0));
    }

    const completedSection = completed.length
      ? el('div', { style: 'margin-top:28px; padding-top:16px; border-top:1px solid var(--line-strong)' },
          el('button', {
            class: 'linkish', type: 'button', style: 'display:flex; align-items:center; justify-content:space-between; width:100%; text-decoration:none',
            onclick: () => { showDone = !showDone; renderList(); },
          },
            el('span', { class: 'eyebrow' }, 'Completed today'),
            el('span', { class: 'eyebrow' }, `${completed.length} ${showDone ? '▾' : '▸'}`),
          ),
          showDone ? el('div', { class: 'list', style: 'margin-top:8px' }, ...completed.map((x) =>
            el('div', { class: 'item row-item' },
              doneCircle({ label: 'Reopen task', onClick: () => quickStatus(x, { status: 'open', completed_at: null }) }),
              el('button', { class: 'item-body', type: 'button', onclick: () => go(`#/tasks/${x.id}`) },
                el('div', { class: 'item-title done' }, x.title),
              ),
            ))) : null,
        )
      : null;

    const filterTrigger = el('button', {
      class: `tasks-filter-trigger ${filterOpen ? 'open' : ''}`, type: 'button',
      onclick: () => { filterOpen = !filterOpen; renderList(); },
    },
      el('span', {}, activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}` : 'All tasks'),
      el('span', { class: 'chev' }, '▾'),
    );
    const filterWrap = el('div', { class: 'tasks-filter-wrap' },
      filterTrigger,
      filterOpen ? el('div', {},
        el('button', { class: 'tasks-filter-scrim', type: 'button', 'aria-label': 'Close filters', onclick: () => { filterOpen = false; renderList(); } }),
        el('div', { class: 'tasks-filter-panel' }, ...buildFacetGroups()),
      ) : null,
    );

    const head = el('header', { class: 'screen-head', style: 'padding-top:0' },
      el('div', { class: 'row-actions' },
        el('div', {},
          el('div', { class: 'eyebrow' }, `${counts.open} open · ${counts.overdue} overdue · ${counts.waiting} waiting`),
          el('h1', {}, 'Tasks'),
        ),
        el('div', { style: 'display:flex; align-items:center; gap:8px' },
          filterWrap,
          el('button', { class: 'work-cta', type: 'button', onclick: () => openNewTaskSheet() }, '+ Add task'),
        ),
      ),
    );

    const filtersBtn = el('button', {
      class: 'filters-fab', type: 'button',
      onclick: () => openSheet(el('div', {},
        el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'Filters')),
        el('div', { style: 'padding-top:8px' }, ...buildFacetGroups()),
      )),
    }, `Filters${activeFilterCount ? ` · ${activeFilterCount}` : ''}`);

    listPane.replaceChildren(head, filtersBtn, el('div', { class: 'tasks-list-scroll' }, ...sections, completedSection));
  }

  // ── detail pane ──────────────────────────────────────────────────────
  function renderDetail() {
    const row = findSelected();
    if (!row) {
      detailPane.replaceChildren(el('div', { class: 'tasks-detail-empty' },
        el('div', {},
          el('div', { class: 't' }, 'No task selected'),
          el('div', { class: 's' }, 'Pick a task from the list to see it here.'),
        ),
      ));
      return;
    }
    detailPane.replaceChildren(editMode ? buildEditView(row) : buildReadView(row));
  }

  function pillFor(row) {
    if (row.status === 'waiting') return { cls: 'quiet', label: 'Waiting' };
    const info = dueInfo(row.due_date, t);
    if (info.state === 'over') return { cls: 'over', label: 'Overdue' };
    if (info.state === 'due') return { cls: 'due', label: 'Open' };
    return { cls: 'ok', label: 'Open' };
  }

  function buildReadView(row) {
    const { cls, label } = pillFor(row);
    const domainProject = (refName('domain', row.domain_id) || '') + (refName('project', row.project_id) ? ` / ${refName('project', row.project_id)}` : '');
    const reminderLabel = Array.isArray(row.reminder_offsets) && row.reminder_offsets.length
      ? (row.reminder_offsets.includes(0) ? 'At due time' : `${Math.min(...row.reminder_offsets)}m before`)
      : 'No reminder';
    const repeatLabel = RECURRENCE_OPTIONS.find((r) => r.value === (row.recurrence_rule || ''))?.label ?? "Doesn't repeat";

    return el('div', { class: 'tasks-detail-inner' },
      el('div', { class: 'detail-status-row' },
        el('span', { class: `pill ${cls}` }, el('span', { class: 'dot' }), label),
        el('span', { class: 'eyebrow' }, refName('domain', row.domain_id) || ''),
        el('div', { class: 'detail-status-actions' },
          row.status === 'done'
            ? el('button', { class: 'ghost small', type: 'button', onclick: () => quickStatus(row, { status: 'open', completed_at: null }) }, 'Reopen')
            : row.status === 'waiting'
            ? el('button', { class: 'ghost small', type: 'button', onclick: () => quickStatus(row, { status: 'open', waiting_on: null, waiting_since: null }) }, 'Back to open')
            : el('button', { class: 'ghost small', type: 'button', onclick: () => quickStatus(row, { status: 'waiting', waiting_since: today() }) }, 'Mark waiting'),
          row.status !== 'done'
            ? el('button', { class: 'ghost small', type: 'button', onclick: () => quickStatus(row, { status: 'done', completed_at: new Date().toISOString() }) }, 'Complete')
            : null,
          el('button', { class: 'detail-btn solid', type: 'button', onclick: () => startEdit() }, 'Edit'),
        ),
      ),
      el('div', { class: 'task-detail-title' }, row.title),
      row.notes ? el('p', { class: 'task-detail-notes' }, row.notes) : null,
      el('div', { class: 'task-kv-grid' },
        kvItem('Due date', row.due_date ? niceDate(row.due_date) : '—'),
        kvItem('Due time', fmtTime12(row.due_time ? hhmm(row.due_time) : '')),
        kvItem('Priority', PRIORITIES.find(([v]) => v === row.priority)?.[1] ?? `P${row.priority ?? 4}`),
        kvItem('Domain / Project', domainProject || '—'),
        kvItem('Milestone', refName('milestone', row.milestone_id) || '—'),
        kvItem('Content item', refName('contentItem', row.content_item_id) || '—'),
        kvItem('Remind me', reminderLabel),
        kvItem('Repeat', repeatLabel),
      ),
    );
  }

  function kvItem(key, val) {
    return el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, key), el('span', { class: 'task-kv-val' }, val));
  }

  function buildEditView(row) {
    const get = (field, fallback) => (draft[field] !== undefined ? draft[field] : fallback);
    const set = (field, value) => { draft[field] = value; };

    const titleInput = el('input', {
      class: 'task-detail-title-input', type: 'text', value: get('title', row.title),
      oninput: (e) => set('title', e.target.value),
    });
    const notesInput = el('textarea', {
      class: 'task-detail-notes-input', placeholder: 'Add notes…',
    }, get('notes', row.notes ?? ''));
    notesInput.oninput = (e) => set('notes', e.target.value);

    const dueDateVal = get('due_date', row.due_date ?? '');
    const dateInput = el('input', { class: 'task-kv-input', type: 'date', value: dueDateVal, oninput: (e) => { set('due_date', e.target.value); } });

    const dueTimeVal = get('due_time', row.due_time ? hhmm(row.due_time) : '');
    const timeTrigger = el('button', { class: 'task-kv-clock-trigger', type: 'button', onclick: () => {
      openClockDial({ initialHHMM: dueTimeVal, onConfirm: (hhmmVal) => { set('due_time', hhmmVal); renderDetail(); } });
    } },
      el('span', { class: 'glyph' }, '🕐'),
      el('span', {}, fmtTime12(dueTimeVal)),
    );

    const priorityVal = get('priority', row.priority ?? 4);
    const prioritySelect = buildPrioritySelect(priorityVal, (v) => set('priority', v));

    const domainIdVal = get('domain_id', row.domain_id);
    const projectIdVal = get('project_id', row.project_id);
    const milestoneIdVal = get('milestone_id', row.milestone_id);
    const milestoneSlot = el('div', {});
    function paintMilestoneSlot() {
      milestoneSlot.replaceChildren(buildMilestoneSlot({
        milestones: ref.milestones,
        projectId: get('project_id', row.project_id),
        milestoneId: get('milestone_id', row.milestone_id),
        onChange: (v) => set('milestone_id', v),
      }));
    }
    const domainProjectSelect = buildDomainProjectSelect({
      projects: projectsWithDomain, domains: ref.domains, inbox: ref.inbox,
      domainId: domainIdVal, projectId: projectIdVal,
      onChange: ({ domain_id, project_id }) => {
        set('domain_id', domain_id); set('project_id', project_id); set('milestone_id', null);
        paintMilestoneSlot();
      },
    });
    paintMilestoneSlot();

    const contentSelect = buildContentItemSelect({ contentItems: ref.contentItems, value: get('content_item_id', row.content_item_id), onChange: (v) => set('content_item_id', v) });
    const reminderSelect = buildReminderSelect({ value: get('reminder_offsets', Array.isArray(row.reminder_offsets) ? row.reminder_offsets : []), onChange: (v) => set('reminder_offsets', v) });
    const recurrenceSelect = buildRecurrenceSelect({ value: get('recurrence_rule', row.recurrence_rule ?? ''), onChange: (v) => set('recurrence_rule', v) });

    const saveBtn = el('button', { class: 'detail-btn solid', type: 'button', onclick: () => saveEdit(saveBtn) }, 'Save');

    return el('div', { class: 'tasks-detail-inner' },
      el('div', { class: 'detail-status-row' },
        el('span', { class: `pill ${pillFor(row).cls}` }, el('span', { class: 'dot' }), pillFor(row).label),
        el('span', { class: 'eyebrow' }, refName('domain', row.domain_id) || ''),
        el('div', { class: 'detail-status-actions' },
          el('button', { class: 'ghost small', type: 'button', onclick: () => cancelEdit() }, 'Cancel'),
          saveBtn,
        ),
      ),
      titleInput,
      notesInput,
      el('div', { class: 'task-kv-grid' },
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Due date'), dateInput),
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Due time'), timeTrigger),
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Priority'), prioritySelect),
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Domain / Project'), domainProjectSelect),
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Milestone'), milestoneSlot),
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Content item'), contentSelect),
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Remind me'), reminderSelect),
        el('div', { class: 'task-kv-item' }, el('span', { class: 'task-kv-key' }, 'Repeat'), recurrenceSelect),
      ),
      el('button', { class: 'delete-link', type: 'button', onclick: async () => {
        if (!confirmDelete('this task')) return;
        const { error } = await sb.from('tasks').delete().eq('id', row.id);
        if (error) { fail(error); return; }
        const idx = all.findIndex((x) => x.id === row.id);
        if (idx !== -1) all.splice(idx, 1);
        selectedTaskId = null; draft = {}; editMode = false;
        toast('Deleted');
        renderList(); renderDetail();
      } }, 'Delete task…'),
    );
  }

  renderList();
  renderDetail();
}

function facetGroup(label, action, ...children) {
  return el('div', { class: 'facet-group' },
    el('div', { class: 'facet-group-head' }, el('span', { class: 'eyebrow' }, label), action ? el('div', {}, action) : null),
    ...children,
  );
}
function facetRow({ on, color, name, count, onClick }) {
  return el('button', { class: `facet-row ${on ? 'on' : ''}`, type: 'button', onclick: onClick },
    color ? el('span', { class: 'facet-swatch', style: `background:${color}` }) : null,
    el('span', { class: 'facet-row-name' }, name),
    count != null ? el('span', { class: 'facet-row-count' }, String(count)) : null,
  );
}
function facetTag({ on, name, count, onClick }) {
  return el('button', { class: `facet-tag ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, name, count != null ? ` ${count}` : '');
}
function clearBtn(label, onClick) {
  return el('button', { class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.09em; text-decoration:none', onclick }, label);
}

function taskGroup(label, tasks, t, refresh, accent, rowCtx) {
  return el('section', { style: 'margin-bottom:22px' },
    el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; padding-bottom:8px; margin-bottom:4px; border-bottom:1px solid var(--line)' },
      el('h4', { class: 'eyebrow', style: 'margin:0' }, label),
      el('span', { class: 'eyebrow', style: accent ? 'color:var(--accent)' : '' }, String(tasks.length)),
    ),
    ...tasks.map((x) => taskListRow(x, t, refresh, rowCtx)),
  );
}

function emptyState(filtered) {
  return el('div', { style: 'padding:56px 0; text-align:center' },
    el('div', { style: 'font-family:var(--serif); font-size:22px; font-weight:500; color:var(--ink)' }, 'Nothing in this view.'),
    el('p', { class: 'item-meta plain' }, filtered ? 'No task matches these filters.' : 'The list is clear.'),
  );
}

// A port of tasks-view.tsx's TaskRow: a priority-ring checkbox (not the
// square Top-3 checkbox Today uses), domain-colour dot, and the recurrence/
// reminder/linked-content indicators. No star — Top 3 pinning lives on
// Today's TaskItem, not here.
const PRIO_RING = { 1: 'var(--accent)', 2: 'var(--warn)', 3: 'var(--prio3, #7fa3d1)', 4: 'var(--ink-4)' };

// The filled-circle "done" look: what taskListRow's check button turns into
// once ticked, and what a Completed-today row shows from the start. One
// definition so the two can't quietly drift apart — this used to be a plain
// (non-interactive) square .tick, a different component to everything else
// on this screen and one that couldn't be clicked to undo itself.
function doneCircle({ label, onClick }) {
  return el('button', {
    type: 'button', 'aria-label': label,
    style: 'flex:0 0 auto; width:18px; height:18px; margin-top:2px; border-radius:999px; cursor:pointer;' +
      'display:grid; place-items:center; background:var(--ink-2); border:2px solid var(--ink-2);',
    onclick: (e) => { e.stopPropagation(); onClick(); },
  });
}

function taskListRow(x, t, refresh, rowCtx) {
  const isWaiting = x.status === 'waiting';
  const info = dueInfo(x.due_date, t);
  const waitDays = isWaiting && x.waiting_since ? Math.max(0, daysBetween(x.waiting_since, t)) : null;
  const waitStale = waitDays != null && waitDays >= 7;
  const domainName = refName('domain', x.domain_id) || null;
  const projectLabel = refName('project', x.project_id) || domainName;

  const baseCheckBorder = isWaiting
    ? `2px dashed ${waitStale ? 'var(--accent)' : 'var(--ink-3)'}`
    : `2px solid ${PRIO_RING[x.priority] ?? 'var(--ink-4)'}`;
  const check = el('button', {
    type: 'button', 'aria-label': isWaiting ? 'Mark done' : 'Toggle done',
    style: `flex:0 0 auto; width:18px; height:18px; margin-top:2px; border-radius:999px; background:none;` +
      `cursor:pointer; display:grid; place-items:center; border:${baseCheckBorder};`,
    // Colours in and drops the row into Completed the instant it's clicked,
    // instead of firing the write and leaving `x` (and so the re-render)
    // untouched — that old version never moved the task until the next full
    // page load, since `refresh` here re-renders from the in-memory list,
    // not a fresh fetch. Reverts the fill if the write fails.
    onclick: async (e) => {
      e.stopPropagation();
      check.disabled = true;
      check.style.background = 'var(--ink-2)';
      check.style.border = '2px solid var(--ink-2)';

      const patch = { status: 'done', completed_at: new Date().toISOString() };
      const { error } = await sb.from('tasks').update(patch).eq('id', x.id);
      if (error) {
        check.disabled = false;
        check.style.background = 'none';
        check.style.border = baseCheckBorder;
        fail(error);
        return;
      }
      Object.assign(x, patch);
      toast('Done');
      refresh();
    },
  });

  const bits = [];
  if (isWaiting) {
    bits.push(el('span', { style: `color:${waitStale ? 'var(--accent)' : 'var(--ink-3)'}` },
      `⏸ Waiting${x.waiting_on ? ` on ${x.waiting_on}` : ''}${waitDays != null ? ` · ${waitDays}d` : ''}`));
  } else if (info.text) {
    bits.push(el('span', { style: `color:${info.state === 'over' ? 'var(--accent)' : info.state === 'due' ? 'var(--warn)' : 'var(--ink-3)'}` }, info.text));
  }
  if (projectLabel) {
    bits.push(el('span', { style: 'display:inline-flex; align-items:center; gap:6px; color:var(--ink-3)' },
      el('span', { style: `width:7px; height:7px; border-radius:2px; background:${domainName ? domainColor(domainName) : '#B6AFA4'}` }),
      projectLabel));
  }
  if (x.recurrence_rule) bits.push(el('span', { style: 'color:var(--ink-3)' }, `↻ ${x.recurrence_rule}`));
  if (x.reminder_offsets?.length) bits.push(el('span', { style: 'color:var(--ink-3)' }, 'remind'));
  if (x.content_item_id) bits.push(el('span', { style: 'color:var(--accent)' }, 'linked content'));

  const isSelected = rowCtx?.selectedId?.() === x.id;
  const row = el('div', { class: `work-row ${isSelected ? 'selected' : ''}`, style: 'align-items:flex-start' },
    check,
    el('button', {
      class: 'work-row-main', type: 'button', style: 'background:none; border:none; text-align:left; padding:0; cursor:pointer',
      onclick: () => { if (rowCtx?.onSelect) rowCtx.onSelect(x.id); else go(`#/tasks/${x.id}`); },
    },
      el('div', { style: `font-family:var(--sans); font-size:14.5px; color:${isWaiting ? 'var(--ink-2)' : 'var(--ink)'}` }, x.title),
      el('div', { class: 'item-meta', style: 'margin-top:3px' }, ...bits),
    ),
  );
  rowCtx?.registerNode?.(x.id, row);
  row.oncontextmenu = (e) => taskContextMenu(e, x, refresh);
  return row;
}

// ─── Right-click menu ──────────────────────────────────────────────────────
// A trimmed port of TickTick's row context menu: date/priority quick-set rows
// (same `.chip` look as the mobile Filters sheet and capture form, wrapped
// via ctxChipRow rather than their usual horizontal scroll — see below), then
// a plain action list. TickTick also has subtasks, a parent-task link, tags,
// Focus sessions, and sticky-note/note conversion — none of those exist in
// this schema, so they're left out rather than faked. Shared by both
// task-row builders below: taskListRow (desktop Tasks workspace) and taskRow
// (Today's rail).

function menuItem(label, onClick, danger) {
  return el('button', { class: `ctx-item ${danger ? 'danger' : ''}`, type: 'button', onclick: onClick }, label);
}

// A `.chip` row that wraps instead of scrolling — see the call sites below
// for why this exists instead of reusing `chips()` from lib/ui.js.
function ctxChipRow(options, selected, onPick) {
  return el('div', { class: 'ctx-chip-wrap' },
    ...options.map((o) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(o.value === selected),
      onclick: () => onPick(o.value),
    }, o.label)),
  );
}

function taskContextMenu(evt, task, refresh) {
  evt.preventDefault();
  evt.stopPropagation();
  let closeMenu = () => {};

  // In-place field edits (date/priority/status/pin/move) mutate `task`
  // directly — it's the same object living in the caller's list, whether
  // that's tasksList's `all` or Today's briefing data — so the caller's own
  // lightweight `refresh` (re-render, no refetch) already picks up the
  // change. Duplicate/Delete change the list's *shape*, so they fall through
  // to rerenderRoute() instead (see below) — a full reload of the current
  // screen, same as taskForm's own onSave/onDelete already do.
  const patch = async (fields, msg) => {
    const { error } = await sb.from('tasks').update(fields).eq('id', task.id);
    if (error) { fail(error); return; }
    Object.assign(task, fields);
    if (msg) toast(msg);
    refresh();
    closeMenu();
  };

  const dateOpts = [
    { value: today(), label: 'Today' },
    { value: ymd(addDays(new Date(), 1)), label: 'Tomorrow' },
    { value: ymd(addDays(new Date(), 7)), label: 'Next wk' },
    { value: '', label: 'None' },
  ];
  // A plain wrapping row, not the `chips()` helper — that one is built for a
  // horizontally *scrolling* strip (mobile filter rows), which is exactly
  // wrong in a fixed-width popover: it just ran the row off the menu's edge
  // instead of wrapping. Same `.chip` buttons, own container.
  const dateChips = ctxChipRow(dateOpts, task.due_date || '', (v) => patch({ due_date: v || null }, 'Date updated'));
  const dateCustom = el('input', {
    type: 'date', class: 'ctx-date-input', value: task.due_date || '',
    onchange: (e) => patch({ due_date: e.target.value || null }, 'Date updated'),
  });

  const prioChips = ctxChipRow(
    [1, 2, 3, 4].map((p) => ({ value: p, label: `P${p}` })),
    task.priority ?? 4,
    (v) => patch({ priority: v }, 'Priority updated'),
  );

  const isTop3 = task.top3_for_date === today();
  const isWaiting = task.status === 'waiting';
  const isDone = task.status === 'done';

  const statusItems = isDone
    ? [menuItem('↺ Reopen', () => patch({ status: 'open', completed_at: null }, 'Reopened'))]
    : [
        menuItem('✓ Complete', () => patch({ status: 'done', completed_at: new Date().toISOString() }, 'Done')),
        isWaiting
          ? menuItem('▸ Back to open', () => patch({ status: 'open', waiting_on: null, waiting_since: null }, 'Reopened'))
          : menuItem('⏸ Mark waiting', () => patch({ status: 'waiting', waiting_since: today() }, 'Marked waiting')),
      ];

  const content = el('div', {},
    el('div', { class: 'ctx-label' }, 'Date'),
    el('div', { class: 'ctx-row' }, dateChips),
    el('div', { class: 'ctx-row' }, dateCustom),
    el('div', { class: 'ctx-label' }, 'Priority'),
    el('div', { class: 'ctx-row' }, prioChips),
    el('div', { class: 'ctx-sep' }),
    menuItem(isTop3 ? '☆ Unpin from Top 3' : '★ Pin to Top 3', () =>
      patch({ top3_for_date: isTop3 ? null : today() }, isTop3 ? 'Unpinned' : 'Pinned for today')),
    menuItem('⇥ Move to…', () => { closeMenu(); openMoveToDialog(task, refresh); }),
    ...statusItems,
    menuItem('⧉ Duplicate', () => { closeMenu(); duplicateTaskFromMenu(task); }),
    menuItem('⌫ Delete', () => { closeMenu(); deleteTaskFromMenu(task); }, true),
  );

  closeMenu = openContextMenu(evt.clientX, evt.clientY, content);
}

// A compact dialog rather than a flyout submenu — reuses the same grouped
// domain/project select the full editor uses, so "Move to" can't drift out
// of sync with it.
function openMoveToDialog(task, refresh) {
  const body = el('div', { style: 'padding:16px 20px' }, spinner('Loading…'));
  openSheet(el('div', {}, el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'Move to')), body), { dialog: true, compact: true });

  sb.from('projects').select('id, name, domain_id').eq('status', 'active').order('name').then(({ data, error }) => {
    if (error) { fail(error); closeSheet(); return; }
    const sel = buildDomainProjectSelect({
      projects: data ?? [], domains: ref.domains, inbox: ref.inbox,
      domainId: task.domain_id, projectId: task.project_id,
      onChange: async ({ domain_id, project_id }) => {
        const { error: upErr } = await sb.from('tasks').update({ domain_id, project_id, milestone_id: null }).eq('id', task.id);
        if (upErr) { fail(upErr); return; }
        Object.assign(task, { domain_id, project_id, milestone_id: null });
        toast('Moved');
        refresh();
        closeSheet();
      },
    });
    body.replaceWith(el('div', { style: 'padding:16px 20px' }, sel));
  });
}

async function duplicateTaskFromMenu(task) {
  const payload = {
    title: `${task.title} (copy)`,
    notes: task.notes ?? null,
    domain_id: task.domain_id,
    project_id: task.project_id,
    milestone_id: task.milestone_id,
    content_item_id: task.content_item_id,
    due_date: task.due_date,
    due_time: task.due_time,
    priority: task.priority,
    reminder_offsets: task.reminder_offsets,
    recurrence_rule: task.recurrence_rule,
    source: 'manual',
    status: 'open',
  };
  const { error } = await sb.from('tasks').insert(payload);
  if (error) { fail(error); return; }
  toast('Duplicated');
  rerenderRoute();
}

async function deleteTaskFromMenu(task) {
  if (!confirmDelete('this task')) return;
  const { error } = await sb.from('tasks').delete().eq('id', task.id);
  if (error) { fail(error); return; }
  toast('Deleted');
  rerenderRoute();
}

// ─── Task row used elsewhere (Today's rail) ───────────────────────────────
// The square Top-3 checkbox variant — a port of components/TaskItem.tsx,
// distinct from taskListRow above (tasks-view.tsx's TaskRow has no star).

export function taskRow(t, refresh, opts = {}) {
  const done = t.status === 'done';
  const waiting = t.status === 'waiting';
  const urgency = urgencyOfLocal(t.due_date, t.status);

  const box = tickBox({
    done,
    waiting,
    label: done ? 'Mark task open' : 'Mark task done',
    // Fills in immediately (the .tick.on look) instead of waiting on the
    // network round trip, and mutates `t` in place so callers whose refresh
    // doesn't refetch (nothing currently, but see taskListRow's `check`
    // above for what happens when that assumption breaks) still show the
    // right state. Reverts the fill if the write fails.
    onClick: async (e) => {
      e.stopPropagation();
      const patch = done
        ? { status: 'open', completed_at: null }
        : { status: 'done', completed_at: new Date().toISOString() };
      box.classList.toggle('on', !done);
      const { error } = await sb.from('tasks').update(patch).eq('id', t.id);
      if (error) { box.classList.toggle('on', done); fail(error); return; }
      Object.assign(t, patch);
      toast(done ? 'Reopened' : 'Done');
      refresh?.();
    },
  });

  const duePill = done
    ? null
    : urgency === 'over' ? pill('over', `Overdue ${niceDate(t.due_date)}`)
    : urgency === 'due' ? pill('due', t.due_time ? hhmm(t.due_time) : 'Today')
    : urgency === 'ok' ? pill('ok', niceDate(t.due_date))
    : null;

  const bits = [
    done && (t.completed_at ? `done ${niceDate(localDateOf(t.completed_at))}` : 'done'),
    !done && urgency === 'over' && hhmm(t.due_time),
    `P${t.priority ?? 4}`,
    refName('project', t.project_id) || refName('domain', t.domain_id),
    waiting && t.waiting_on && `waiting on ${t.waiting_on}`,
  ].filter(Boolean);

  const meta = el('div', { class: 'item-meta' });
  if (duePill) meta.append(duePill);
  for (const b of bits) meta.append(el('span', {}, b));

  const isTop3 = t.top3_for_date === today();
  const star = done ? null : el('button', {
    class: `star ${isTop3 ? 'on' : ''}`, type: 'button',
    'aria-label': isTop3 ? 'Remove from Top 3' : 'Add to Top 3',
    onclick: async (e) => {
      e.stopPropagation();
      const { error } = await sb.from('tasks')
        .update({ top3_for_date: isTop3 ? null : today() }).eq('id', t.id);
      if (error) { fail(error); return; }
      toast(isTop3 ? 'Unpinned' : 'Pinned for today');
      refresh?.();
    },
  }, isTop3 ? '★' : '☆');

  return el('div', {
    class: `item row-item ${done ? 'done' : ''} ${opts.pinned ? 'pinned' : ''}`,
    oncontextmenu: refresh ? (e) => taskContextMenu(e, t, refresh) : null,
  },
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
    star,
  );
}

function urgencyOfLocal(dueDate, status) {
  if (status === 'done') return null;
  if (!dueDate) return null;
  const t = today();
  if (dueDate < t) return 'over';
  if (dueDate === t) return 'due';
  return 'ok';
}

// ─── Task detail + edit (full page / dialog) ──────────────────────────────
// A port of [id]/page.tsx + task-form.tsx: a one-tap status row above the
// form (Complete / Reopen / Mark waiting — immediate, not part of Save),
// then the full field set including recurrence and linked content. Used by
// the phone /tasks/:id route and by openNewTaskSheet's add-task dialog —
// the desktop 3-pane workspace above never navigates here, it edits inline.

// Opens the new-task form as a dialog over whatever screen is currently
// showing, instead of navigating to the /tasks/new page — used by the
// Today capture chips and the Tasks list's "+ Add task" button, both of
// which want a quick add without losing the underlying screen.
export function openNewTaskSheet() {
  const holder = el('div', {});
  openSheet(holder, { dialog: true });
  taskForm(holder, { id: 'new', inSheet: true });
}

export async function taskForm(mount, { id, inSheet } = {}) {
  const isNew = !id || id === 'new';
  let row = null;

  if (!isNew) {
    mount.replaceChildren(spinner());
    const { data, error } = await sb.from('tasks').select('*').eq('id', id).single();
    if (error) { mount.replaceChildren(hint(error.message)); return; }
    row = data;
  }

  // ref.projects (loaded once for FK pickers app-wide) carries no domain_id,
  // so the domain/project grouped picker needs its own fetch.
  const { data: projectRows } = await sb.from('projects').select('id, name, domain_id').eq('status', 'active').order('name');
  const projects = projectRows ?? [];

  const v = {
    title: row?.title ?? '',
    notes: row?.notes ?? '',
    domain_id: row?.domain_id ?? null,
    project_id: row?.project_id ?? null,
    milestone_id: row?.milestone_id ?? null,
    content_item_id: row?.content_item_id ?? null,
    due_date: row?.due_date ?? '',
    due_time: row?.due_time ? hhmm(row.due_time) : '',
    priority: row?.priority ?? 4,
    reminder_offsets: Array.isArray(row?.reminder_offsets) ? row.reminder_offsets : (isNew ? [0] : []),
    recurrence_rule: row?.recurrence_rule ?? '',
  };

  const title = el('input', {
    type: 'text', placeholder: 'What needs doing?', autocapitalize: 'sentences',
    oninput: (e) => { v.title = e.target.value; },
  });
  title.value = v.title;

  const notes = el('textarea', {
    rows: 3, placeholder: 'Notes', autocapitalize: 'sentences',
    oninput: (e) => { v.notes = e.target.value; },
  });
  notes.value = v.notes;

  const dateInput = el('input', { type: 'date', oninput: (e) => { v.due_date = e.target.value; } });
  dateInput.value = v.due_date;
  const timeInput = el('input', { type: 'time', oninput: (e) => { v.due_time = e.target.value; } });
  timeInput.value = v.due_time;

  const prioSel = buildPrioritySelect(v.priority, (val) => { v.priority = val; });

  const milestoneSlot = el('div', {});
  function paintMilestones() {
    const slotContent = buildMilestoneSlot({ milestones: ref.milestones, projectId: v.project_id, milestoneId: v.milestone_id, onChange: (val) => { v.milestone_id = val; } });
    if (slotContent.children.length) {
      milestoneSlot.replaceChildren(el('div', { class: 'field' }, el('label', {}, 'Milestone'), slotContent));
    } else {
      milestoneSlot.replaceChildren();
    }
  }

  const selSel = buildDomainProjectSelect({
    projects, domains: ref.domains, inbox: ref.inbox, domainId: v.domain_id, projectId: v.project_id,
    onChange: ({ domain_id, project_id }) => { v.domain_id = domain_id; v.project_id = project_id; v.milestone_id = null; paintMilestones(); },
  });
  paintMilestones();

  const contentSel = buildContentItemSelect({ contentItems: ref.contentItems, value: v.content_item_id, onChange: (val) => { v.content_item_id = val; } });
  const remindSel = buildReminderSelect({ value: v.reminder_offsets, onChange: (val) => { v.reminder_offsets = val; } });
  const recurSel = buildRecurrenceSelect({ value: v.recurrence_rule, onChange: (val) => { v.recurrence_rule = val; } });

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add task' : 'Save');

  // Eyebrow + meta match the dashboard's two variants of this header exactly:
  // /tasks/new shows "Capture" / "Full editor"; /tasks/[id] shows the task's
  // status (+ source, if not manual) / its created date.
  const eyebrow = isNew
    ? 'Capture'
    : [
        row.status === 'done' ? 'Done' : row.status === 'waiting' ? 'Waiting' : 'Open',
        row.source && row.source !== 'manual' ? `via ${row.source}` : null,
      ].filter(Boolean).join(' · ');
  const meta = isNew
    ? 'Full editor'
    : `Created ${new Date(row.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  mount.replaceChildren(
    ...(inSheet
      ? [el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'New task'))]
      : [
          el('div', { class: 'lib-crumb' }, el('button', { class: 'linkish', type: 'button', onclick: () => go('#/tasks') }, '← Tasks')),
          screenHead(eyebrow, isNew ? 'New task' : (row?.title || 'Edit task'), { meta }),
          el('div', { class: 'hairline', style: 'margin-bottom:16px' }),
        ]),
    ...(isNew ? [] : [statusRow(row, id, mount)]),
    panel(
      el('div', { class: 'field' }, el('label', {}, 'Title (required)'), title),
      el('div', { class: 'field' }, el('label', {}, 'Notes'), notes),
      el('div', { class: 'row' },
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Due date'), dateInput),
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Due time'), timeInput),
      ),
      el('div', { class: 'row' },
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Priority'), prioSel),
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Domain / Project'), selSel),
      ),
      milestoneSlot,
      el('div', { class: 'field' }, el('label', {}, 'Content item (optional — video / article / podcast tasks)'), contentSel),
      el('div', { class: 'field' }, el('label', {}, 'Remind me (Pushover — requires a due time)'), remindSel),
      el('div', { class: 'field' }, el('label', {}, 'Repeat (rolls forward on done instead of completing)'), recurSel),
    ),
    el('div', { class: 'form-actions' },
      save,
      isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete task…'),
    ),
  );

  async function onSave() {
    if (!v.title.trim()) { toast('Type something first.', 'err'); return; }
    save.disabled = true;

    const { payload, clearReminders } = buildTaskSavePayload(v, { row, isNew });
    if (clearReminders) payload.reminders_sent = {};

    const res = isNew
      ? await sb.from('tasks').insert(payload)
      : await sb.from('tasks').update(payload).eq('id', id);

    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Task added' : 'Saved');
    if (inSheet) { closeSheet(); rerenderRoute(); } else go('#/tasks');
  }

  async function onDelete() {
    if (!confirmDelete('this task')) return;
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/tasks');
  }
}

// One-tap status row — Complete / Reopen / Mark waiting, immediate writes,
// separate from the Save button below. A port of [id]/page.tsx's status
// control block.
function statusRow(row, id, mount) {
  const wrap = el('div', { class: 'form-actions', style: 'display:flex; align-items:center; gap:10px; flex-wrap:wrap' });

  const setStatus = async (patch) => {
    const { error } = await sb.from('tasks').update(patch).eq('id', id);
    if (error) { fail(error); return; }
    taskForm(mount, { id });
  };

  if (row.status === 'done') {
    wrap.append(
      el('span', { class: 'eyebrow' }, '✓ Completed'),
      el('button', { class: 'ghost small', type: 'button', onclick: () => setStatus({ status: 'open', completed_at: null }) }, 'Reopen'),
    );
  } else if (row.status === 'waiting') {
    const waitDays = row.waiting_since ? Math.max(0, daysBetween(row.waiting_since, today())) : null;
    wrap.append(
      el('span', { class: 'eyebrow' }, `⏸ Waiting${row.waiting_on ? ` on ${row.waiting_on}` : ''}${waitDays != null ? ` · ${waitDays}d` : ''}`),
      el('button', { class: 'ghost small', type: 'button', onclick: () => setStatus({ status: 'open', waiting_on: null, waiting_since: null }) }, 'Back to open'),
      el('button', { class: 'ghost small', type: 'button', onclick: () => setStatus({ status: 'done', completed_at: new Date().toISOString() }) }, 'Complete'),
    );
  } else {
    const waitingOn = el('input', { type: 'text', placeholder: 'waiting on…', style: 'width:140px' });
    wrap.append(
      el('button', {
        class: 'ghost small', type: 'button',
        onclick: () => setStatus({ status: 'done', completed_at: new Date().toISOString() }),
      }, row.recurrence_rule ? 'Complete · rolls to next' : 'Mark complete'),
      waitingOn,
      el('button', {
        class: 'ghost small', type: 'button',
        onclick: () => setStatus({ status: 'waiting', waiting_on: waitingOn.value.trim() || null, waiting_since: today() }),
      }, 'Mark waiting'),
    );
  }

  return wrap;
}
