// Domain (Folder) detail — a port of apps/web's domains/[id]/page.tsx: open
// tasks (direct + project-grouped), a waiting section, the domain edit form,
// and the cadence-rule editor that Today's briefing and the Work pulse board
// both read from stewardship_domains.failure_patterns. Was previously
// reached only through the generic schema-driven form.

import { sb, ref, refName } from '../lib/db.js';
import { el, hint, spinner, toast, fail, screenHead, niceDate, today } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { taskRow } from './tasks.js';

const CADENCE_RULE_TYPES = ['none', 'days_since_journal', 'days_since_publish', 'no_activity_days'];
const CADENCE_RULE_LABELS = {
  none: 'None — unconfigured',
  days_since_journal: 'Days since a journal entry',
  days_since_publish: 'Days since publish (content_items)',
  no_activity_days: 'Days since project activity (activity_log)',
};
const PRIMARY_CADENCE_RULES = new Set(CADENCE_RULE_TYPES.filter((r) => r !== 'none'));
const CADENCE_RULE_SHORT = {
  days_since_journal: 'days since journal', days_since_publish: 'days since publish', no_activity_days: 'days since activity',
};

function extractCadenceRule(patterns) {
  if (!Array.isArray(patterns)) return { rule: 'none', value: null };
  for (const p of patterns) {
    if (p && typeof p === 'object' && typeof p.rule === 'string' && PRIMARY_CADENCE_RULES.has(p.rule)) {
      return { rule: p.rule, value: typeof p.value === 'number' ? p.value : null };
    }
  }
  return { rule: 'none', value: null };
}
function advancedPatterns(patterns) {
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((p) => p && typeof p === 'object' && typeof p.rule === 'string' && !PRIMARY_CADENCE_RULES.has(p.rule));
}
function describeCadence(patterns) {
  const { rule, value } = extractCadenceRule(patterns);
  if (rule === 'none' || value == null) return 'No cadence rule';
  return `${value} ${CADENCE_RULE_SHORT[rule] ?? rule}`;
}

export async function domainDetail(mount, { id }) {
  mount.replaceChildren(spinner());

  const [domainRes, openRes, waitingRes] = await Promise.all([
    sb.from('stewardship_domains').select('*').eq('id', id).single(),
    sb.from('tasks').select('*').eq('domain_id', id).eq('status', 'open'),
    sb.from('tasks').select('*').eq('domain_id', id).eq('status', 'waiting'),
  ]);
  if (domainRes.error) { mount.replaceChildren(hint(domainRes.error.message)); return; }

  const domain = domainRes.data;
  const openTasks = openRes.data ?? [];
  const waitingTasks = [...(waitingRes.data ?? [])].sort((a, b) => (a.waiting_since ?? a.created_at).localeCompare(b.waiting_since ?? b.created_at));
  const isInbox = domain.is_system === true;

  function refresh() { domainDetail(mount, { id }); }

  const directTasks = openTasks.filter((t) => !t.project_id);
  const projectTasks = openTasks.filter((t) => t.project_id);
  const groups = new Map();
  for (const t of projectTasks) {
    const pid = t.project_id;
    const name = refName('project', pid) || '(unnamed project)';
    if (!groups.has(pid)) groups.set(pid, { name, tasks: [] });
    groups.get(pid).tasks.push(t);
  }
  const orderedGroups = [...groups.entries()].map(([pid, g]) => ({ id: pid, ...g })).sort((a, b) => a.name.localeCompare(b.name));

  const cadence = extractCadenceRule(domain.failure_patterns);

  const body = el('div', { class: 'lib-reader' },
    el('div', { class: 'lib-crumb' }, el('button', { class: 'linkish', type: 'button', onclick: () => go('#/c/domains') }, '← Folders')),
    screenHead(isInbox ? 'Inbox' : (domain.active ? 'Domain' : 'Domain · inactive'), domain.name, {
      meta: isInbox ? `${openTasks.length} ${openTasks.length === 1 ? 'task' : 'tasks'} awaiting triage` : describeCadence(domain.failure_patterns),
    }),
    isInbox ? el('div', { style: 'border:1px solid var(--line); padding:16px; margin-bottom:24px' },
      el('p', { style: 'font-family:var(--sans); font-size:13px; color:var(--ink-2); line-height:1.5' },
        'Tasks here are waiting for a home. Move them to a domain or project when you triage — Inbox is exempt from slippage detection.'),
      openTasks.length > 0 ? el('button', { class: 'linkish', type: 'button', style: 'margin-top:10px; text-decoration:none', onclick: () => go('#/today') }, 'Triage all →') : null,
    ) : editDomainForm(domain, refresh),

    el('div', { style: 'margin-top:34px' },
      el('div', { class: 'eyebrow', style: 'margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid var(--line)' }, `Open tasks · ${openTasks.length}`),
      openTasks.length === 0 ? el('p', { class: 'briefing-empty' }, 'No open tasks here.') : el('div', {},
        directTasks.length > 0 ? el('div', { style: 'margin-bottom:20px' },
          el('div', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); margin-bottom:6px' }, `Direct tasks · ${directTasks.length}`),
          ...directTasks.map((t) => taskRow(t, refresh)),
        ) : null,
        ...orderedGroups.map((g) => el('div', { style: 'margin-bottom:20px' },
          el('button', { class: 'linkish', type: 'button', style: 'display:block; margin-bottom:6px; text-decoration:none; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)', onclick: () => go(`#/c/projects/${g.id}`) }, `${g.name} · ${g.tasks.length}`),
          ...g.tasks.map((t) => taskRow(t, refresh)),
        )),
      ),
    ),

    waitingTasks.length > 0 ? el('div', { style: 'margin-top:26px' },
      el('div', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); margin-bottom:6px' }, `Waiting · ${waitingTasks.length}`),
      ...waitingTasks.map((t) => taskRow(t, refresh)),
    ) : null,

    !isInbox ? el('div', { style: 'margin-top:34px; padding-top:22px; border-top:1px solid var(--line)' },
      el('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, 'Cadence rule'),
      cadenceEditor(domain, refresh),
      cadence.rule === 'days_since_publish' ? el('div', { style: 'margin-top:20px; padding-top:20px; border-top:1px solid var(--line)' },
        el('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Off-dashboard publishes'),
        el('p', { style: 'font-family:var(--sans); font-size:12px; color:var(--ink-3); line-height:1.5; margin-bottom:10px' },
          'If you publish for this domain outside the dashboard and don’t plan to log it as a content item, tap below to record the publish manually.'),
        markShipped(domain, refresh),
      ) : null,
    ) : null,

    (!isInbox && advancedPatterns(domain.failure_patterns).length > 0) ? el('div', { style: 'margin-top:26px; padding-top:20px; border-top:1px solid var(--line)' },
      el('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Advanced patterns (read-only)'),
      el('p', { style: 'font-family:var(--sans); font-size:12px; color:var(--ink-3); line-height:1.5; margin-bottom:10px' }, 'Advanced rule types take more parameters than this editor handles — edit via SQL.'),
      el('pre', { style: 'font-family:var(--mono); font-size:11px; color:var(--ink-2); background:var(--surface); border:1px solid var(--line); padding:10px; overflow:auto' }, JSON.stringify(advancedPatterns(domain.failure_patterns), null, 2)),
    ) : null,
  );

  mount.replaceChildren(body);
}

function editDomainForm(domain, refresh) {
  const v = {
    name: domain.name, description: domain.description ?? '', fruit_definition: domain.fruit_definition ?? '',
    active: domain.active, stale_enabled: domain.stale_enabled ?? true, stale_days: domain.stale_days ?? 21,
  };
  const nameInput = el('input', { type: 'text', oninput: (e) => { v.name = e.target.value; } }); nameInput.value = v.name;
  const descInput = el('textarea', { rows: 2, placeholder: 'What this domain is — short context.', oninput: (e) => { v.description = e.target.value; } }); descInput.value = v.description;
  const fruitInput = el('textarea', { rows: 2, placeholder: 'What good looks like in this domain.', oninput: (e) => { v.fruit_definition = e.target.value; } }); fruitInput.value = v.fruit_definition;
  const activeCb = el('input', { type: 'checkbox', checked: v.active, onchange: (e) => { v.active = e.target.checked; } });
  const staleCb = el('input', { type: 'checkbox', checked: v.stale_enabled, onchange: (e) => { v.stale_enabled = e.target.checked; } });
  const staleDaysInput = el('input', { type: 'number', min: '1', style: 'width:70px; text-align:center', oninput: (e) => { v.stale_days = e.target.value; } }); staleDaysInput.value = v.stale_days;

  const cadenceTracked = extractCadenceRule(domain.failure_patterns).rule !== 'none';
  const msg = el('div', {});
  const save = el('button', { class: 'primary', style: 'width:auto', onclick: async () => {
    if (!v.name.trim()) { msg.replaceChildren(hint('Name is required.')); return; }
    save.disabled = true;
    const { error } = await sb.from('stewardship_domains').update({
      name: v.name.trim(), description: v.description.trim() || null, fruit_definition: v.fruit_definition.trim() || null,
      active: v.active, stale_enabled: v.stale_enabled, stale_days: v.stale_days === '' ? null : Number(v.stale_days),
    }).eq('id', domain.id);
    save.disabled = false;
    if (error) { fail(error); return; }
    toast('Saved');
    refresh();
  } }, 'Save');

  return el('div', { style: 'max-width:640px' },
    field('Name', nameInput),
    field('Description', descInput),
    field('Fruit definition', fruitInput),
    el('label', { class: 'check' }, activeCb, el('span', {}, 'Active (uncheck to hide from lists and observations)')),
    el('div', { style: 'margin-top:16px; padding-top:14px; border-top:1px solid var(--line)' },
      el('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Attention staleness'),
      el('label', { class: 'check' }, staleCb, el('span', {}, 'Flag in Attention when nothing ships for a while')),
      el('div', { style: 'display:flex; align-items:center; gap:8px; margin-top:6px; font-family:var(--sans); font-size:13px; color:var(--ink-2)' }, 'Stale after', staleDaysInput, 'days'),
      cadenceTracked ? el('p', { style: 'margin-top:8px; font-family:var(--sans); font-size:12px; color:var(--ink-3); line-height:1.5' },
        'A cadence rule already tracks this domain, so Observations surfaces its staleness. Attention skips it to avoid double-flagging.') : null,
    ),
    el('div', { class: 'form-actions', style: 'margin-top:14px' }, save, msg),
  );
}

function cadenceEditor(domain, refresh) {
  const current = extractCadenceRule(domain.failure_patterns);
  const ruleSel = el('select', {});
  for (const r of CADENCE_RULE_TYPES) ruleSel.append(el('option', { value: r }, CADENCE_RULE_LABELS[r]));
  ruleSel.value = current.rule;
  const valueInput = el('input', { type: 'number', min: '1', step: '1', placeholder: 'e.g. 7' });
  if (current.value != null) valueInput.value = current.value;
  const msg = el('div', {});
  const save = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
    const rule = ruleSel.value;
    const value = valueInput.value.trim() ? Number(valueInput.value) : null;
    if (rule !== 'none' && (!value || value < 1)) { msg.replaceChildren(hint('Set a threshold (days) for this rule.')); return; }
    save.disabled = true;
    const kept = advancedPatterns(domain.failure_patterns);
    const next = rule === 'none' ? kept : [...kept, { rule, value }];
    const { error } = await sb.from('stewardship_domains').update({ failure_patterns: next }).eq('id', domain.id);
    save.disabled = false;
    if (error) { fail(error); return; }
    toast('Saved');
    refresh();
  } }, 'Save cadence');

  return el('div', { style: 'display:flex; flex-direction:column; gap:10px; max-width:640px' },
    el('div', { class: 'row' }, field('Cadence rule', ruleSel), field('Threshold (days)', valueInput)),
    el('p', { style: 'font-family:var(--sans); font-size:12px; color:var(--ink-3); line-height:1.5' },
      'Once a domain crosses the threshold, Today’s briefing surfaces it as slipping and the Work pulse board sorts it worst-first. Pick "None" to drop the rule.'),
    el('div', { style: 'display:flex; align-items:center; gap:10px' }, save, msg),
  );
}

function markShipped(domain, refresh) {
  const label = domain.last_shipped_at ? `Last shipped ${niceDate(domain.last_shipped_at.slice(0, 10))}` : 'Never marked';
  return el('div', { style: 'display:flex; align-items:center; gap:12px; flex-wrap:wrap' },
    el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: async () => {
      const { error } = await sb.from('stewardship_domains').update({ last_shipped_at: new Date().toISOString() }).eq('id', domain.id);
      if (error) { fail(error); return; }
      toast('Stamped');
      refresh();
    } }, 'Mark shipped now'),
    el('span', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, label),
  );
}

function field(label, node) { return el('div', { class: 'field' }, el('label', {}, label), node); }
