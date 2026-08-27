// Project detail — a port of apps/web's projects/[id]/page.tsx (Detail Pages
// v2 Addendum 10 §6) plus its sub-components (checklist-section.tsx,
// milestones-section.tsx, contacts-section.tsx, log-time-form.tsx,
// activity-row.tsx) and projects/project-form.tsx + new/page.tsx. Was
// previously reached only through the generic schema-driven form (a real
// gap Taylor caught by asking whether every sub-page was actually done).
//
// Conversations reuse lib/conversations.js, already shared by Person/Company
// detail. Task rows reuse views/tasks.js's exported taskRow — the same row
// component the Tasks list and Today use.

import { sb, ref, refName } from '../lib/db.js';
import { el, hint, spinner, pill, toast, fail, confirmDelete, niceDate, today, localDateOf } from '../lib/ui.js';
import { go } from '../lib/router.js';
import {
  detailHeader, crumbDot, actionButton, statStrip, stat, workCounts,
  detailBody, detailSection, railBlock, kv, editDrawer,
} from '../lib/detail-shell.js';
import { taskRow, openNewTaskSheet } from './tasks.js';
import { conversationTimeline, logConversationForm } from '../lib/conversations.js';
import {
  PROJECT_COLOR_PALETTE, retainerCycle, buildMilestoneGroups, buildDueGroups,
  parseHours, RECURRENCE_PATTERNS, RECURRENCE_LABELS, isCurrentlyDoneRecurring,
} from '../lib/projects.js';

const STATUS_LABELS = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z')) / 86_400_000);
}

export async function projectDetail(mount, { id }) {
  mount.replaceChildren(spinner());

  const [projectRes, milestonesRes, checklistRes, activityRes, tasksRes, contactsRes, conversationsRes] = await Promise.all([
    sb.from('projects').select('*, company:companies(id,name), primary_contact:people!primary_contact_id(id,name,email,role_at_company)').eq('id', id).single(),
    sb.from('milestones').select('*').eq('project_id', id).order('position'),
    sb.from('project_checklist_items').select('*').eq('project_id', id).order('position'),
    sb.from('activity_log').select('*').eq('project_id', id).order('logged_at', { ascending: false }),
    sb.from('tasks').select('*').eq('project_id', id),
    sb.from('project_contacts').select('*, person:people(id,name,role_at_company)').eq('project_id', id).order('created_at'),
    sb.from('conversations').select('*, company:companies(id,name), person:people(id,name)').eq('project_id', id).order('occurred_at', { ascending: false }),
  ]);
  if (projectRes.error) { mount.replaceChildren(hint(projectRes.error.message)); return; }

  const project = projectRes.data;
  const milestones = milestonesRes.data ?? [];
  const checklist = checklistRes.data ?? [];
  const activity = activityRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const contacts = contactsRes.data ?? [];
  const conversations = conversationsRes.data ?? [];
  const t = today();

  let groupMode = null; // resolved to a default below once we know shape

  function refresh() { projectDetail(mount, { id }); }

  const isArea = project.kind === 'area';
  const isRetainer = !isArea && project.engagement_type === 'retainer';
  const openTasks = tasks.filter((x) => x.status === 'open');
  const waitingTasks = tasks.filter((x) => x.status === 'waiting');
  const doneTasks = tasks.filter((x) => x.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const doneToday = doneTasks.filter((x) => localDateOf(x.completed_at) === t);

  const overdueCount = openTasks.filter((x) => x.due_date && x.due_date < t).length;
  const dueTodayCount = openTasks.filter((x) => x.due_date === t).length;
  const livePool = [...openTasks, ...waitingTasks];

  const defaultMode = !isRetainer && !isArea && milestones.length > 0 ? 'milestone' : 'due';
  if (!groupMode) groupMode = defaultMode;

  const hoursLogged = Number(project.hours_logged ?? 0);
  const quoted = project.quoted_hours != null ? Number(project.quoted_hours) : null;
  const now = new Date();
  const hoursInMonth = (monthOffset) => {
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    return activity.filter((a) => a.kind === 'work' && a.hours_logged != null)
      .filter((a) => { const d = new Date(a.logged_at); return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth(); })
      .reduce((s, a) => s + Number(a.hours_logged), 0);
  };
  const hoursThisMonth = hoursInMonth(0);
  const hoursLastMonth = hoursInMonth(-1);

  const totalWeight = milestones.reduce((s, m) => s + (m.weight ?? 0), 0);
  const doneWeight = milestones.filter((m) => m.status === 'done').reduce((s, m) => s + (m.weight ?? 0), 0);
  const pct = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : null;

  const cycle = isRetainer && project.retainer_anchor_day != null ? retainerCycle(project.retainer_anchor_day, t) : null;

  const lastActivityDays = activity[0]?.logged_at ? daysBetween(activity[0].logged_at, t) : null;
  const activityStale = isRetainer && lastActivityDays != null && lastActivityDays >= (cycle?.length ?? 30);

  const stateChip = overdueCount > 0 ? { s: 'over', label: `${overdueCount} overdue` }
    : waitingTasks.length > 0 ? { s: 'due', label: `${waitingTasks.length} waiting` }
    : dueTodayCount > 0 ? { s: 'due', label: 'Due today' }
    : { s: 'quiet', label: 'Quiet' };

  const domainName = refName('domain', project.domain_id);

  function paintTasks(section) {
    const taskGroups = groupMode === 'milestone' ? buildMilestoneGroups(livePool, milestones) : buildDueGroups(livePool, t);
    section.replaceChildren(
      livePool.length === 0 ? el('p', { class: 'briefing-empty' }, 'No open tasks.') : el('div', {},
        el('div', { style: 'display:flex; align-items:center; gap:14px; margin-bottom:14px' },
          el('span', { class: 'eyebrow' }, 'Group by'),
          groupByLink('Milestone', groupMode === 'milestone', () => { groupMode = 'milestone'; paintTasks(section); }),
          groupByLink('Due window', groupMode === 'due', () => { groupMode = 'due'; paintTasks(section); }),
        ),
        ...taskGroups.map((g) => el('div', { style: 'margin-bottom:22px' },
          el('div', { style: 'display:flex; align-items:baseline; gap:10px; margin-bottom:6px' },
            el('span', { style: `font-family:var(--sans); font-size:14px; font-weight:600; color:${g.muted ? 'var(--ink-3)' : 'var(--ink)'}` }, g.title),
            el('span', { style: `font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:${g.accent ? 'var(--accent)' : 'var(--ink-3)'}` }, g.meta),
          ),
          ...g.tasks.map((tk) => taskRow(tk, refresh)),
        )),
      ),
    );
  }

  const taskSection = el('div');
  paintTasks(taskSection);

  const header = detailHeader({
    crumb: [
      el('button', { class: 'linkish', type: 'button', onclick: () => go('#/work') }, isArea ? 'Area' : 'Project'),
      domainName ? crumbDot() : null, domainName ? el('span', {}, domainName) : null,
      isRetainer ? crumbDot() : null, isRetainer ? el('span', {}, 'Retainer') : null,
      project.status !== 'active' ? crumbDot() : null, project.status !== 'active' ? el('span', {}, STATUS_LABELS[project.status]) : null,
    ].filter(Boolean),
    name: project.name,
    color: project.color,
    state: pill(stateChip.s, stateChip.label),
    actions: [
      actionButton({ onClick: () => openNewTaskSheet() }, '+ Task'),
      actionButton({ onClick: () => document.getElementById('log-work')?.scrollIntoView({ behavior: 'smooth' }) }, '+ Log work'),
      actionButton({ onClick: () => document.getElementById('conversations')?.scrollIntoView({ behavior: 'smooth' }) }, '+ Conversation'),
      editDrawer(`Edit ${isArea ? 'area' : 'project'}`, projectForm(project, refresh)),
    ],
  });

  const strip = statStrip(
    isRetainer
      ? stat({ label: 'Hours · this month', value: hoursThisMonth.toFixed(1), unit: 'h', sub: `${hoursLastMonth.toFixed(1)}h last · ${hoursLogged.toFixed(1)}h all-time${quoted != null ? ` · cap ${quoted.toFixed(1)}h` : ''}` })
      : pct != null ? stat({ label: 'Progress · milestone-weighted', value: pct, unit: '%', sub: `${doneWeight}/${totalWeight} weight done` })
      : stat({ label: 'Hours · all-time', value: hoursLogged.toFixed(1), unit: 'h', sub: quoted != null ? `of ${quoted.toFixed(1)}h quoted` : 'no quote set' }),
    stat({ label: 'Work', body: workCounts({ open: openTasks.length, overdue: overdueCount, waiting: waitingTasks.length }) }),
    isRetainer
      ? (cycle ? stat({ label: 'Retainer cycle', value: `Day ${cycle.day}`, unit: `/ ${cycle.length}`, sub: 'billing cycle' }) : stat({ label: 'Retainer cycle', value: '—', sub: 'set anchor day in Edit' }))
      : project.target_date ? stat({ label: 'Target date', value: niceDate(project.target_date), tone: project.target_date < t ? 'accent' : undefined, sub: `${Math.abs(daysBetween(project.target_date, t))}d ${project.target_date < t ? 'passed' : 'out'}` })
      : stat({ label: 'Milestones', value: milestones.length || '—', sub: milestones.length ? 'defined' : 'none yet' }),
    stat({ label: 'Last activity', tone: activityStale ? 'warn' : undefined, value: lastActivityDays ?? '—', unit: lastActivityDays != null ? (lastActivityDays === 1 ? 'day ago' : 'days ago') : undefined, sub: lastActivityDays == null ? 'nothing logged' : activityStale ? 'check-in pending' : undefined }),
  );

  const activitySlot = el('div');
  paintActivity(activitySlot, project, activity, refresh);

  const convSlot = el('div');
  paintConversations(convSlot, project.id, conversations, refresh);

  const main = [
    detailSection({ label: 'Tasks', count: `${openTasks.length} open${overdueCount ? ` · ${overdueCount} overdue` : ''}${waitingTasks.length ? ` · ${waitingTasks.length} waiting` : ''}`, action: el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => openNewTaskSheet() }, '+ Add task') }, taskSection),
    el('section', { id: 'log-work', style: 'margin-top:30px' }, detailSection({ label: 'Activity', count: activity.length || undefined }, activitySlot)),
    el('section', { id: 'conversations', style: 'margin-top:30px' }, detailSection({ label: 'Conversations', count: conversations.length || undefined }, convSlot)),
    doneTasks.length > 0 ? el('details', { style: 'margin-top:30px' },
      el('summary', { class: 'eyebrow', style: 'cursor:pointer; list-style:none; padding-bottom:8px; border-bottom:1px solid var(--line)' }, `✓ ${doneTasks.length} done${doneToday.length ? ` (${doneToday.length} today)` : ''}`),
      el('div', { style: 'margin-top:10px' }, ...doneTasks.map((tk) => taskRow(tk, refresh))),
    ) : null,
  ].filter(Boolean);

  const contactsSlot = el('div');
  paintContacts(contactsSlot, project, contacts, refresh);
  const checklistSlot = el('div');
  paintChecklist(checklistSlot, id, checklist, refresh);

  const rail = [
    contactsSlot,
    (!isRetainer && !isArea) ? milestonesBlock(id, milestones, refresh) : null,
    checklistSlot,
    railBlock('Details',
      kv('Engagement', isArea ? 'Area' : isRetainer ? 'Retainer' : 'Project'),
      !isRetainer ? kv('Hours', `${hoursLogged.toFixed(1)}h${quoted != null ? ` / ${quoted.toFixed(1)}h quoted` : ' logged'}`) : null,
      isRetainer ? kv('Anchor day', project.retainer_anchor_day != null ? String(project.retainer_anchor_day) : '—') : null,
      project.target_date ? kv('Target', niceDate(project.target_date), project.target_date < t) : null,
      kv('Status', STATUS_LABELS[project.status] ?? project.status),
      project.start_date ? kv('Started', niceDate(project.start_date)) : null,
    ),
  ].filter(Boolean);

  mount.replaceChildren(header, strip, detailBody(main, rail));
}

function groupByLink(label, active, onClick) {
  return el('button', {
    type: 'button', onclick: onClick,
    style: `background:none; border:none; padding:0 0 2px; cursor:pointer; font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; border-bottom:1px solid ${active ? 'var(--ink)' : 'transparent'}; color:${active ? 'var(--ink)' : 'var(--ink-3)'}`,
  }, label);
}

// ─── Activity log ───────────────────────────────────────────────────────

function paintActivity(slot, project, activity, refresh) {
  let kind = 'work';
  const entryInput = el('input', { type: 'text', placeholder: 'What did you work on?' });
  const hoursInput = el('input', { type: 'text', placeholder: '1h30m', style: 'width:100px; text-align:center' });
  const whenInput = el('input', { type: 'datetime-local' });
  const msg = el('div', {});
  const workBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: () => { kind = 'work'; paintKind(); } }, 'Work');
  const updateBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: () => { kind = 'update'; paintKind(); } }, '📌 Update');
  const hoursField = el('div', {}, hoursInput);
  function paintKind() {
    workBtn.setAttribute('aria-pressed', String(kind === 'work'));
    updateBtn.setAttribute('aria-pressed', String(kind === 'update'));
    entryInput.placeholder = kind === 'work' ? 'What did you work on?' : 'What happened? (client win, status change…)';
    hoursField.style.display = kind === 'work' ? '' : 'none';
  }
  paintKind();

  const logBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
    const entry = entryInput.value.trim();
    if (!entry) { msg.replaceChildren(hint('Describe what happened.')); return; }
    let hours = null;
    if (kind === 'work' && hoursInput.value.trim()) {
      hours = parseHours(hoursInput.value);
      if (hours === null) { msg.replaceChildren(hint('Hours: use a number, "1h30m", or "45m".')); return; }
    }
    logBtn.disabled = true;
    const payload = { project_id: project.id, entry, hours_logged: hours, kind };
    if (whenInput.value) payload.logged_at = new Date(whenInput.value).toISOString();
    const { error } = await sb.from('activity_log').insert(payload);
    if (!error && hours) {
      await sb.from('projects').update({ hours_logged: Number(project.hours_logged ?? 0) + hours }).eq('id', project.id);
    }
    logBtn.disabled = false;
    if (error) { fail(error); return; }
    toast('Logged');
    refresh();
  } }, 'Log');

  const form = el('div', {},
    el('div', { class: 'chips', style: 'margin-bottom:8px' }, workBtn, updateBtn),
    el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px' }, entryInput, hoursField, whenInput, logBtn),
    msg,
  );

  const rows = activity.length === 0
    ? el('p', { class: 'briefing-empty' }, 'No activity logged yet.')
    : el('ul', { style: 'list-style:none; padding:0; margin-top:4px' }, ...activity.map((a) => activityRow(a, project, refresh)));

  slot.replaceChildren(form, rows,
    activity.length ? el('div', { style: 'margin-top:8px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); font-style:italic' }, 'Click any row to edit the entry, hours, or timestamp.') : el('span'));
}

function activityRow(entry, project, refresh) {
  let editing = false;
  const wrap = el('li', { style: 'border-bottom:1px solid var(--line); padding:9px 0' });

  function paint() {
    if (!editing) {
      const when = niceDate(entry.logged_at.slice(0, 10)) + ' ' + new Date(entry.logged_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const isUpdate = entry.kind === 'update';
      const hours = Number(entry.hours_logged ?? 0);
      wrap.replaceChildren(el('div', { style: `display:flex; align-items:flex-start; gap:14px; ${isUpdate ? 'border-left:2px solid var(--accent); padding-left:10px' : ''}` },
        el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none; width:110px; flex:0 0 auto; text-align:left; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)', onclick: () => { editing = true; paint(); } }, when),
        el('div', { style: 'flex:1; min-width:0' },
          isUpdate ? el('div', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent); margin-bottom:2px' }, '📌 Update') : null,
          el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none; text-align:left; display:block; width:100%; font-family:var(--sans); font-size:13px; color:var(--ink)', onclick: () => { editing = true; paint(); } }, entry.entry),
          (hours > 0 && !isUpdate) ? el('div', { style: 'margin-top:2px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, `${hours.toFixed(2)}h${entry.source === 'voice' ? ' · voice' : entry.source === 'manual' ? ' · manual' : ''}`) : null,
        ),
        el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', title: hours > 0 ? `Delete · rolls back ${hours.toFixed(2)}h` : 'Delete entry', onclick: async () => {
          const { error } = await sb.from('activity_log').delete().eq('id', entry.id);
          if (error) { fail(error); return; }
          if (hours > 0) await sb.from('projects').update({ hours_logged: Math.max(0, Number(project.hours_logged ?? 0) - hours) }).eq('id', project.id);
          toast('Deleted');
          refresh();
        } }, '✕'),
      ));
      return;
    }
    const entryInput = el('input', { type: 'text', value: entry.entry });
    const hoursInput = el('input', { type: 'text', placeholder: '1h30m', style: 'width:100px; text-align:center' });
    hoursInput.value = entry.hours_logged ? Number(entry.hours_logged).toString() : '';
    const whenInput = el('input', { type: 'datetime-local' });
    whenInput.value = toLocalInput(entry.logged_at);
    const errMsg = el('span', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent)' });
    const saveBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
      const newEntry = entryInput.value.trim();
      if (!newEntry) { errMsg.textContent = 'Describe what you did.'; return; }
      const newHours = hoursInput.value.trim() ? parseHours(hoursInput.value) : null;
      if (hoursInput.value.trim() && newHours === null) { errMsg.textContent = 'Hours: use a number, "1h30m", or "45m".'; return; }
      const oldHours = Number(entry.hours_logged ?? 0);
      const payload = { entry: newEntry, hours_logged: newHours };
      if (whenInput.value) payload.logged_at = new Date(whenInput.value).toISOString();
      const { error } = await sb.from('activity_log').update(payload).eq('id', entry.id);
      if (!error) {
        const delta = (newHours ?? 0) - oldHours;
        if (delta !== 0) await sb.from('projects').update({ hours_logged: Math.max(0, Number(project.hours_logged ?? 0) + delta) }).eq('id', project.id);
      }
      if (error) { fail(error); return; }
      toast('Saved');
      refresh();
    } }, 'Save');
    const cancelBtn = el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => { editing = false; paint(); } }, 'Cancel');
    wrap.replaceChildren(el('div', { style: 'background:var(--surface-2); padding:10px; border-radius:5px; display:flex; flex-direction:column; gap:8px' },
      el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px' }, entryInput, hoursInput, whenInput),
      el('div', { style: 'display:flex; align-items:center; gap:10px' }, saveBtn, cancelBtn, errMsg),
    ));
  }
  paint();
  return wrap;
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Conversations ──────────────────────────────────────────────────────

function paintConversations(slot, projectId, conversations, refresh) {
  slot.replaceChildren(
    conversationTimeline(conversations, { scope: 'project', refresh }),
    logConversationForm({ project_id: projectId }, refresh),
  );
}

// ─── Milestones ─────────────────────────────────────────────────────────

function milestonesBlock(projectId, milestones, refresh) {
  const totalWeight = milestones.reduce((s, m) => s + m.weight, 0);
  const doneWeight = milestones.filter((m) => m.status === 'done').reduce((s, m) => s + m.weight, 0);
  const progressPct = totalWeight === 0 ? 0 : Math.round((doneWeight / totalWeight) * 100);
  const label = milestones.length === 0 ? 'Milestones' : `Milestones · ${progressPct}%`;

  const titleInput = el('input', { type: 'text', placeholder: '+ Add milestone…' });
  const weightInput = el('input', { type: 'number', value: '1', min: '1', step: '1', style: 'width:50px; text-align:center' });
  const addBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
    if (!titleInput.value.trim()) return;
    const { error } = await sb.from('milestones').insert({ project_id: projectId, title: titleInput.value.trim(), weight: Number(weightInput.value) || 1, position: milestones.length });
    if (error) { fail(error); return; }
    refresh();
  } }, 'Add');

  return railBlock(label,
    milestones.length === 0 ? el('p', { class: 'briefing-empty' }, 'No milestones yet. Add weighted checkpoints to track progress.') : null,
    ...milestones.map((m) => milestoneRow(projectId, m, refresh)),
    el('div', { class: 'row', style: 'margin-top:10px; gap:8px' }, titleInput, weightInput, addBtn),
  );
}

function milestoneRow(projectId, m, refresh) {
  const isDone = m.status === 'done';
  const editOpen = el('details', {},
    el('summary', { style: 'cursor:pointer; list-style:none; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, 'Edit'),
    (() => {
      const titleInput = el('input', { type: 'text', value: m.title });
      const weightInput = el('input', { type: 'number', value: String(m.weight), min: '1', step: '1', style: 'width:60px' });
      const saveBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
        const { error } = await sb.from('milestones').update({ title: titleInput.value.trim(), weight: Number(weightInput.value) || 1 }).eq('id', m.id);
        if (error) { fail(error); return; }
        refresh();
      } }, 'Save');
      const delBtn = el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async () => {
        const { error } = await sb.from('milestones').delete().eq('id', m.id);
        if (error) { fail(error); return; }
        toast('Deleted');
        refresh();
      } }, 'Delete milestone');
      return el('div', { style: 'display:flex; flex-direction:column; gap:8px; margin-top:8px' },
        el('div', { class: 'row' }, titleInput, weightInput),
        el('div', {}, saveBtn), delBtn,
      );
    })(),
  );

  return el('div', { style: 'display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-bottom:1px solid var(--line)' },
    el('button', {
      type: 'button', style: `margin-top:2px; width:18px; height:18px; flex:0 0 auto; border:1px solid ${isDone ? 'var(--ink-2)' : 'var(--line-strong)'}; background:${isDone ? 'var(--ink-2)' : 'none'}; color:var(--bg); cursor:pointer`,
      onclick: async () => {
        const { error } = await sb.from('milestones').update({ status: isDone ? 'open' : 'done', completed_at: isDone ? null : new Date().toISOString() }).eq('id', m.id);
        if (error) { fail(error); return; }
        refresh();
      },
    }, isDone ? '✓' : ''),
    el('div', { style: 'flex:1; min-width:0' },
      el('div', { style: `font-family:var(--sans); font-size:14px; color:${isDone ? 'var(--ink-3)' : 'var(--ink)'}; ${isDone ? 'text-decoration:line-through' : ''}` }, m.title),
      m.weight !== 1 ? el('div', { style: 'margin-top:2px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, `weight ${m.weight}`) : null,
    ),
    editOpen,
  );
}

// ─── Checklist ──────────────────────────────────────────────────────────

function currentlyDone(item) {
  if (item.recurrence_rule && RECURRENCE_PATTERNS.includes(item.recurrence_rule)) {
    return isCurrentlyDoneRecurring(item.done, item.done_at, item.recurrence_rule);
  }
  return item.done;
}

function paintChecklist(slot, projectId, items, refresh) {
  const decorated = items.map((i) => ({ item: i, done: currentlyDone(i) }));
  const doneCount = decorated.filter((d) => d.done).length;
  const label = items.length > 0 ? `Checklist · ${doneCount}/${items.length}` : 'Checklist';

  const titleInput = el('input', { type: 'text', placeholder: 'Add a checklist item…' });
  const recurSel = el('select', {});
  recurSel.append(el('option', { value: '' }, 'One-shot (default)'));
  for (const p of RECURRENCE_PATTERNS) recurSel.append(el('option', { value: p }, RECURRENCE_LABELS[p]));
  const addBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
    if (!titleInput.value.trim()) return;
    const { error } = await sb.from('project_checklist_items').insert({ project_id: projectId, title: titleInput.value.trim(), position: items.length, recurrence_rule: recurSel.value || null });
    if (error) { fail(error); return; }
    refresh();
  } }, 'Add');

  slot.replaceChildren(railBlock(label,
    items.length === 0 ? el('p', { class: 'briefing-empty' }, 'No checklist yet — sub-steps or recurring items (weekly report, monthly invoice…) live well here.') : null,
    ...decorated.map(({ item, done }) => checklistRow(projectId, item, done, refresh)),
    el('div', { style: 'margin-top:10px; display:flex; flex-direction:column; gap:6px' }, titleInput, el('div', { class: 'row' }, recurSel, addBtn)),
  ));
}

function checklistRow(projectId, item, done, refresh) {
  const rule = item.recurrence_rule;
  return el('div', { style: 'display:flex; align-items:center; gap:10px; padding:6px 0' },
    el('button', {
      type: 'button', style: `width:18px; height:18px; flex:0 0 auto; border:1px solid ${done ? 'var(--ink)' : 'var(--line-strong)'}; background:${done ? 'var(--ink)' : 'none'}; color:var(--bg); cursor:pointer`,
      onclick: async () => {
        const { error } = await sb.from('project_checklist_items').update({ done: !done, done_at: done ? null : new Date().toISOString() }).eq('id', item.id);
        if (error) { fail(error); return; }
        refresh();
      },
    }, done ? '✓' : ''),
    el('span', { style: `flex:1; min-width:0; font-family:var(--sans); font-size:14px; color:${done ? 'var(--ink-3)' : 'var(--ink)'}; ${done ? 'text-decoration:line-through' : ''}` }, item.title),
    rule ? el('span', { title: `Recurs ${RECURRENCE_LABELS[rule].toLowerCase()}`, style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); flex:0 0 auto' }, `↻ ${RECURRENCE_LABELS[rule]}`) : null,
    el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none; flex:0 0 auto', onclick: async () => {
      const { error } = await sb.from('project_checklist_items').delete().eq('id', item.id);
      if (error) { fail(error); return; }
      refresh();
    } }, '✕'),
  );
}

// ─── Contacts ───────────────────────────────────────────────────────────

function paintContacts(slot, project, contacts, refresh) {
  const hasAnything = project.company || project.primary_contact || contacts.length > 0;
  const attachedIds = new Set(contacts.map((c) => c.person?.id).filter(Boolean));
  const available = ref.people.filter((p) => !attachedIds.has(p.id));

  let addOpen = false;
  const addSlot = el('div');
  function paintAdd() {
    if (!addOpen) { addSlot.replaceChildren(el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => { addOpen = true; paintAdd(); } }, '+ Add contact')); return; }
    const personSel = el('select', {});
    personSel.append(el('option', { value: '' }, available.length === 0 ? 'No people available…' : 'Select a person…'));
    for (const p of available) personSel.append(el('option', { value: p.id }, p.name));
    const roleInput = el('input', { type: 'text', placeholder: 'Role (optional)' });
    const errMsg = el('span', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent)' });
    const addBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
      if (!personSel.value) return;
      const { error } = await sb.from('project_contacts').insert({ project_id: project.id, person_id: personSel.value, role: roleInput.value.trim() || null });
      if (error) { errMsg.textContent = error.message; return; }
      toast('Added');
      refresh();
    } }, 'Add');
    const cancelBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: () => { addOpen = false; paintAdd(); } }, 'Cancel');
    addSlot.replaceChildren(el('div', { style: 'display:flex; flex-direction:column; gap:8px' }, personSel, roleInput, el('div', { class: 'row' }, addBtn, cancelBtn), errMsg));
  }
  paintAdd();

  slot.replaceChildren(railBlock('Client / contacts',
    project.company ? kv('Company', el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/companies/${project.company.id}`) }, project.company.name)) : null,
    project.primary_contact ? kv('Primary', el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/people/${project.primary_contact.id}`) }, project.primary_contact.name + (project.primary_contact.role_at_company ? ` · ${project.primary_contact.role_at_company}` : ''))) : null,
    contacts.length > 0 ? el('div', { style: 'margin-top:8px' }, ...contacts.map((c) => contactRow(project.id, c, refresh))) : (!hasAnything ? el('p', { class: 'briefing-empty' }, 'No client or contacts yet.') : null),
    el('div', { style: 'margin-top:10px' }, addSlot),
  ));
}

function contactRow(projectId, contact, refresh) {
  const person = contact.person;
  return el('div', { style: 'display:flex; align-items:baseline; gap:10px; padding:7px 0; border-bottom:1px solid var(--line)' },
    el('span', { style: 'flex:1; min-width:0; font-family:var(--sans); font-size:14px; color:var(--ink)' },
      person ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/people/${person.id}`) }, person.name) : el('span', { style: 'font-style:italic; color:var(--ink-3)' }, 'Unknown person'),
      (contact.role || person?.role_at_company) ? el('span', { style: 'color:var(--ink-3)' }, ` · ${contact.role || person.role_at_company}`) : null,
    ),
    el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async () => {
      const { error } = await sb.from('project_contacts').delete().eq('id', contact.id);
      if (error) { fail(error); return; }
      refresh();
    } }, '✕'),
  );
}

// ─── Form (edit drawer + /c/projects/new) ──────────────────────────────

function projectForm(row, onSaved) {
  const isNew = !row?.id;
  const v = {
    name: row?.name ?? '', description: row?.description ?? '', domain_id: row?.domain_id ?? '',
    type: row?.type ?? '', status: row?.status ?? 'active', engagement_type: row?.engagement_type ?? 'project',
    kind: row?.kind ?? 'project', quoted_hours: row?.quoted_hours != null ? String(row.quoted_hours) : '',
    retainer_anchor_day: row?.retainer_anchor_day != null ? String(row.retainer_anchor_day) : '',
    start_date: row?.start_date ?? '', target_date: row?.target_date ?? '', color: row?.color ?? '',
  };

  const nameInput = el('input', { type: 'text', oninput: (e) => { v.name = e.target.value; } }); nameInput.value = v.name;
  const descInput = el('textarea', { rows: 2, oninput: (e) => { v.description = e.target.value; } }); descInput.value = v.description;
  const domainSel = el('select', { onchange: (e) => { v.domain_id = e.target.value; } });
  domainSel.append(el('option', { value: '' }, '(none)'));
  for (const d of ref.domains) domainSel.append(el('option', { value: d.id }, d.name));
  domainSel.value = v.domain_id;
  const typeSel = el('select', { onchange: (e) => { v.type = e.target.value; } });
  for (const [val, label] of [['', '(none)'], ['client', 'Client'], ['internal', 'Internal'], ['content', 'Content']]) typeSel.append(el('option', { value: val }, label));
  typeSel.value = v.type;
  const statusSel = el('select', { onchange: (e) => { v.status = e.target.value; } });
  for (const [val, label] of [['active', 'Active'], ['paused', 'Paused'], ['done', 'Done'], ['archived', 'Archived']]) statusSel.append(el('option', { value: val }, label));
  statusSel.value = v.status;
  const startInput = el('input', { type: 'date', oninput: (e) => { v.start_date = e.target.value; } }); startInput.value = v.start_date;
  const targetInput = el('input', { type: 'date', oninput: (e) => { v.target_date = e.target.value; } }); targetInput.value = v.target_date;
  const quotedInput = el('input', { type: 'number', step: '0.25', min: '0', oninput: (e) => { v.quoted_hours = e.target.value; } }); quotedInput.value = v.quoted_hours;
  const anchorInput = el('input', { type: 'number', min: '1', max: '31', oninput: (e) => { v.retainer_anchor_day = e.target.value; } }); anchorInput.value = v.retainer_anchor_day;

  const kindSlot = el('div');
  const conditionalSlot = el('div');

  function paintKind() {
    kindSlot.replaceChildren(el('div', { class: 'row' },
      el('button', { type: 'button', class: 'chip', style: `flex:1; height:auto; padding:8px; text-align:left; ${v.kind === 'project' ? 'border-color:var(--ink)' : ''}`, 'aria-pressed': String(v.kind === 'project'), onclick: () => { v.kind = 'project'; paintKind(); paintConditional(); } }, 'Project'),
      el('button', { type: 'button', class: 'chip', style: `flex:1; height:auto; padding:8px; text-align:left; ${v.kind === 'area' ? 'border-color:var(--ink)' : ''}`, 'aria-pressed': String(v.kind === 'area'), onclick: () => { v.kind = 'area'; paintKind(); paintConditional(); } }, 'Area'),
    ));
  }
  function paintConditional() {
    const isArea = v.kind === 'area';
    conditionalSlot.replaceChildren(el('div', {},
      !isArea ? field('Engagement', el('div', { class: 'row' },
        el('button', { type: 'button', class: 'chip', style: `flex:1; ${v.engagement_type === 'project' ? 'border-color:var(--ink)' : ''}`, onclick: () => { v.engagement_type = 'project'; paintConditional(); } }, 'Project'),
        el('button', { type: 'button', class: 'chip', style: `flex:1; ${v.engagement_type === 'retainer' ? 'border-color:var(--ink)' : ''}`, onclick: () => { v.engagement_type = 'retainer'; paintConditional(); } }, 'Retainer'),
      )) : null,
      !isArea ? el('div', { class: 'row' }, field('Start date', startInput), field('Target date', targetInput)) : null,
      !isArea ? field(v.engagement_type === 'retainer' ? 'Monthly hours cap' : 'Quoted hours', quotedInput) : null,
      (!isArea && v.engagement_type === 'retainer') ? field('Cycle anchor day (1–31)', anchorInput) : null,
    ));
  }
  paintKind();
  paintConditional();

  const swatch = el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px' });
  function paintSwatch() {
    swatch.replaceChildren(
      el('button', { type: 'button', title: 'No color', style: `width:28px; height:28px; border:2px solid ${v.color === '' ? 'var(--ink)' : 'var(--line-strong)'}; background:none; color:var(--ink-3); font:inherit`, onclick: () => { v.color = ''; paintSwatch(); } }, '—'),
      ...PROJECT_COLOR_PALETTE.map((c) => el('button', { type: 'button', title: c, style: `width:28px; height:28px; border:2px solid ${v.color === c ? 'var(--ink)' : 'var(--line-strong)'}; background:${c}`, onclick: () => { v.color = c; paintSwatch(); } })),
    );
  }
  paintSwatch();

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? (v.kind === 'area' ? 'Create area' : 'Create project') : 'Save');
  const wrap = el('div', {},
    field('Type', kindSlot),
    field('Name (required)', nameInput),
    field('Description', descInput),
    conditionalSlot,
    el('div', { class: 'row' }, field('Domain', domainSel), field('Type', typeSel)),
    isNew ? null : field('Status', statusSel),
    field('Color', swatch),
    el('div', { class: 'form-actions', style: 'margin-top:14px' }, save),
    isNew ? null : el('p', { class: 'hint' }, 'Delete cascades to milestones/checklist/activity — linked tasks stay, just unlinked.'),
    isNew ? null : el('div', { class: 'row' }, el('button', { class: 'ghost danger', style: 'width:auto', type: 'button', onclick: onDelete }, `Delete ${v.kind === 'area' ? 'area' : 'project'}…`)),
  );

  async function onSave() {
    if (!v.name.trim()) { toast('Name is required.', 'err'); return; }
    save.disabled = true;
    const isArea = v.kind === 'area';
    const payload = {
      name: v.name.trim(), description: v.description.trim() || null, domain_id: v.domain_id || null,
      type: v.type || null, engagement_type: isArea ? 'project' : v.engagement_type, kind: v.kind,
      quoted_hours: isArea ? null : (v.quoted_hours === '' ? null : Number(v.quoted_hours)),
      retainer_anchor_day: (!isArea && v.engagement_type === 'retainer') ? (Number(v.retainer_anchor_day) || null) : null,
      start_date: isArea ? null : (v.start_date || null), target_date: isArea ? null : (v.target_date || null),
      color: v.color || null,
    };
    if (!isNew) payload.status = v.status;
    const res = isNew ? await sb.from('projects').insert(payload).select('id').single() : await sb.from('projects').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Created' : 'Saved');
    if (isNew) go(`#/c/projects/${res.data.id}`); else onSaved?.();
  }
  async function onDelete() {
    if (!confirmDelete(`"${row.name}" — linked tasks stay, just unlinked`)) return;
    const { error } = await sb.from('projects').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/work');
  }
  return wrap;
}

function field(label, node) { return el('div', { class: 'field' }, el('label', {}, label), node); }

export async function projectNew(mount) {
  mount.replaceChildren(el('div', { class: 'lib-reader' },
    el('div', { class: 'lib-crumb' }, el('button', { class: 'linkish', type: 'button', onclick: () => go('#/work') }, '← Work')),
    el('header', { class: 'screen-head', style: 'padding:16px 0 20px' }, el('div', { class: 'eyebrow' }, 'Capture'), el('h1', {}, 'New project')),
    projectForm(null),
  ));
}
