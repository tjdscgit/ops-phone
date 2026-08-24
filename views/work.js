// Work — the manager's map.
//
// A direct port of the dashboard's /work screen (apps/web/.../work-view.tsx):
// domain sections with a colour swatch and sticky header, project cards in a
// grid with a colour bar + progress + urgency pill, content rows with the
// holder-flip action, "+ Project in X", and Tomorrow's Focus at the top.
// Layout and colours are copied from the dashboard, not reinvented — the two
// are meant to be demonstrably the same product at a different width.

import { sb, ref, refName } from '../lib/db.js';
import { el, hint, spinner, pill, humanise, chips, toast, fail } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { loadWork } from '../lib/work.js';
import { domainColor } from '../lib/domain-colors.js';

const CONTENT_TYPE_LABEL = {
  video: 'Video', course: 'Course', article: 'Article',
  short_clip: 'Short', podcast_episode: 'Podcast', newsletter: 'Newsletter',
};

const URGENCY_LABEL = { over: 'Overdue', due: 'Due today', ok: 'On track', quiet: 'Quiet' };

const projectNeedsAttention = (p) => p.flagged || p.overdue > 0 || (p.waitDays != null && p.waitDays >= 7);
const contentNeedsAttention = (c) => c.flagged || (c.holder === 'editor' && c.days != null && c.days >= 7) || c.myMoveDue;
const domainNeedsAttention = (d) =>
  d.rollup.attention > 0 || d.projects.some(projectNeedsAttention) || d.content.some(contentNeedsAttention) ||
  d.direct.overdue > 0 || d.direct.waitingAging > 0;

export async function workView(mount) {
  mount.replaceChildren(masthead(0), spinner());

  let w;
  try {
    w = await loadWork();
  } catch (err) {
    mount.lastChild.replaceWith(hint(err?.message || String(err)));
    return;
  }

  let attention = false;
  const collapsed = new Set();

  const body = el('div', { class: 'screen work-screen' });
  mount.lastChild.replaceWith(body);
  mount.firstChild.replaceWith(masthead(w.ideasCount));

  async function render() {
    const attentionCount = w.domains.filter(domainNeedsAttention).length;

    const filter = chips(
      [
        { value: 'all', label: `All work (${w.domains.length})` },
        { value: 'attention', label: `Needs attention (${attentionCount})` },
      ],
      attention ? 'attention' : 'all',
      (v) => { attention = v === 'attention'; render(); },
    );

    const visible = attention ? w.domains.filter(domainNeedsAttention) : w.domains;

    const focusRow = await tomorrowFocusRow(w);

    const sections = [];
    if (attention && visible.length === 0) {
      sections.push(emptyState('Nothing needs attention.', 'Everything is on pace. Rare — worth noticing.'));
    } else {
      sections.push(...visible.map((d) => domainSection(d, collapsed, render)));
    }

    const parked = w.parked.length
      ? el('div', { class: 'work-parked' },
          el('button', {
            class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.08em; text-decoration:none',
            onclick: (e) => {
              const wrap = e.currentTarget.nextSibling;
              wrap.classList.toggle('hidden');
            },
          }, `Parked (${w.parked.length})`),
          el('div', { class: 'hidden', style: 'margin-top:12px; opacity:0.6' },
            ...w.parked.map((d) => domainSection(d, collapsed, render))))
      : null;

    body.replaceChildren(
      el('div', { class: 'controls', style: 'padding-top:0' }, filter),
      focusRow,
      ...sections,
      parked,
    );
  }

  await render();
}

function masthead(ideasCount) {
  return el('header', { class: 'screen-head' },
    el('div', { class: 'row-actions' },
      el('div', {},
        el('div', { class: 'eyebrow' }, 'Manager’s map · everything computed'),
        el('h1', {}, 'Work'),
      ),
      el('div', { class: 'work-head-actions' },
        el('button', { class: 'ghost small', type: 'button', onclick: () => go('#/c/content') }, `Ideas (${ideasCount})`),
        el('button', { class: 'work-cta', type: 'button', onclick: () => go('#/c/projects/new') }, '+ Project'),
      ),
    ),
  );
}

// ─── Tomorrow's focus ──────────────────────────────────────────────────────

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function tomorrowFocusRow(w) {
  const date = tomorrowDate();
  const wrap = el('div', { class: 'work-focus' });

  const options = [];
  for (const d of w.domains) {
    for (const p of d.projects) {
      if (p.paused) continue;
      options.push({ type: 'project', id: p.id, label: p.name, context: p.client ?? d.name });
    }
    for (const c of d.content) {
      if (c.holder !== 'me') continue;
      options.push({ type: 'content_item', id: c.id, label: c.title, context: humanise(c.status) });
    }
  }

  async function load() {
    const { data } = await sb.from('daily_focus').select('*').eq('date', date).limit(1);
    return data?.[0] ?? null;
  }

  async function draw() {
    const current = await load();
    let open = false;

    const set = async (o) => {
      await sb.from('daily_focus').delete().eq('date', date);
      const { error } = await sb.from('daily_focus').insert({ date, target_type: o.type, target_id: o.id });
      if (error) { fail(error); return; }
      toast('Tomorrow’s focus set');
      draw();
    };
    const clear = async () => {
      await sb.from('daily_focus').delete().eq('date', date);
      toast('Cleared');
      draw();
    };

    const label = current
      ? (current.target_type === 'project' ? refName('project', current.target_id) : refName('contentItem', current.target_id))
      : null;

    const line = el('div', { class: 'work-focus-line' },
      el('span', { class: 'eyebrow' }, 'Tomorrow'),
      current
        ? el('span', {}, label || '(missing)')
        : el('button', { class: 'linkish', type: 'button', onclick: () => { open = !open; renderList(); } }, 'Set tomorrow’s focus →'),
      current ? el('button', { class: 'linkish', type: 'button', onclick: () => { open = !open; renderList(); } }, 'change') : null,
      current ? el('button', { class: 'linkish', type: 'button', onclick: clear }, 'clear') : null,
    );

    const listBox = el('div', { class: 'hidden' });

    function renderList() {
      listBox.className = open ? '' : 'hidden';
      if (!open) return;
      listBox.replaceChildren(
        options.length
          ? el('div', { class: 'list' }, ...options.map((o) =>
              el('button', { class: 'item', type: 'button', onclick: () => set(o) },
                el('div', { class: 'item-title' }, o.label),
                o.context ? el('div', { class: 'item-meta' }, o.context) : null,
              )))
          : hint('Nothing to pick from yet.'),
      );
    }

    wrap.replaceChildren(line, listBox);
  }

  await draw();
  return wrap;
}

// ─── Domain section ─────────────────────────────────────────────────────

function domainSection(d, collapsed, refresh) {
  const color = domainColor(d.name);
  const isCollapsed = collapsed.has(d.id);
  const r = d.rollup;
  const showDirect = d.direct.open > 0 || d.direct.waiting > 0;
  const empty = d.projects.length === 0 && d.content.length === 0 && !showDirect;

  const head = el('div', { class: 'work-domain-head' },
    el('span', { class: 'work-swatch', style: `background:${color}` }),
    el('button', { class: 'work-domain-name', type: 'button', onclick: () => go(`#/c/domains/${d.id}`) }, d.name),
    pill(d.urgency, URGENCY_LABEL[d.urgency]),
    el('div', { class: 'work-domain-counts' },
      el('span', {}, `${r.open} open`),
      r.overdue > 0 ? el('span', { class: 'over' }, `${r.overdue} overdue`) : null,
      r.waiting > 0 ? el('span', {}, `${r.waiting} waiting`) : null,
    ),
    el('button', {
      class: 'work-collapse', type: 'button', 'aria-label': isCollapsed ? 'Expand' : 'Collapse',
      onclick: () => { isCollapsed ? collapsed.delete(d.id) : collapsed.add(d.id); refresh(); },
    }, isCollapsed ? '▸' : '▾'),
  );

  const kids = [];
  if (!isCollapsed) {
    if (d.projects.length) {
      kids.push(el('div', { class: 'work-project-grid' }, ...d.projects.map((p) => projectCard(p, color))));
    }
    if (d.content.length) {
      kids.push(el('div', { class: 'work-content-list' }, ...d.content.map((c) => contentRow(c, color, refresh))));
    }
    const links = el('div', { class: 'work-links' },
      showDirect
        ? el('button', { class: 'ghost small', type: 'button', onclick: () => go('#/tasks') },
            `Direct tasks ${d.direct.open}${d.direct.overdue ? ` · ${d.direct.overdue} overdue` : ''}${d.direct.waiting ? ` · ${d.direct.waiting} waiting` : ''}`)
        : null,
      el('button', { class: 'linkish', type: 'button', onclick: () => go(`#/c/projects/new?domain_id=${d.id}`) }, `+ Project in ${d.name}`),
    );
    kids.push(links);
    if (empty) kids.push(el('p', { class: 'item-meta plain', style: 'font-style:italic; margin-top:2px' }, 'Nothing open.'));
  }

  return el('section', { class: 'work-domain' }, head, ...(isCollapsed ? [] : kids));
}

function projectCard(p, color) {
  const pct = p.kind === 'target' ? p.pct : p.cycle ? Math.round((p.cycle.day / p.cycle.length) * 100) : null;
  return el('button', {
    class: `work-project-card ${p.flagged ? 'flagged' : ''} ${p.paused ? 'paused' : ''}`,
    type: 'button', onclick: () => go(`#/c/projects/${p.id}`),
  },
    el('div', { class: 'work-project-bar', style: `background:${color}` }),
    el('div', { class: 'work-project-body' },
      el('div', { class: 'work-project-head' },
        el('span', { class: 'work-project-name' },
          p.flagged ? el('span', { class: 'work-flag-dot' }) : null,
          p.name,
        ),
        pill(p.urgency, URGENCY_LABEL[p.urgency]),
      ),
      el('div', { class: 'item-meta' },
        p.kind === 'retainer'
          ? (p.cycle ? `Retainer · day ${p.cycle.day}/${p.cycle.length}` : 'Retainer')
          : (p.target ? `Target ${p.target.slice(5)}` : 'No target'),
        p.paused ? '· paused' : null,
      ),
      pct != null ? el('div', { class: 'progress-bar' },
        el('div', { class: 'progress-fill', style: `width:${pct}%; background:${p.kind === 'target' ? '#57524A' : '#B6AFA4'}` })) : null,
      el('div', { class: 'work-project-foot' },
        el('span', { class: 'item-meta plain' },
          `${p.open} open`,
          p.waiting > 0 ? ` · ${p.waiting} waiting` : '',
          p.overdue > 0 ? ' · ' : '',
          p.overdue > 0 ? el('span', { class: 'over' }, `${p.overdue} overdue`) : '',
        ),
        el('span', { class: 'item-meta plain' }, p.recency),
      ),
      p.waiting > 0 && p.waitOn
        ? el('div', { class: 'item-meta plain' }, `waiting on ${p.waitOn} ${p.waitDays}d`)
        : null,
    ),
  );
}

function contentRow(c, color, refresh) {
  const withEditor = c.holder === 'editor';
  return el('div', { class: 'work-content-row' },
    el('span', { class: `work-swatch small ${c.flagged ? 'ring' : ''}`, style: `background:${color}` }),
    el('button', { class: 'work-content-main', type: 'button', onclick: () => go(`#/c/content/${c.id}`) },
      el('div', { class: 'work-content-title' }, c.title),
      el('div', { class: 'item-meta' },
        CONTENT_TYPE_LABEL[c.type] ?? humanise(c.type),
        withEditor
          ? ` · with editor ${c.days ?? 0}d`
          : (c.move ? ` · ${c.move}` : ''),
      ),
    ),
    pill(c.urgency, URGENCY_LABEL[c.urgency]),
    el('button', {
      class: 'ghost small', type: 'button',
      title: withEditor ? 'Take it back' : 'Send to editor',
      onclick: async () => {
        const { error } = await sb.from('content_items').update({ holder: withEditor ? 'me' : 'editor' }).eq('id', c.id);
        if (error) { fail(error); return; }
        refresh();
      },
    }, withEditor ? '→ me' : '→ editor'),
  );
}

function emptyState(title, sub) {
  return el('div', { class: 'work-empty' },
    el('div', { class: 'work-empty-title' }, title),
    el('p', { class: 'item-meta plain' }, sub),
  );
}
