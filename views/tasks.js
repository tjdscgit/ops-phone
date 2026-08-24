// Tasks — hand-built rather than descriptor-driven, because a task list is
// the one screen where you act on rows instead of opening them: ticking
// something off has to be one tap, from the list, without a round trip
// through a form.
//
// The list screen is a port of the dashboard's tasks-view.tsx: a facet rail
// (View / Domain / Priority), five date-window groups (Overdue / Today /
// Upcoming / No date / Waiting) or a by-project grouping, and a collapsible
// Completed-today section. The detail screen is a port of [id]/page.tsx +
// task-form.tsx: a one-tap status row (Complete / Reopen / Mark waiting)
// above the edit form, not baked into the form itself.

import { sb, ref, refName } from '../lib/db.js';
import {
  el, panel, hint, toast, fail, confirmDelete, spinner,
  screenHead, pill, tickBox,
  today, niceDate, hhmm,
} from '../lib/ui.js';
import { go } from '../lib/router.js';
import { domainColor } from '../lib/domain-colors.js';
import { openSheet } from '../app.js';

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

// ─── List screen ─────────────────────────────────────────────────────────

export async function tasksList(mount) {
  mount.replaceChildren(spinner());

  const { data, error } = await sb.from('tasks').select(
    'id, title, status, due_date, due_time, priority, domain_id, project_id, waiting_on, waiting_since, completed_at, top3_for_date, created_at, recurrence_rule, reminder_offsets, content_item_id',
  );
  if (error) { mount.lastChild.replaceWith(hint(error.message)); return; }

  const all = data ?? [];
  let view = 'all';
  const dsel = new Set();
  const psel = new Set();
  let showDone = false;

  const t = today();
  const layout = el('div', { class: 'work-layout' });
  mount.lastChild.replaceWith(layout);

  async function render() {
    const active = all.filter((x) => x.status !== 'done');
    const completed = all.filter((x) => x.status === 'done' && x.completed_at && x.completed_at.slice(0, 10) === t);

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

    // A function, not a value — the desktop rail and the mobile Filters
    // sheet each need their OWN DOM nodes (a node can only live in one
    // parent at a time), so this is called once per place it renders.
    const buildFacetGroups = () => [
      facetGroup('View', activeFilterCount > 0 ? clearBtn('Reset', () => { view = 'all'; dsel.clear(); psel.clear(); render(); }) : null,
        ...VIEWS.map(([v, label]) => facetRow({ on: view === v, name: label, count: viewCount(v), onClick: () => { view = v; render(); } })),
      ),
      el('div', { class: 'facet-sep' }),
      domainFacets.length ? el('div', {},
        facetGroup('Domain', dsel.size ? clearBtn('Clear', () => { dsel.clear(); render(); }) : null,
          ...domainFacets.map((d) => facetRow({
            on: dsel.has(d.id), color: domainColor(d.name), name: d.name, count: d.count,
            onClick: () => { dsel.has(d.id) ? dsel.delete(d.id) : dsel.add(d.id); render(); },
          })),
        ),
        el('div', { class: 'facet-sep' }),
      ) : null,
      facetGroup('Priority', psel.size ? clearBtn('Clear', () => { psel.clear(); render(); }) : null,
        el('div', { class: 'facet-tags' }, ...[1, 2, 3, 4].map((p) => facetTag({
          on: psel.has(p), name: `P${p}`, count: active.filter((x) => x.priority === p).length,
          onClick: () => { psel.has(p) ? psel.delete(p) : psel.add(p); render(); },
        }))),
      ),
    ].filter(Boolean);

    const groupsToShow = view === 'today' ? ['Overdue', 'Today'] : view === 'upcoming' ? ['Upcoming'] : GROUPS;

    const sections = [];
    if (view === 'project') {
      if (!byProject.length) sections.push(emptyState(activeFilterCount > 0));
      else for (const [label, ts] of byProject) sections.push(taskGroup(label, ts, t, render));
    } else {
      for (const g of groupsToShow) {
        const ts = inGroup(g);
        if (ts.length) sections.push(taskGroup(g, ts, t, render, g === 'Overdue'));
      }
      if (!visible.length) sections.push(emptyState(activeFilterCount > 0));
    }

    const completedSection = completed.length
      ? el('div', { style: 'margin-top:28px; padding-top:16px; border-top:1px solid var(--line-strong)' },
          el('button', {
            class: 'linkish', type: 'button', style: 'display:flex; align-items:center; justify-content:space-between; width:100%; text-decoration:none',
            onclick: () => { showDone = !showDone; render(); },
          },
            el('span', { class: 'eyebrow' }, 'Completed today'),
            el('span', { class: 'eyebrow' }, `${completed.length} ${showDone ? '▾' : '▸'}`),
          ),
          showDone ? el('div', { class: 'list', style: 'margin-top:8px' }, ...completed.map((x) =>
            el('div', { class: 'item row-item' },
              el('span', { class: 'tick on', style: 'pointer-events:none' }),
              el('button', { class: 'item-body', type: 'button', onclick: () => go(`#/tasks/${x.id}`) },
                el('div', { class: 'item-title done' }, x.title),
              ),
            ))) : null,
        )
      : null;

    const body = el('div', { class: 'work-body' },
      el('header', { class: 'screen-head', style: 'padding-top:0' },
        el('div', { class: 'row-actions' },
          el('div', {},
            el('div', { class: 'eyebrow' }, `${counts.open} open · ${counts.overdue} overdue · ${counts.waiting} waiting`),
            el('h1', {}, 'Tasks'),
          ),
          el('button', { class: 'work-cta', type: 'button', onclick: () => go('#/tasks/new') }, '+ Add task'),
        ),
      ),
      ...sections,
      completedSection,
    );

    const desktopRail = el('aside', { class: 'facet-rail' }, ...buildFacetGroups());
    const filtersBtn = el('button', {
      class: 'filters-fab', type: 'button',
      onclick: () => openSheet(el('div', {},
        el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'Filters')),
        el('div', { style: 'padding-top:8px' }, ...buildFacetGroups()),
      )),
    }, `Filters${activeFilterCount ? ` · ${activeFilterCount}` : ''}`);

    layout.replaceChildren(desktopRail, filtersBtn, body);
  }

  await render();
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

function taskGroup(label, tasks, t, refresh, accent) {
  return el('section', { style: 'margin-bottom:22px' },
    el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; padding-bottom:8px; margin-bottom:4px; border-bottom:1px solid var(--line)' },
      el('h4', { class: 'eyebrow', style: 'margin:0' }, label),
      el('span', { class: 'eyebrow', style: accent ? 'color:var(--accent)' : '' }, String(tasks.length)),
    ),
    ...tasks.map((x) => taskListRow(x, t, refresh)),
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

function taskListRow(x, t, refresh) {
  const isWaiting = x.status === 'waiting';
  const info = dueInfo(x.due_date, t);
  const waitDays = isWaiting && x.waiting_since ? Math.max(0, daysBetween(x.waiting_since, t)) : null;
  const waitStale = waitDays != null && waitDays >= 7;
  const domainName = refName('domain', x.domain_id) || null;
  const projectLabel = refName('project', x.project_id) || domainName;

  const check = el('button', {
    type: 'button', 'aria-label': isWaiting ? 'Mark done' : 'Toggle done',
    style: `flex:0 0 auto; width:18px; height:18px; margin-top:2px; border-radius:999px; background:none; cursor:pointer;` +
      (isWaiting
        ? `border:2px dashed ${waitStale ? 'var(--accent)' : 'var(--ink-3)'}`
        : `border:2px solid ${PRIO_RING[x.priority] ?? 'var(--ink-4)'}`),
    onclick: async (e) => {
      e.stopPropagation();
      const { error } = await sb.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', x.id);
      if (error) { fail(error); return; }
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

  return el('div', { class: 'work-row', style: 'align-items:flex-start' },
    check,
    el('button', { class: 'work-row-main', type: 'button', style: 'background:none; border:none; text-align:left; padding:0; cursor:pointer', onclick: () => go(`#/tasks/${x.id}`) },
      el('div', { style: `font-family:var(--sans); font-size:14.5px; color:${isWaiting ? 'var(--ink-2)' : 'var(--ink)'}` }, x.title),
      el('div', { class: 'item-meta', style: 'margin-top:3px' }, ...bits),
    ),
  );
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

  return el('div', { class: `item row-item ${done ? 'done' : ''} ${opts.pinned ? 'pinned' : ''}` },
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

// ─── Task detail + edit ────────────────────────────────────────────────
// A port of [id]/page.tsx + task-form.tsx: a one-tap status row above the
// form (Complete / Reopen / Mark waiting — immediate, not part of Save),
// then the full field set including recurrence and linked content.

export async function taskForm(mount, { id }) {
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

  const prioSel = el('select', { onchange: (e) => { v.priority = Number(e.target.value); } });
  for (const [val, label] of [[1, '1 · Urgent'], [2, '2 · High'], [3, '3 · Medium'], [4, '4 · Low (default)']]) {
    prioSel.append(el('option', { value: val }, label));
  }
  prioSel.value = v.priority;

  const selSel = el('select', {
    onchange: (e) => {
      const val = e.target.value;
      if (val.startsWith('project:')) { v.project_id = val.slice(8); v.domain_id = null; }
      else if (val.startsWith('domain:')) { v.domain_id = val.slice(7); v.project_id = null; }
      v.milestone_id = null;
      paintMilestones();
    },
  });
  const inbox = ref.inbox;
  const userDomains = ref.domains;
  const projectsByDomain = new Map();
  const orphanProjects = [];
  for (const p of projects) {
    if (p.domain_id) { const list = projectsByDomain.get(p.domain_id) ?? []; list.push(p); projectsByDomain.set(p.domain_id, list); }
    else orphanProjects.push(p);
  }
  if (inbox) selSel.append(el('option', { value: `domain:${inbox.id}` }, '📥 Inbox (default — for unsorted tasks)'));
  for (const d of userDomains) {
    const grp = el('optgroup', { label: d.name });
    grp.append(el('option', { value: `domain:${d.id}` }, `${d.name} (domain)`));
    for (const p of projectsByDomain.get(d.id) ?? []) grp.append(el('option', { value: `project:${p.id}` }, p.name));
    selSel.append(grp);
  }
  if (orphanProjects.length) {
    const grp = el('optgroup', { label: 'Other projects' });
    for (const p of orphanProjects) grp.append(el('option', { value: `project:${p.id}` }, p.name));
    selSel.append(grp);
  }
  selSel.value = v.project_id ? `project:${v.project_id}` : `domain:${v.domain_id ?? inbox?.id ?? ''}`;

  const milestoneSlot = el('div', {});
  function paintMilestones() {
    milestoneSlot.replaceChildren();
    if (!v.project_id) return;
    const opts = ref.milestones.filter((m) => m.project_id === v.project_id);
    if (!opts.length) return;
    const sel = el('select', { onchange: (e) => { v.milestone_id = e.target.value || null; } });
    sel.append(el('option', { value: '' }, 'General (no milestone)'));
    for (const m of opts) sel.append(el('option', { value: m.id }, m.title));
    sel.value = v.milestone_id ?? '';
    milestoneSlot.append(el('div', { class: 'field' }, el('label', {}, 'Milestone'), sel));
  }
  paintMilestones();

  const contentSel = el('select', { onchange: (e) => { v.content_item_id = e.target.value || null; } });
  contentSel.append(el('option', { value: '' }, '(none)'));
  for (const c of ref.contentItems.filter((c) => c.status !== 'done' && c.status !== 'published')) {
    contentSel.append(el('option', { value: c.id }, c.title));
  }
  contentSel.value = v.content_item_id ?? '';

  const remindSel = el('select', { onchange: (e) => { v.reminder_offsets = e.target.value === '' ? [] : [Number(e.target.value)]; } });
  remindSel.append(el('option', { value: '' }, 'No reminder'));
  for (const r of REMINDERS) remindSel.append(el('option', { value: r.value }, r.value === 0 ? 'At due time' : `${r.label} before`));
  remindSel.value = v.reminder_offsets.length ? String(Math.min(...v.reminder_offsets)) : '';

  const recurSel = el('select', { onchange: (e) => { v.recurrence_rule = e.target.value; } });
  for (const r of RECURRENCE_OPTIONS) recurSel.append(el('option', { value: r.value }, r.label));
  recurSel.value = v.recurrence_rule;

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add task' : 'Save');

  mount.replaceChildren(
    screenHead('Task', isNew ? 'New task' : (row?.title || 'Edit task'), {
      actions: [el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => go('#/tasks') }, '‹')],
    }),
    !isNew ? statusRow(row, id, mount) : null,
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
