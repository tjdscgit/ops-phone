// Work — the manager's map.
//
// Ported from the dashboard's Work page: one pulse board of every domain with
// open work, each showing its projects, in-flight content and direct tasks,
// ordered exactly as lib/work.js derives it (attention-flagged domains first,
// then by volume). Nothing here is curated or re-sorted by the view — the
// contract's ordering lives in the data layer so this screen and the
// dashboard can never disagree.

import { el, hint, spinner, screenHead, sectionLabel, pill, humanise, niceDate } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { loadWork } from '../lib/work.js';

export async function workView(mount) {
  mount.replaceChildren(screenHead('Manager’s map', 'Work'), spinner());

  let w;
  try {
    w = await loadWork();
  } catch (err) {
    mount.lastChild.replaceWith(hint(err?.message || String(err)));
    return;
  }

  const body = el('div', { class: 'screen' });

  if (w.ideasCount) {
    body.append(el('button', {
      class: 'linkish', type: 'button', style: 'margin:0 20px 4px; display:block',
      onclick: () => go('#/c/content'),
    }, `${w.ideasCount} idea${w.ideasCount === 1 ? '' : 's'} waiting in Content.`));
  }

  if (w.domains.length) {
    body.append(...w.domains.map(domainCard));
  } else {
    body.append(hint('No open work in any folder.'));
  }

  if (w.parked.length) {
    body.append(
      sectionLabel('Parked'),
      el('div', { class: 'list' }, ...w.parked.map((d) =>
        el('button', {
          class: 'item', type: 'button', onclick: () => go(`#/c/domains/${d.id}`),
        },
          el('div', { class: 'item-title' }, d.name),
          el('div', { class: 'item-meta' }, `${d.rollup.open} open`, `${d.rollup.waiting} waiting`),
        ))),
    );
  }

  mount.lastChild.replaceWith(body);
}

// ─── Domain card ───────────────────────────────────────────────────────────

function domainCard(d) {
  const rows = [];
  for (const p of d.projects) rows.push(projectRow(p));
  for (const c of d.content) rows.push(contentRow(c));
  if (d.direct.open || d.direct.waiting) rows.push(directRow(d.direct));

  return el('div', { class: 'work-domain' },
    el('button', { class: 'work-domain-head', type: 'button', onclick: () => go(`#/c/domains/${d.id}`) },
      el('div', { class: 'work-domain-name' },
        d.name,
        d.rollup.attention > 0 ? pill('over', String(d.rollup.attention), false) : null,
      ),
      pill(d.urgency, urgencyText(d.urgency)),
    ),
    el('div', { class: 'work-domain-meta' },
      d.rollup.overdue ? el('span', { class: 'over' }, `${d.rollup.overdue} overdue`) : null,
      d.rollup.open ? el('span', {}, `${d.rollup.open} open`) : null,
      d.rollup.waiting ? el('span', {}, `${d.rollup.waiting} waiting`) : null,
    ),
    rows.length ? el('div', { class: 'work-rows' }, ...rows) : null,
  );
}

function urgencyText(u) {
  return { over: 'Overdue', due: 'Due', ok: 'On track', quiet: 'Quiet' }[u] ?? u;
}

// ─── Project row ─────────────────────────────────────────────────────────

function projectRow(p) {
  const bits = [];
  if (p.paused) bits.push('Paused');
  if (p.client) bits.push(p.client);
  if (p.kind === 'retainer' && p.cycle) bits.push(`Day ${p.cycle.day}/${p.cycle.length}`);
  if (p.kind === 'target' && p.target) bits.push(`Due ${niceDate(p.target)}`);
  if (p.pct != null) bits.push(`${p.pct}%`);
  bits.push(p.recency);
  if (p.waitDays != null) bits.push(`waiting ${p.waitDays}d${p.waitOn ? ` on ${p.waitOn}` : ''}`);

  return el('button', { class: 'work-row', type: 'button', onclick: () => go(`#/c/projects/${p.id}`) },
    el('div', { class: 'work-row-main' },
      el('div', { class: 'work-row-title' },
        p.name,
        p.flagged ? pill('over', '!', false) : null,
      ),
      el('div', { class: 'item-meta plain' }, bits.filter(Boolean).join(' · ')),
    ),
    el('div', { class: 'work-row-side' },
      p.pct != null ? progressBar(p.pct) : null,
      pill(p.urgency, urgencyText(p.urgency), false),
    ),
  );
}

function progressBar(pct) {
  return el('div', { class: 'progress-bar' }, el('div', { class: 'progress-fill', style: `width:${pct}%` }));
}

// ─── Content row ─────────────────────────────────────────────────────────

function contentRow(c) {
  const bits = [humanise(c.type), humanise(c.status)];
  if (c.holder === 'editor') bits.push(c.days != null ? `with editor ${c.days}d` : 'with editor');
  if (c.move) bits.push(c.move);
  if (c.target) bits.push(`target ${niceDate(c.target)}`);

  return el('button', { class: 'work-row', type: 'button', onclick: () => go(`#/c/content/${c.id}`) },
    el('div', { class: 'work-row-main' },
      el('div', { class: 'work-row-title' },
        c.title,
        c.flagged ? pill('over', '!', false) : null,
      ),
      el('div', { class: 'item-meta plain' }, bits.filter(Boolean).join(' · ')),
    ),
    el('div', { class: 'work-row-side' }, pill(c.urgency, urgencyText(c.urgency), false)),
  );
}

// ─── Direct tasks ────────────────────────────────────────────────────────
// Tasks in the domain that aren't attached to any project — folded into one
// summary row rather than listed individually; Tasks already has the list.

function directRow(direct) {
  const bits = [];
  if (direct.overdue) bits.push(`${direct.overdue} overdue`);
  if (direct.open) bits.push(`${direct.open} open`);
  if (direct.waiting) bits.push(`${direct.waiting} waiting`);

  return el('button', { class: 'work-row', type: 'button', onclick: () => go('#/tasks') },
    el('div', { class: 'work-row-main' },
      el('div', { class: 'work-row-title' }, 'Direct tasks'),
      el('div', { class: 'item-meta plain' }, bits.join(' · ')),
    ),
  );
}
