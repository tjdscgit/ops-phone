// Companies — the CRM. A port of companies-view.tsx (list), company-form.tsx
// (edit) and [id]/page.tsx (detail: needs-response, conversations, project
// portfolio, open-task rollup).

import { sb, ref } from '../lib/db.js';
import { el, hint, spinner, pill, toast, fail, confirmDelete, today } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { openSheet } from '../app.js';
import { conversationTimeline, logConversationForm } from '../lib/conversations.js';
import {
  detailHeader, crumbDot, actionButton, statStrip, stat, detailBody, detailSection, railBlock, kv, editDrawer,
} from '../lib/detail-shell.js';

const COMPANY_REL = [
  ['active_client', 'Active client'], ['prospect', 'Prospect'], ['past_client', 'Past client'],
  ['vendor', 'Vendor'], ['partner', 'Partner'], ['brand_deal', 'Brand deal'], ['other', 'Other'],
];
const REL_LABEL = Object.fromEntries(COMPANY_REL);
const STATUS_LABELS = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };
const DEFAULT_CADENCE = 30;

function daysBetween(a, b) { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000); }
function silenceUrgency(days) { if (days == null) return 'quiet'; if (days >= 30) return 'over'; if (days >= 14) return 'due'; if (days <= 3) return 'ok'; return 'quiet'; }
function silenceLabel(days) { if (days == null) return 'No contact'; if (days === 0) return 'Today'; return `${days}d`; }

// ─── List ────────────────────────────────────────────────────────────────

export async function companiesList(mount) {
  mount.replaceChildren(spinner());

  const [companiesRes, peopleRes, projectsRes] = await Promise.all([
    sb.from('companies').select('*, domain:stewardship_domains(name)'),
    sb.from('people').select('id, company_id'),
    sb.from('projects').select('id, company_id, status'),
  ]);
  if (companiesRes.error) { mount.lastChild.replaceWith(hint(companiesRes.error.message)); return; }

  const companies = companiesRes.data ?? [];
  const contactCount = new Map(); for (const p of peopleRes.data ?? []) if (p.company_id) contactCount.set(p.company_id, (contactCount.get(p.company_id) ?? 0) + 1);
  const activeProjCount = new Map(); for (const p of projectsRes.data ?? []) if (p.company_id && p.status === 'active') activeProjCount.set(p.company_id, (activeProjCount.get(p.company_id) ?? 0) + 1);
  for (const c of companies) { c.contact_count = contactCount.get(c.id) ?? 0; c.active_project_count = activeProjCount.get(c.id) ?? 0; }

  const t = today();
  const rels = new Set(); let silent = false; let hasProject = false;
  const layout = el('div', { class: 'work-layout' });
  mount.lastChild.replaceWith(layout);

  async function render() {
    const withDays = companies.map((c) => ({ c, days: c.last_interaction_at ? Math.max(0, daysBetween(c.last_interaction_at.slice(0, 10), t)) : null, projects: c.active_project_count ?? 0 }));
    const visible = withDays.filter(({ c, days, projects }) => {
      if (rels.size && (!c.relationship_type || !rels.has(c.relationship_type))) return false;
      if (silent && (days == null || days < 30)) return false;
      if (hasProject && projects === 0) return false;
      return true;
    });
    const activeFilterCount = rels.size + (silent ? 1 : 0) + (hasProject ? 1 : 0);
    const silentCount = withDays.filter((x) => x.days != null && x.days >= 30).length;
    const projectCount = withDays.filter((x) => x.projects > 0).length;

    const buildFacetGroups = () => [
      facetGroup('Relationship', activeFilterCount > 0 ? clearBtn('Reset', () => { rels.clear(); silent = false; hasProject = false; render(); }) : null,
        ...COMPANY_REL.map(([val, label]) => {
          const n = companies.filter((c) => c.relationship_type === val).length;
          return n ? facetRow({ on: rels.has(val), name: label, count: n, onClick: () => { rels.has(val) ? rels.delete(val) : rels.add(val); render(); } }) : null;
        }).filter(Boolean),
      ),
      el('div', { class: 'facet-sep' }),
      facetGroup('State', null,
        facetRow({ on: silent, name: 'Silent 30d+', count: silentCount, onClick: () => { silent = !silent; render(); } }),
        facetRow({ on: hasProject, name: 'Has open project', count: projectCount, onClick: () => { hasProject = !hasProject; render(); } }),
      ),
    ];

    const grid = visible.length === 0
      ? el('div', { style: 'padding:56px 0; text-align:center' },
          el('div', { style: 'font-family:var(--serif); font-size:22px; font-weight:500; color:var(--ink)' }, activeFilterCount > 0 ? 'No companies match.' : 'No companies yet.'),
          el('p', { class: 'item-meta plain' }, activeFilterCount > 0 ? 'Clear a filter.' : 'Add a company to start your CRM.'))
      : el('div', { class: 'card-grid' }, ...visible.map(({ c, days, projects }) => el('button', { class: 'entity-card', type: 'button', onclick: () => go(`#/c/companies/${c.id}`) },
          el('div', { style: 'display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:8px' },
            el('span', { style: 'font-family:var(--serif); font-size:17px; font-weight:500; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, c.name),
            pill(silenceUrgency(days), silenceLabel(days)),
          ),
          el('div', { class: 'item-meta' }, `${c.relationship_type ? REL_LABEL[c.relationship_type] : '—'}${c.domain?.name ? ` · ${c.domain.name}` : ''}`, !c.active ? el('span', { class: 'over' }, ' · inactive') : null),
          el('div', { style: 'display:flex; align-items:center; gap:14px; margin-top:11px; padding-top:9px; border-top:1px solid var(--line)' },
            el('span', { class: 'item-meta plain' }, `${c.contact_count ?? 0} contact${(c.contact_count ?? 0) === 1 ? '' : 's'}`),
            el('span', { class: `item-meta plain ${projects ? '' : 'dim'}` }, `${projects} active`),
          ),
        )));

    const body = el('div', { class: 'work-body' },
      el('header', { class: 'screen-head', style: 'padding-top:0' },
        el('div', { class: 'row-actions' },
          el('div', {}, el('div', { class: 'eyebrow' }, `CRM · ${visible.length} of ${companies.length} companies`), el('h1', {}, 'Companies')),
          el('button', { class: 'work-cta', type: 'button', onclick: () => go('#/c/companies/new') }, '+ Add company'),
        ),
      ),
      grid,
    );

    const desktopRail = el('aside', { class: 'facet-rail' }, ...buildFacetGroups());
    const filtersBtn = el('button', { class: 'filters-fab', type: 'button', onclick: () => openSheet(el('div', {}, el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'Filters')), el('div', { style: 'padding-top:8px' }, ...buildFacetGroups()))) }, `Filters${activeFilterCount ? ` · ${activeFilterCount}` : ''}`);
    layout.replaceChildren(desktopRail, filtersBtn, body);
  }

  await render();
}
function facetGroup(label, action, ...children) { return el('div', { class: 'facet-group' }, el('div', { class: 'facet-group-head' }, el('span', { class: 'eyebrow' }, label), action ? el('div', {}, action) : null), ...children); }
function facetRow({ on, color, name, count, onClick }) { return el('button', { class: `facet-row ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, color ? el('span', { class: 'facet-swatch', style: `background:${color}` }) : null, el('span', { class: 'facet-row-name' }, name), count != null ? el('span', { class: 'facet-row-count' }, String(count)) : null); }
function clearBtn(label, onClick) { return el('button', { class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.09em; text-decoration:none', onclick }, label); }

// ─── Form ───────────────────────────────────────────────────────────────

function companyForm(row) {
  const isNew = !row;
  const v = {
    name: row?.name ?? '', relationship_type: row?.relationship_type ?? '', domain_id: row?.domain_id ?? '',
    website: row?.website ?? '', primary_email: row?.primary_email ?? '', primary_phone: row?.primary_phone ?? '',
    first_engagement_at: row?.first_engagement_at ?? '', next_review_at: row?.next_review_at ?? '',
    checkin_interval_days: row?.checkin_interval_days ?? '', notes: row?.notes ?? '', active: row?.active ?? true,
  };
  const name = el('input', { type: 'text', oninput: (e) => { v.name = e.target.value; } }); name.value = v.name;
  const relSel = el('select', { onchange: (e) => { v.relationship_type = e.target.value; } });
  relSel.append(el('option', { value: '' }, '— none —'));
  for (const [val, label] of COMPANY_REL) relSel.append(el('option', { value: val }, label));
  relSel.value = v.relationship_type;
  const domainSel = el('select', { onchange: (e) => { v.domain_id = e.target.value; } });
  domainSel.append(el('option', { value: '' }, '— none —'));
  for (const d of ref.domains) domainSel.append(el('option', { value: d.id }, d.name));
  domainSel.value = v.domain_id;
  const website = el('input', { type: 'text', placeholder: 'https://…', oninput: (e) => { v.website = e.target.value; } }); website.value = v.website;
  const email = el('input', { type: 'email', oninput: (e) => { v.primary_email = e.target.value; } }); email.value = v.primary_email;
  const phone = el('input', { type: 'tel', oninput: (e) => { v.primary_phone = e.target.value; } }); phone.value = v.primary_phone;
  const firstEng = el('input', { type: 'date', oninput: (e) => { v.first_engagement_at = e.target.value; } }); firstEng.value = v.first_engagement_at;
  const nextReview = el('input', { type: 'date', oninput: (e) => { v.next_review_at = e.target.value; } }); nextReview.value = v.next_review_at;
  const cadence = el('input', { type: 'number', min: 1, placeholder: '30', oninput: (e) => { v.checkin_interval_days = e.target.value; } }); cadence.value = v.checkin_interval_days;
  const notes = el('textarea', { rows: 4, oninput: (e) => { v.notes = e.target.value; } }); notes.value = v.notes;
  const active = el('input', { type: 'checkbox', checked: v.active, onchange: (e) => { v.active = e.target.checked; } });

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Create company' : 'Save changes');
  const wrap = el('div', {},
    el('div', { class: 'panel', style: 'margin:0' },
      el('div', { class: 'field' }, el('label', {}, 'Name'), name),
      el('div', { class: 'row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Relationship'), relSel), el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Domain'), domainSel)),
      el('div', { class: 'field' }, el('label', {}, 'Website'), website),
      el('div', { class: 'row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Primary email'), email), el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Primary phone'), phone)),
      el('div', { class: 'row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'First engagement'), firstEng), el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Next review'), nextReview)),
      el('div', { class: 'field' }, el('label', {}, 'Check-in cadence (days)'), cadence, el('div', { class: 'hint' }, 'Past this, an active client surfaces under Silent Clients on Today. Blank → 30 days.')),
      el('div', { class: 'field' }, el('label', {}, 'Notes'), notes),
      isNew ? null : el('label', { class: 'check' }, active, 'Active'),
    ),
    el('div', { class: 'form-actions' }, save, isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete company…')),
  );

  async function onSave() {
    if (!v.name.trim()) { toast('Name is required.', 'err'); return; }
    save.disabled = true;
    const payload = {
      name: v.name.trim(), relationship_type: v.relationship_type || null, domain_id: v.domain_id || null,
      website: v.website || null, primary_email: v.primary_email || null, primary_phone: v.primary_phone || null,
      first_engagement_at: v.first_engagement_at || null, next_review_at: v.next_review_at || null,
      checkin_interval_days: v.checkin_interval_days ? Number(v.checkin_interval_days) : null,
      notes: v.notes || null,
    };
    if (!isNew) payload.active = v.active;
    const res = isNew ? await sb.from('companies').insert(payload).select('id').single() : await sb.from('companies').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Created' : 'Saved');
    go(isNew ? `#/c/companies/${res.data.id}` : `#/c/companies/${row.id}`);
  }
  async function onDelete() {
    if (!confirmDelete(`${row.name}? Contacts + projects stay but are unlinked from this company`)) return;
    await sb.from('people').update({ company_id: null }).eq('company_id', row.id);
    await sb.from('projects').update({ company_id: null }).eq('company_id', row.id);
    const { error } = await sb.from('companies').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/c/companies');
  }
  return wrap;
}

export async function companyNew(mount) {
  mount.replaceChildren(
    el('header', { class: 'screen-head' }, el('div', { class: 'eyebrow' }, 'Capture'), el('h1', {}, 'New company')),
    companyForm(null),
  );
}

// ─── Detail ─────────────────────────────────────────────────────────────

export async function companyDetail(mount, { id }) {
  mount.replaceChildren(spinner());

  const [companyRes, contactsRes, projectsRes, convRes] = await Promise.all([
    sb.from('companies').select('*, domain:stewardship_domains(name)').eq('id', id).single(),
    sb.from('people').select('id, name, role_at_company, email, is_primary_contact').eq('company_id', id),
    sb.from('projects').select('id, name, status, color').eq('company_id', id),
    sb.from('conversations').select('*, person:people(id, name), project:projects(id, name)').eq('company_id', id).order('occurred_at', { ascending: false }),
  ]);
  if (companyRes.error) { mount.lastChild.replaceWith(hint(companyRes.error.message)); return; }

  const company = companyRes.data;
  const contacts = contactsRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const conversations = convRes.data ?? [];
  const t = today();
  const plus7 = (() => { const d = new Date(t); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();

  const projectIds = projects.map((p) => p.id);
  const { data: openTasksRaw } = projectIds.length
    ? await sb.from('tasks').select('id, title, status, due_date, project_id').in('project_id', projectIds).neq('status', 'done')
    : { data: [] };
  const open_tasks = (openTasksRaw ?? []).map((tk) => ({ ...tk, project: projects.find((p) => p.id === tk.project_id) }));
  const open_tasks_count = open_tasks.length;

  const isActiveClient = company.relationship_type === 'active_client';
  const cadence = company.checkin_interval_days ?? DEFAULT_CADENCE;
  const daysSilent = company.last_interaction_at ? daysBetween(company.last_interaction_at.slice(0, 10), t) : null;
  const silencePast = isActiveClient && daysSilent != null && daysSilent > cadence;

  const nextReviewYmd = company.next_review_at ?? null;
  const nextReviewOverdue = nextReviewYmd != null && nextReviewYmd < t;
  const nextReviewSoon = nextReviewYmd != null && !nextReviewOverdue && nextReviewYmd <= plus7;

  const followups = conversations.filter((c) => c.requires_followup);
  const passedFollowups = followups.filter((c) => c.followup_by != null && c.followup_by < t);
  const needsResponse = [...followups].sort(byFollowup);

  const activeProjects = projects.filter((p) => p.status === 'active');
  const tasksByProject = new Map();
  for (const tk of open_tasks) { const arr = tasksByProject.get(tk.project_id) ?? []; arr.push(tk); tasksByProject.set(tk.project_id, arr); }
  const overdueTasks = open_tasks.filter((x) => x.status !== 'waiting' && x.due_date && x.due_date < t);
  const dueTodayTasks = open_tasks.filter((x) => x.status !== 'waiting' && x.due_date === t);
  const waitingTasks = open_tasks.filter((x) => x.status === 'waiting');
  const rollupGroups = projects.map((p) => ({ project: p, tasks: sortRollup(tasksByProject.get(p.id) ?? []) })).filter((g) => g.tasks.length > 0);

  const overdueCount = (nextReviewOverdue ? 1 : 0) + passedFollowups.length + overdueTasks.length + (silencePast ? 1 : 0);
  const urg = overdueCount > 0 ? 'over' : (dueTodayTasks.length > 0 || nextReviewSoon || followups.some((c) => c.followup_by && c.followup_by >= t && c.followup_by <= plus7)) ? 'due'
    : (open_tasks_count + followups.length + activeProjects.length) === 0 && waitingTasks.length === 0 ? 'quiet' : 'ok';
  const chipLabel = silencePast ? `Silent · ${silenceLabel(daysSilent)}`
    : passedFollowups.length > 0 ? `${passedFollowups.length} follow-up${passedFollowups.length === 1 ? '' : 's'} passed`
    : nextReviewOverdue ? 'Review overdue'
    : overdueTasks.length > 0 ? `${overdueTasks.length} overdue`
    : urg === 'due' ? 'Due soon' : urg === 'ok' ? (isActiveClient ? 'Active' : 'On track') : 'Quiet';

  const lastContactLabel = daysSilent == null ? 'none yet' : daysSilent <= 0 ? 'today' : `${daysSilent}d ago`;
  const websiteHost = company.website ? company.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;

  function refresh() { companyDetail(mount, { id }); }

  const header = detailHeader({
    crumb: [
      el('button', { class: 'linkish', type: 'button', onclick: () => go('#/c/companies') }, 'Companies'),
      company.relationship_type ? crumbDot() : null, company.relationship_type ? el('span', {}, REL_LABEL[company.relationship_type]) : null,
      company.domain?.name ? crumbDot() : null, company.domain?.name ? el('span', {}, company.domain.name) : null,
      !company.active ? crumbDot() : null, !company.active ? el('span', {}, 'Inactive') : null,
    ].filter(Boolean),
    name: company.name,
    state: pill(urg, chipLabel),
    actions: [actionButton({ onClick: () => document.getElementById('conversations')?.scrollIntoView({ behavior: 'smooth' }) }, '+ Conversation'), editDrawer('Edit company', companyForm(company))],
  });

  const strip = statStrip(
    stat({ label: 'Last contact', value: daysSilent == null ? '—' : daysSilent <= 0 ? 'Today' : `${daysSilent}`, unit: daysSilent != null && daysSilent > 0 ? (daysSilent === 1 ? 'day ago' : 'days ago') : undefined, tone: silencePast ? 'accent' : undefined, sub: daysSilent == null ? 'nothing logged' : silencePast ? `past ${cadence}d cadence` : isActiveClient ? `${cadence}d cadence` : 'no cadence' }),
    nextReviewYmd ? stat({ label: 'Next review', value: nextReviewYmd, tone: nextReviewOverdue ? 'accent' : undefined, sub: nextReviewOverdue ? 'overdue' : 'upcoming' }) : stat({ label: 'Next review', value: '—', sub: 'none set' }),
    stat({ label: 'Open follow-ups', value: followups.length, tone: passedFollowups.length > 0 ? 'accent' : undefined, sub: passedFollowups.length > 0 ? `${passedFollowups.length} passed` : followups.length ? 'awaiting reply' : 'none open' }),
    stat({ label: 'Active projects', value: activeProjects.length, sub: projects.length === 0 ? 'none linked' : projects.length === activeProjects.length ? 'all active' : `${projects.length} total` }),
  );

  const main = [
    needsResponse.length ? detailSection({ label: 'Needs response', count: needsResponse.length },
      el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...needsResponse.map((c) => {
        const passed = c.followup_by != null && c.followup_by < t;
        return el('li', { style: `padding:10px 0; border-bottom:1px solid var(--line); ${passed ? 'border-left:2px solid var(--accent); padding-left:10px' : ''}` },
          el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; gap:10px' },
            el('span', { class: `item-meta ${passed ? 'over' : ''}` }, c.followup_by ? (passed ? `Passed ${c.followup_by}` : `By ${c.followup_by}`) : 'Flagged', c.person ? ` · ${c.person.name}` : '', c.project ? ` · ${c.project.name}` : ''),
            el('span', { class: 'item-meta' }, new Date(c.occurred_at).toLocaleDateString()),
          ),
          c.subject ? el('div', { style: 'margin-top:4px; font-family:var(--sans); font-size:14px; color:var(--ink); font-weight:500' }, c.subject) : null,
          el('p', { style: 'margin-top:2px; font-family:var(--sans); font-size:13.5px; color:var(--ink-2)' }, c.summary),
        );
      }))) : null,
    el('section', { id: 'conversations' },
      detailSection({ label: 'Conversations', count: conversations.length || undefined },
        conversationTimeline(conversations, { scope: 'company', refresh }),
        logConversationForm({ company_id: company.id }, refresh),
      )),
    detailSection({ label: 'Projects', count: projects.length || undefined },
      projects.length === 0 ? el('p', { class: 'briefing-empty' }, `No projects linked. Set a project's company to ${company.name}.`)
        : el('div', { class: 'work-project-grid' }, ...projects.map((p) => {
            const pt = tasksByProject.get(p.id) ?? [];
            const pWaiting = pt.filter((x) => x.status === 'waiting').length;
            const pOverdue = pt.filter((x) => x.status !== 'waiting' && x.due_date && x.due_date < t).length;
            const pOpen = pt.length - pWaiting;
            return el('button', { class: 'work-project-card', type: 'button', onclick: () => go(`#/c/projects/${p.id}`) },
              el('div', { class: 'work-project-body' },
                el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; gap:8px' },
                  el('span', { style: 'font-family:var(--sans); font-size:14px; color:var(--ink); font-weight:500' }, p.name),
                  el('span', { class: 'item-meta' }, STATUS_LABELS[p.status] ?? p.status),
                ),
                el('div', { class: 'item-meta', style: 'margin-top:8px' }, pt.length === 0 ? el('span', { class: 'dim' }, 'no open tasks') : el('span', {}, `${pOpen} open`, pOverdue > 0 ? el('span', { class: 'over' }, ` · ${pOverdue} overdue`) : null, pWaiting > 0 ? ` · ${pWaiting} waiting` : '')),
              ));
          }))),
    detailSection({ label: 'Open tasks', count: open_tasks_count || undefined },
      open_tasks_count === 0 ? el('p', { class: 'briefing-empty' }, projects.length === 0 ? 'No projects, so nothing open.' : "Nothing open across this company's projects.")
        : el('div', { style: 'display:flex; flex-direction:column; gap:16px' }, ...rollupGroups.map((g) =>
            el('div', {},
              el('div', { style: 'display:flex; align-items:baseline; gap:8px; margin-bottom:6px' },
                el('button', { class: 'linkish', type: 'button', style: 'font-weight:600; text-decoration:none', onclick: () => go(`#/c/projects/${g.project.id}`) }, g.project.name),
                el('span', { class: 'item-meta' }, String(g.tasks.length)),
              ),
              el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...g.tasks.map((tk) => {
                const st = taskState(tk, t);
                return el('li', { style: 'display:flex; align-items:baseline; gap:10px; padding:6px 0; border-bottom:1px solid var(--line)' },
                  el('span', { class: `item-meta ${st.cls}`, style: 'width:60px; flex:0 0 auto' }, st.label),
                  el('button', { class: 'linkish', type: 'button', style: 'flex:1; text-align:left; text-decoration:none', onclick: () => go(`#/tasks/${tk.id}`) }, tk.title),
                  tk.due_date ? el('span', { class: 'item-meta' }, tk.due_date) : null,
                );
              })),
            ))),
    ),
  ].filter(Boolean);

  const rail = [
    railBlock('Contacts',
      contacts.length === 0 ? el('p', { class: 'briefing-empty' }, 'No contacts linked yet.') : el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...contacts.map((c) =>
        el('li', { style: 'padding:6px 0; border-bottom:1px solid var(--line)' },
          el('button', { class: 'linkish', type: 'button', style: 'display:flex; align-items:baseline; justify-content:space-between; width:100%; text-decoration:none; gap:8px', onclick: () => go(`#/c/people/${c.id}`) },
            el('span', { style: 'color:var(--ink); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, c.name, c.is_primary_contact ? el('span', { class: 'over', style: 'margin-left:6px; font-family:var(--mono); font-size:9px; text-transform:uppercase' }, 'primary') : null),
            el('span', { class: 'item-meta', style: 'flex:0 0 auto' }, c.role_at_company ?? c.email ?? ''),
          )))),
    ),
    railBlock('Details',
      websiteHost ? kv('Website', el('a', { href: company.website, target: '_blank', rel: 'noopener noreferrer' }, websiteHost)) : null,
      company.primary_email ? kv('Email', el('a', { href: `mailto:${company.primary_email}` }, company.primary_email)) : null,
      company.primary_phone ? kv('Phone', company.primary_phone) : null,
      company.first_engagement_at ? kv('Since', company.first_engagement_at) : null,
      isActiveClient ? kv('Cadence', `every ${cadence}d`) : null,
      nextReviewYmd ? kv('Next review', nextReviewYmd, nextReviewOverdue) : null,
      kv('Last contact', lastContactLabel),
    ),
    company.notes ? railBlock('Notes', el('p', { style: 'font-family:var(--sans); font-size:13px; color:var(--ink-2); line-height:1.5; white-space:pre-wrap' }, company.notes)) : null,
  ].filter(Boolean);

  mount.replaceChildren(header, strip, detailBody(main, rail));
}

function taskState(t, today_) { if (t.status === 'waiting') return { label: 'waiting', cls: 'dim' }; if (t.due_date && t.due_date < today_) return { label: 'overdue', cls: 'over' }; if (t.due_date === today_) return { label: 'due today', cls: '' }; return { label: 'open', cls: 'dim' }; }
function byFollowup(a, b) { const ad = a.followup_by, bd = b.followup_by; if (ad == null && bd == null) return b.occurred_at.localeCompare(a.occurred_at); if (ad == null) return 1; if (bd == null) return -1; return ad.localeCompare(bd); }
function sortRollup(list) { return [...list].sort((a, b) => { const aw = a.status === 'waiting' ? 1 : 0; const bw = b.status === 'waiting' ? 1 : 0; if (aw !== bw) return aw - bw; return (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99'); }); }
