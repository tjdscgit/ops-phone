// People — the relationships CRM. A port of people-view.tsx (list),
// person-form.tsx (edit) and [id]/page.tsx (detail: upcoming, conversations,
// needs-reply, facts).

import { sb, ref } from '../lib/db.js';
import { el, hint, spinner, pill, toast, fail, confirmDelete, today } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { openSheet } from '../app.js';
import { conversationTimeline, logConversationForm } from '../lib/conversations.js';
import {
  detailHeader, crumbDot, actionButton, statStrip, stat, detailBody, detailSection, railBlock, kv, editDrawer,
} from '../lib/detail-shell.js';

const PERSON_REL = [
  { value: 'client', label: 'Client', color: '#2F5D8A' },
  { value: 'family', label: 'Family', color: '#3B6A52' },
  { value: 'church', label: 'Church', color: '#6B5B95' },
  { value: 'friend', label: 'Friend', color: '#A8763E' },
  { value: 'team', label: 'Team', color: '#4A6B70' },
  { value: 'vendor', label: 'Vendor', color: '#8A4B3C' },
  { value: 'other', label: 'Other', color: '#8B847A' },
];
const REL_COLOR = Object.fromEntries(PERSON_REL.map((r) => [r.value, r.color]));
const REL_LABEL = Object.fromEntries(PERSON_REL.map((r) => [r.value, r.label]));

function daysBetween(a, b) { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000); }
function initials(name) { return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
function silenceUrgency(days) { if (days == null) return 'quiet'; if (days >= 30) return 'over'; if (days >= 14) return 'due'; if (days <= 3) return 'ok'; return 'quiet'; }
function silenceLabel(days) { if (days == null) return 'No contact'; if (days === 0) return 'Today'; return `${days}d`; }

// ─── List ────────────────────────────────────────────────────────────────

export async function peopleList(mount) {
  mount.replaceChildren(spinner());

  const [peopleRes, companiesRes] = await Promise.all([
    sb.from('people').select('*, company_ref:companies(id, name)').order('name'),
    sb.from('companies').select('id, name'),
  ]);
  if (peopleRes.error) { mount.lastChild.replaceWith(hint(peopleRes.error.message)); return; }

  // last_interaction_at / interaction_count / fact_count aren't columns —
  // synthesise them from conversations/facts, same rollup the API does.
  const people = peopleRes.data ?? [];
  const [convRes, factRes] = await Promise.all([
    sb.from('conversations').select('person_id, occurred_at').not('person_id', 'is', null),
    sb.from('person_facts').select('person_id'),
  ]);
  const lastContact = new Map(); const convCount = new Map();
  for (const c of convRes.data ?? []) {
    convCount.set(c.person_id, (convCount.get(c.person_id) ?? 0) + 1);
    if (!lastContact.has(c.person_id) || c.occurred_at > lastContact.get(c.person_id)) lastContact.set(c.person_id, c.occurred_at);
  }
  const factCount = new Map();
  for (const f of factRes.data ?? []) factCount.set(f.person_id, (factCount.get(f.person_id) ?? 0) + 1);
  for (const p of people) {
    p.last_interaction_at = lastContact.get(p.id) ?? null;
    p.interaction_count = convCount.get(p.id) ?? 0;
    p.fact_count = factCount.get(p.id) ?? 0;
  }

  const t = today();
  const rels = new Set(); const cos = new Set(); let silent = false;
  const layout = el('div', { class: 'work-layout' });
  mount.lastChild.replaceWith(layout);

  async function render() {
    const withDays = people.map((p) => ({
      p, days: p.last_interaction_at ? Math.max(0, daysBetween(p.last_interaction_at.slice(0, 10), t)) : null,
      company: p.company_ref?.name ?? p.company ?? null,
    }));
    const companies = [...new Set(withDays.map((x) => x.company).filter(Boolean))].sort();
    const visible = withDays.filter(({ p, days, company }) => {
      if (rels.size && (!p.relationship_type || !rels.has(p.relationship_type))) return false;
      if (cos.size && (!company || !cos.has(company))) return false;
      if (silent && (days == null || days < 30)) return false;
      return true;
    });
    const activeFilterCount = rels.size + cos.size + (silent ? 1 : 0);
    const silentCount = withDays.filter((x) => x.days != null && x.days >= 30).length;

    const buildFacetGroups = () => [
      facetGroup('Relationship', activeFilterCount > 0 ? clearBtn('Reset', () => { rels.clear(); cos.clear(); silent = false; render(); }) : null,
        ...PERSON_REL.map((r) => {
          const n = people.filter((p) => p.relationship_type === r.value).length;
          return n ? facetRow({ on: rels.has(r.value), color: r.color, name: r.label, count: n, onClick: () => { rels.has(r.value) ? rels.delete(r.value) : rels.add(r.value); render(); } }) : null;
        }).filter(Boolean),
        facetRow({ on: silent, name: 'Silent 30d+', count: silentCount, onClick: () => { silent = !silent; render(); } }),
      ),
      el('div', { class: 'facet-sep' }),
      companies.length ? facetGroup('Company', cos.size ? clearBtn('Clear', () => { cos.clear(); render(); }) : null,
        ...companies.map((c) => facetRow({ on: cos.has(c), name: c, count: withDays.filter((x) => x.company === c).length, onClick: () => { cos.has(c) ? cos.delete(c) : cos.add(c); render(); } })),
      ) : null,
    ].filter(Boolean);

    const grid = visible.length === 0
      ? el('div', { style: 'padding:56px 0; text-align:center' },
          el('div', { style: 'font-family:var(--serif); font-size:22px; font-weight:500; color:var(--ink)' }, activeFilterCount > 0 ? 'Nobody matches.' : 'No people yet.'),
          el('p', { class: 'item-meta plain' }, activeFilterCount > 0 ? 'Clear a filter.' : 'Add a person to start your CRM.'))
      : el('div', { class: 'card-grid' }, ...visible.map(({ p, days, company }) => el('button', { class: 'entity-card', type: 'button', onclick: () => go(`#/c/people/${p.id}`) },
          el('div', { style: 'display:flex; align-items:flex-start; gap:10px; margin-bottom:10px' },
            el('span', { style: `display:grid; place-items:center; width:34px; height:34px; flex:0 0 auto; border-radius:999px; font-family:var(--serif); font-weight:500; font-size:13px; color:#fff; background:${p.relationship_type ? REL_COLOR[p.relationship_type] : '#8B847A'}` }, initials(p.name)),
            el('div', { style: 'flex:1; min-width:0' },
              el('div', { style: 'font-family:var(--serif); font-size:17px; font-weight:500; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, p.name),
              el('div', { class: 'item-meta' }, `${p.relationship_type ? REL_LABEL[p.relationship_type] : '—'}${company ? ` · ${company}` : ''}`),
            ),
          ),
          p.email ? el('div', { class: 'item-meta plain', style: 'margin-bottom:10px' }, p.email) : null,
          el('div', { style: 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:9px; border-top:1px solid var(--line)' },
            pill(silenceUrgency(days), silenceLabel(days)),
            el('span', { class: 'item-meta plain' }, historyLabel(p)),
          ),
        )));

    const body = el('div', { class: 'work-body' },
      el('header', { class: 'screen-head', style: 'padding-top:0' },
        el('div', { class: 'row-actions' },
          el('div', {}, el('div', { class: 'eyebrow' }, `Relationships · ${visible.length} of ${people.length} people`), el('h1', {}, 'People')),
          el('button', { class: 'work-cta', type: 'button', onclick: () => go('#/c/people/new') }, '+ Add person'),
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
function historyLabel(p) { const logs = p.interaction_count ?? 0; const facts = p.fact_count ?? 0; if (!logs && !facts) return 'No history'; return [logs ? `${logs} log` : null, facts ? `${facts} fact` : null].filter(Boolean).join(' · '); }
function facetGroup(label, action, ...children) { return el('div', { class: 'facet-group' }, el('div', { class: 'facet-group-head' }, el('span', { class: 'eyebrow' }, label), action ? el('div', {}, action) : null), ...children); }
function facetRow({ on, color, name, count, onClick }) { return el('button', { class: `facet-row ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, color ? el('span', { class: 'facet-swatch', style: `background:${color}` }) : null, el('span', { class: 'facet-row-name' }, name), count != null ? el('span', { class: 'facet-row-count' }, String(count)) : null); }
function clearBtn(label, onClick) { return el('button', { class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.09em; text-decoration:none', onclick }, label); }

// ─── Form ───────────────────────────────────────────────────────────────

function personForm(row, companies) {
  const isNew = !row;
  const v = {
    name: row?.name ?? '', relationship_type: row?.relationship_type ?? '', email: row?.email ?? '', phone: row?.phone ?? '',
    company_id: row?.company_id ?? '', role_at_company: row?.role_at_company ?? '', is_primary_contact: row?.is_primary_contact ?? false,
    birthday: row?.birthday ?? '', anniversary: row?.anniversary ?? '', notes: row?.notes ?? '',
  };
  const name = el('input', { type: 'text', oninput: (e) => { v.name = e.target.value; } }); name.value = v.name;
  const relSel = el('select', { onchange: (e) => { v.relationship_type = e.target.value; } });
  relSel.append(el('option', { value: '' }, '— none —'));
  for (const r of PERSON_REL) relSel.append(el('option', { value: r.value }, r.label));
  relSel.value = v.relationship_type;
  const email = el('input', { type: 'email', oninput: (e) => { v.email = e.target.value; } }); email.value = v.email;
  const phone = el('input', { type: 'tel', oninput: (e) => { v.phone = e.target.value; } }); phone.value = v.phone;
  const coSel = el('select', { onchange: (e) => { v.company_id = e.target.value; } });
  coSel.append(el('option', { value: '' }, '— none —'));
  for (const c of companies) coSel.append(el('option', { value: c.id }, c.name));
  coSel.value = v.company_id;
  const role = el('input', { type: 'text', placeholder: 'e.g. Marketing Director', oninput: (e) => { v.role_at_company = e.target.value; } }); role.value = v.role_at_company;
  const primary = el('input', { type: 'checkbox', checked: v.is_primary_contact, onchange: (e) => { v.is_primary_contact = e.target.checked; } });
  const birthday = el('input', { type: 'date', oninput: (e) => { v.birthday = e.target.value; } }); birthday.value = v.birthday;
  const anniv = el('input', { type: 'date', oninput: (e) => { v.anniversary = e.target.value; } }); anniv.value = v.anniversary;
  const notes = el('textarea', { rows: 4, placeholder: 'How you met, context, ongoing themes…', oninput: (e) => { v.notes = e.target.value; } }); notes.value = v.notes;

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Create person' : 'Save changes');
  const wrap = el('div', {},
    el('div', { class: 'panel', style: 'margin:0' },
      el('div', { class: 'field' }, el('label', {}, 'Name'), name),
      el('div', { class: 'field' }, el('label', {}, 'Relationship'), relSel),
      el('div', { class: 'row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Email'), email), el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Phone'), phone)),
      el('div', { class: 'row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Company'), coSel), el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Role at company'), role)),
      el('label', { class: 'check' }, primary, 'Primary contact for this company'),
      el('div', { class: 'row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Birthday'), birthday), el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Anniversary'), anniv)),
      el('div', { class: 'field' }, el('label', {}, 'Notes'), notes),
    ),
    el('div', { class: 'form-actions' }, save, isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete person…')),
  );

  async function onSave() {
    if (!v.name.trim()) { toast('Name is required.', 'err'); return; }
    save.disabled = true;
    const payload = {
      name: v.name.trim(), relationship_type: v.relationship_type || null, email: v.email || null, phone: v.phone || null,
      company_id: v.company_id || null, role_at_company: v.role_at_company || null, is_primary_contact: v.is_primary_contact,
      birthday: v.birthday || null, anniversary: v.anniversary || null, notes: v.notes || null,
    };
    const res = isNew ? await sb.from('people').insert(payload).select('id').single() : await sb.from('people').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Created' : 'Saved');
    go(isNew ? `#/c/people/${res.data.id}` : `#/c/people/${row.id}`);
  }
  async function onDelete() {
    if (!confirmDelete(`${row.name}? Their notes + projects stay; facts + interactions are deleted`)) return;
    await sb.from('conversations').delete().eq('person_id', row.id);
    await sb.from('person_facts').delete().eq('person_id', row.id);
    const { error } = await sb.from('people').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/c/people');
  }
  return wrap;
}

export async function personNew(mount) {
  const { data: companies } = await sb.from('companies').select('id, name').order('name');
  mount.replaceChildren(
    el('header', { class: 'screen-head' }, el('div', { class: 'eyebrow' }, 'Capture'), el('h1', {}, 'New person')),
    personForm(null, companies ?? []),
  );
}

// ─── Detail ─────────────────────────────────────────────────────────────

const FACT_LABELS = { anniversary: 'Anniversary', birthday: 'Birthday', kid_name: 'Kid', shared: 'Shared', follow_up: 'Follow-up', other: 'Other' };
const FACT_TYPES = [['kid_name', 'Kid'], ['shared', 'Shared interest'], ['follow_up', 'Follow-up'], ['other', 'Other']];
const UPCOMING_WINDOW = 30; const IMMINENT_DAYS = 7;

export async function personDetail(mount, { id }) {
  mount.replaceChildren(spinner());

  const [personRes, companiesRes, factsRes, convRes, notesRes, projectsRes] = await Promise.all([
    sb.from('people').select('*, company_ref:companies(id, name)').eq('id', id).single(),
    sb.from('companies').select('id, name'),
    sb.from('person_facts').select('*').eq('person_id', id).order('created_at'),
    sb.from('conversations').select('*, company:companies(id, name), project:projects(id, name)').eq('person_id', id).order('occurred_at', { ascending: false }),
    sb.from('notes').select('id, title, body').eq('related_person_id', id).limit(20),
    sb.from('projects').select('id, name, status, color').eq('primary_contact_id', id).limit(20),
  ]);
  if (personRes.error) { mount.lastChild.replaceWith(hint(personRes.error.message)); return; }

  const person = personRes.data;
  const companies = companiesRes.data ?? [];
  const facts = factsRes.data ?? [];
  const conversations = convRes.data ?? [];
  const notes = notesRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const t = today();
  const firstName = person.name.split(' ')[0];
  const plus7 = (() => { const d = new Date(t); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();

  const sorted = [...conversations].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const latest = sorted[0] ?? null;
  const daysSince = latest ? Math.max(0, daysBetween(latest.occurred_at.slice(0, 10), t)) : null;
  const sparse = conversations.length >= 1 && conversations.length <= 3;

  const upcoming = buildUpcoming(person, facts, t);
  const nextUp = upcoming[0] ?? null;
  const bdayDays = person.birthday ? daysUntilAnnual(person.birthday, t) : null;
  const bdaySoon = bdayDays != null && bdayDays <= UPCOMING_WINDOW;
  const bdayImminent = bdayDays != null && bdayDays <= IMMINENT_DAYS;

  const followups = conversations.filter((c) => c.requires_followup);
  const passed = followups.filter((c) => c.followup_by != null && c.followup_by < t);
  const soon = followups.filter((c) => c.followup_by != null && c.followup_by >= t && c.followup_by <= plus7);
  const needsReply = [...followups].sort(byFollowup);
  const openUrg = passed.length > 0 ? 'over' : soon.length > 0 ? 'due' : followups.length > 0 ? 'ok' : 'quiet';

  const companyRef = person.company_ref ?? null;

  function refresh() { personDetail(mount, { id }); }

  const header = detailHeader({
    crumb: [
      el('button', { class: 'linkish', type: 'button', onclick: () => go('#/c/people') }, 'People'),
      person.relationship_type ? crumbDot() : null, person.relationship_type ? el('span', {}, REL_LABEL[person.relationship_type]) : null,
      companyRef ? crumbDot() : null, companyRef ? el('button', { class: 'linkish', type: 'button', onclick: () => go(`#/c/companies/${companyRef.id}`) }, companyRef.name) : (person.company ? crumbDot() : null),
      (!companyRef && person.company) ? el('span', {}, person.company) : null,
    ].filter(Boolean),
    name: person.name,
    state: followups.length === 0 ? null : pill(openUrg, openUrg === 'over' ? `${passed.length} to reply` : openUrg === 'due' ? 'Reply soon' : `${followups.length} open`),
    actions: [actionButton({ onClick: () => document.getElementById('conversations')?.scrollIntoView({ behavior: 'smooth' }) }, '+ Conversation'), actionButton({ onClick: () => document.getElementById('facts')?.scrollIntoView({ behavior: 'smooth' }) }, '+ Fact'), editDrawer('Edit person', personForm(person, companies))],
    below: el('div', { class: 'item-meta' },
      el('span', {}, latest ? `Last conversation · ${daysSince != null && daysSince <= 0 ? 'today' : `${daysSince}d ago`}` : 'No conversations yet'),
      bdaySoon ? el('span', { class: bdayImminent ? 'over' : '' }, `· Birthday ${bdayDays === 0 ? 'today' : `in ${bdayDays}d`}`) : null,
    ),
  });

  const strip = statStrip(
    stat({ label: 'Last connected', value: daysSince == null ? '—' : daysSince <= 0 ? 'Today' : `${daysSince}`, unit: daysSince != null && daysSince > 0 ? (daysSince === 1 ? 'day ago' : 'days ago') : undefined, sub: daysSince == null ? 'no history yet' : `${conversations.length} logged` }),
    stat({ label: 'Coming up', value: nextUp ? (nextUp.days === 0 ? 'Today' : `${nextUp.days}`) : '—', unit: nextUp && nextUp.days > 0 ? (nextUp.days === 1 ? 'day' : 'days') : undefined, sub: nextUp ? nextUp.label : 'nothing soon' }),
    stat({ label: 'Open between us', value: followups.length, tone: passed.length > 0 ? 'accent' : undefined, sub: passed.length > 0 ? `${passed.length} to reply` : followups.length ? 'awaiting you' : 'nothing open' }),
    stat({ label: 'Facts', value: facts.length, sub: facts.length ? 'remembered' : 'none yet' }),
  );

  const main = [
    upcoming.length ? detailSection({ label: 'Upcoming', count: upcoming.length },
      el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...upcoming.map((u) =>
        el('li', { style: 'display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid var(--line)' },
          el('span', { style: 'display:flex; align-items:baseline; gap:10px; min-width:0' }, el('span', { class: 'item-meta', style: 'width:64px; flex:0 0 auto' }, u.label), el('span', { style: 'font-family:var(--sans); font-size:14px; color:var(--ink)' }, u.value)),
          el('span', { class: `item-meta ${u.days <= IMMINENT_DAYS ? 'over' : ''}` }, `${u.days === 0 ? 'today' : `in ${u.days}d`} · ${u.dateLabel}`),
        )))) : null,
    el('section', { id: 'conversations' },
      detailSection({ label: 'Conversations', count: conversations.length || undefined },
        sparse && latest ? el('div', { style: 'margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--line)' },
          el('div', { class: 'item-meta' }, `${new Date(latest.occurred_at).toLocaleDateString()} · ${latest.interaction_type.replace('_', ' ')} · ${latest.direction}`, latest.requires_followup ? el('span', { class: 'over' }, `· follow up${latest.followup_by ? ` by ${latest.followup_by}` : ''}`) : null),
          latest.subject ? el('div', { style: 'margin-top:6px; font-family:var(--serif); font-size:16px; color:var(--ink)' }, latest.subject) : null,
          el('p', { style: 'margin-top:6px; font-family:var(--serif); font-size:17px; color:var(--ink-2); line-height:1.5; white-space:pre-wrap' }, latest.summary),
        ) : null,
        (sparse && latest) ? (sorted.length > 1 ? conversationTimeline(sorted.slice(1), { scope: 'person', refresh }) : null) : conversationTimeline(sorted, { scope: 'person', refresh }),
        logConversationForm({ person_id: person.id }, refresh),
      )),
    needsReply.length ? detailSection({ label: 'Needs a reply', count: needsReply.length },
      el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...needsReply.map((c) => {
        const isPast = c.followup_by != null && c.followup_by < t;
        return el('li', { style: `padding:10px 0; border-bottom:1px solid var(--line); ${isPast ? 'border-left:2px solid var(--accent); padding-left:10px' : ''}` },
          el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; gap:10px' },
            el('span', { class: `item-meta ${isPast ? 'over' : ''}` }, c.followup_by ? (isPast ? `Passed ${c.followup_by}` : `By ${c.followup_by}`) : 'Flagged', c.project ? ` · ${c.project.name}` : ''),
            el('span', { class: 'item-meta' }, new Date(c.occurred_at).toLocaleDateString()),
          ),
          c.subject ? el('div', { style: 'margin-top:4px; font-family:var(--sans); font-size:14px; color:var(--ink); font-weight:500' }, c.subject) : null,
          el('p', { style: 'margin-top:2px; font-family:var(--sans); font-size:13.5px; color:var(--ink-2)' }, c.summary),
        );
      }))) : null,
    notes.length ? detailSection({ label: `Notes mentioning ${firstName}`, count: notes.length },
      el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...notes.map((n) => el('li', { style: 'padding:8px 0; border-bottom:1px solid var(--line)' },
        el('button', { class: 'linkish', type: 'button', style: 'display:block; text-align:left; text-decoration:none', onclick: () => go(`#/c/notes/${n.id}`) },
          n.title ? el('div', { style: 'font-family:var(--serif); font-size:15px; color:var(--ink)' }, n.title) : null,
          el('div', { class: 'item-meta plain' }, n.body),
        ))))) : null,
    projects.length ? detailSection({ label: 'Projects', count: projects.length },
      el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...projects.map((p) => el('li', { style: 'padding:8px 0; border-bottom:1px solid var(--line)' },
        el('button', { class: 'linkish', type: 'button', style: 'display:flex; align-items:baseline; gap:8px; text-decoration:none', onclick: () => go(`#/c/projects/${p.id}`) },
          el('span', { style: 'flex:1; font-family:var(--sans); font-size:14px; color:var(--ink)' }, p.name),
          el('span', { class: 'item-meta' }, p.status),
        ))))) : null,
  ].filter(Boolean);

  const rail = [
    el('div', { id: 'facts' }, railBlock('Facts',
      facts.length === 0 ? el('p', { class: 'briefing-empty' }, 'No facts yet — kids’ names, shared interests, the things you’d otherwise forget.') : el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...facts.map((f) => factRow(person.id, f, refresh))),
      factForm(person.id, refresh),
    )),
    railBlock('Details',
      companyRef ? kv('Company', el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/companies/${companyRef.id}`) }, companyRef.name)) : (person.company ? kv('Company', person.company) : null),
      person.role_at_company ? kv('Role', person.is_primary_contact ? `${person.role_at_company} · primary` : person.role_at_company) : null,
      person.email ? kv('Email', el('a', { href: `mailto:${person.email}` }, person.email)) : null,
      person.phone ? kv('Phone', el('a', { href: `tel:${person.phone}` }, person.phone)) : null,
      person.birthday ? kv('Birthday', person.birthday) : null,
      person.anniversary ? kv('Anniversary', person.anniversary) : null,
    ),
    person.notes ? railBlock('Notes', el('p', { style: 'font-family:var(--sans); font-size:13px; color:var(--ink-2); line-height:1.5; white-space:pre-wrap' }, person.notes)) : null,
  ].filter(Boolean);

  mount.replaceChildren(header, strip, detailBody(main, rail));
}

function factRow(personId, fact, refresh) {
  return el('li', { style: 'padding:6px 0; border-bottom:1px solid var(--line)' },
    el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; gap:8px' },
      el('span', { class: 'item-meta' }, FACT_LABELS[fact.fact_type] ?? fact.fact_type),
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async () => { await sb.from('person_facts').delete().eq('id', fact.id); refresh(); } }, '✕'),
    ),
    el('div', { style: 'margin-top:2px; font-family:var(--sans); font-size:13.5px; color:var(--ink)' }, fact.fact_value),
    fact.date_relevant ? el('div', { class: 'item-meta' }, `${fact.date_relevant}${fact.recurring ? ' · recurs' : ''}`) : null,
  );
}

function factForm(personId, refresh) {
  const typeSel = el('select', {});
  for (const [v, l] of FACT_TYPES) typeSel.append(el('option', { value: v }, l));
  const value = el('input', { type: 'text', placeholder: "e.g. 'Henry, age 4'" });
  const date = el('input', { type: 'date' });
  const recurring = el('input', { type: 'checkbox' });

  return el('div', { style: 'margin-top:10px; padding-top:10px; border-top:1px solid var(--line)' },
    el('div', { style: 'display:flex; flex-wrap:wrap; gap:8px; align-items:center' },
      typeSel, value, date,
      el('label', { class: 'check', style: 'min-height:auto' }, recurring, 'Recurs'),
      el('button', {
        class: 'ghost small', type: 'button',
        onclick: async () => {
          if (!value.value.trim()) { toast('Value is required.', 'err'); return; }
          const { error } = await sb.from('person_facts').insert({ person_id: personId, fact_type: typeSel.value, fact_value: value.value.trim(), date_relevant: date.value || null, recurring: recurring.checked });
          if (error) { fail(error); return; }
          refresh();
        },
      }, 'Add fact'),
    ),
  );
}

function buildUpcoming(person, facts, t) {
  const out = [];
  const firstName = person.name.split(' ')[0];
  if (person.birthday) { const d = daysUntilAnnual(person.birthday, t); if (d <= UPCOMING_WINDOW) out.push({ key: 'bday', label: 'Birthday', value: `${firstName}’s birthday`, days: d, dateLabel: person.birthday }); }
  if (person.anniversary) { const d = daysUntilAnnual(person.anniversary, t); if (d <= UPCOMING_WINDOW) out.push({ key: 'anniv', label: 'Anniversary', value: 'Anniversary', days: d, dateLabel: person.anniversary }); }
  for (const f of facts) {
    if (!f.date_relevant || f.fact_type === 'birthday' || f.fact_type === 'anniversary') continue;
    if (f.recurring) { const d = daysUntilAnnual(f.date_relevant, t); if (d <= UPCOMING_WINDOW) out.push({ key: f.id, label: FACT_LABELS[f.fact_type], value: f.fact_value, days: d, dateLabel: f.date_relevant }); }
    else { const d = daysUntilYmd(f.date_relevant, t); if (d >= 0 && d <= UPCOMING_WINDOW) out.push({ key: f.id, label: FACT_LABELS[f.fact_type], value: f.fact_value, days: d, dateLabel: f.date_relevant }); }
  }
  return out.sort((a, b) => a.days - b.days);
}
function byFollowup(a, b) { const ad = a.followup_by, bd = b.followup_by; if (ad == null && bd == null) return b.occurred_at.localeCompare(a.occurred_at); if (ad == null) return 1; if (bd == null) return -1; return ad.localeCompare(bd); }
function daysUntilYmd(ymd, t) { return Math.round((new Date(`${ymd}T00:00:00Z`).getTime() - new Date(`${t}T00:00:00Z`).getTime()) / 86_400_000); }
function daysUntilAnnual(ymd, t) {
  const [, mm, dd] = ymd.split('-').map(Number); const [ty] = t.split('-').map(Number);
  const todayMs = Date.UTC(ty, 0, 1) + (new Date(`${t}T00:00:00Z`).getTime() - Date.UTC(ty, 0, 1));
  let cand = Date.UTC(ty, mm - 1, dd);
  if (cand < new Date(`${t}T00:00:00Z`).getTime()) cand = Date.UTC(ty + 1, mm - 1, dd);
  return Math.round((cand - new Date(`${t}T00:00:00Z`).getTime()) / 86_400_000);
}
