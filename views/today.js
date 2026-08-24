// Today — "The Briefing", the editorial home screen.
//
// A direct port of the dashboard's /today page.tsx + brief-line.tsx: a
// masthead with a derived pill row, a two-column layout (left ledger: Needs
// a move → Silent clients → Attention → Reflection → Latest quote; right
// sticky rail: Today's events → Doing → Routines), and a Capture chips row.
// Layout and copy are copied from the dashboard, not reinvented.

import { sb } from '../lib/db.js';
import {
  el, hint, toast, fail, spinner, pill, tickBox,
  today, ymd, addDays, hhmm, humanise,
} from '../lib/ui.js';
import { go } from '../lib/router.js';
import { loadBriefing, skipResurfaceItem, resetResurfaceSkip } from '../lib/briefing.js';
import { taskRow } from './tasks.js';

export async function todayView(mount) {
  mount.replaceChildren(spinner());

  let b;
  try {
    b = await loadBriefing();
  } catch (err) {
    mount.lastChild.replaceWith(hint(err?.message || String(err)));
    return;
  }

  const t = today();
  const reload = () => go('#/today');

  const root = el('div', { class: 'briefing' },
    masthead(b),
    el('div', { class: 'hairline-strong', style: 'margin:16px 20px 0' }),
    focusLine(b.focus),
    anchorLine(b),
    inboxBanner(b),
    el('div', { class: 'briefing-grid' },
      el('div', { class: 'briefing-left' },
        needsAMove(b),
        silentClients(b, reload),
        attentionSection(b, reload),
        reflection(b, t, reload),
        latestQuote(b),
      ),
      el('div', { class: 'briefing-right' },
        todaysEvents(b),
        doing(b, reload),
        routinesCompact(b, t, reload),
      ),
    ),
    captureChips(),
  );

  mount.lastChild.replaceWith(root);
}

// ─── Masthead ──────────────────────────────────────────────────────────

function mastheadDate() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const wk = isoWeek(d);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short' }).toUpperCase()} ${day} · WEEK ${wk}`;
}

function isoWeek(d) {
  const c = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  c.setUTCDate(c.getUTCDate() + 4 - (c.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(c.getUTCFullYear(), 0, 1));
  return Math.ceil(((c - yearStart) / 86400000 + 1) / 7);
}

function masthead(b) {
  const r = b.routines;
  return el('header', { class: 'screen-head briefing-head' },
    el('div', { class: 'row-actions' },
      el('div', {},
        el('div', { class: 'eyebrow' },
          mastheadDate(),
          b.unreadCount > 0 ? el('span', {},
            ' · ',
            el('button', { class: 'linkish', type: 'button', onclick: () => go('#/notifications') }, `${b.unreadCount} unread`),
          ) : null,
        ),
        el('h1', {}, 'The Briefing'),
      ),
      el('div', { class: 'briefing-pills' },
        b.tasks.overdueCount > 0 ? pill('over', `${b.tasks.overdueCount} overdue`) : null,
        b.tasks.openCount > 0 ? pill('due', `${b.tasks.openCount} open`) : null,
        b.tasks.waitingCount > 0 ? pill('quiet', `${b.tasks.waitingCount} waiting`) : null,
        r.all.length > 0 ? pill(r.done >= r.all.length ? 'ok' : 'quiet', `Routines ${r.done}/${r.all.length}`) : null,
      ),
    ),
  );
}

// ─── Focus line ────────────────────────────────────────────────────────

function focusLine(focus) {
  if (!focus) return null;
  return el('div', { class: 'briefing-focus' },
    el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(focus.href) },
      el('span', { class: 'eyebrow' }, 'Focus '),
      el('span', {}, focus.title || '(missing)'),
      el('span', { class: 'dim' }, ' →'),
    ),
    focus.note ? el('div', { class: 'item-meta plain', style: 'margin-top:2px' }, focus.note) : null,
  );
}

// ─── Anchor line ───────────────────────────────────────────────────────

function anchorLine(b) {
  if (b.events.length === 0 && b.tasks.openCount === 0) return null;
  const parts = [];
  if (b.events.length) {
    const e = b.nextEvent;
    parts.push(
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/c/calendar') },
        `${b.events.length} event${b.events.length === 1 ? '' : 's'} today`,
        e ? el('span', {}, ' — next ', el('b', {}, hhmm(new Date(e.start_at).toTimeString().slice(0, 5))), ` ${e.title}`) : null,
        '.',
      ),
    );
  }
  if (b.tasks.openCount > 0) {
    parts.push(
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/tasks') },
        ` ${b.tasks.openCount} task${b.tasks.openCount === 1 ? '' : 's'} open`,
        b.tasks.overdueCount > 0 ? el('span', { class: 'over' }, ` · ${b.tasks.overdueCount} overdue`) : null,
        '.',
      ),
    );
  }
  return el('p', { class: 'briefing-anchor' }, ...parts);
}

// ─── Inbox triage ──────────────────────────────────────────────────────

function inboxBanner(b) {
  if (!b.inboxCount) return null;
  return el('button', { class: 'briefing-inbox', type: 'button', onclick: () => go('#/tasks') },
    el('div', {},
      el('div', { class: 'eyebrow', style: 'color:var(--accent)' }, 'Inbox'),
      el('div', { style: 'font-family:var(--sans); font-size:13px; color:var(--ink); margin-top:2px' },
        `${b.inboxCount} ${b.inboxCount === 1 ? 'task needs' : 'tasks need'} a home.`),
    ),
    el('span', { class: 'eyebrow', style: 'color:var(--accent)' }, 'Triage →'),
  );
}

// ─── Needs a move (brief lines) ────────────────────────────────────────

function needsAMove(b) {
  return el('section', { class: 'briefing-section' },
    el('div', { class: 'briefing-section-head' },
      el('span', { class: 'eyebrow' }, `Needs a move${b.briefLines.length ? ` · ${b.briefLines.length}` : ''}`),
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/work') }, 'All work →'),
    ),
    b.briefLines.length === 0
      ? el('p', { class: 'briefing-empty' }, 'Nothing past cadence. Every domain is within its rhythm — rare and worth noticing.')
      : el('div', { style: 'display:flex; flex-direction:column; gap:10px' }, ...b.briefLines.map(briefLineCard)),
  );
}

function briefLineCard(line) {
  const over = line.status === 'stale' || line.ratio >= 1.5;
  return el('button', { class: 'brief-card', type: 'button', onclick: () => go(line.href) },
    el('div', { style: 'display:flex; align-items:flex-start; justify-content:space-between; gap:16px' },
      el('div', { style: 'flex:1; min-width:0' },
        el('div', { style: 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px' },
          el('h3', { style: 'margin:0; font-family:var(--serif); font-size:18px; font-weight:500; color:var(--ink)' }, line.name),
          pill(over ? 'over' : 'due', line.status === 'stale' ? 'Stale' : 'Slipping'),
        ),
      ),
      el('div', { style: 'text-align:right; flex:0 0 auto' },
        el('div', { style: `font-family:var(--serif); font-size:30px; line-height:0.9; font-weight:500; color:${over ? 'var(--accent)' : 'var(--ink)'}` }, String(line.metric)),
        el('div', { style: 'margin-top:5px; font-family:var(--sans); font-size:10px; color:var(--ink-3); max-width:110px' }, line.unit),
      ),
    ),
    cadenceBar(line.ratio),
    el('div', { style: 'margin-top:10px; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap' },
      el('span', { style: 'font-family:var(--sans); font-size:13px; font-weight:500; color:var(--accent); flex:1; min-width:0; text-align:left' }, line.next),
      el('span', { class: 'eyebrow' }, line.label),
    ),
    line.last ? el('div', { class: 'item-meta plain', style: 'margin-top:6px' }, line.last) : null,
  );
}

function cadenceBar(ratio) {
  const overdue = ratio > 1;
  const expectedFrac = overdue ? 1 / ratio : 1;
  const fillFrac = overdue ? 1 : ratio;
  const bar = el('div', { class: 'cadence-bar' },
    el('div', { class: 'cadence-fill', style: `width:${Math.min(expectedFrac, fillFrac) * 100}%` }),
    overdue ? el('div', { class: 'cadence-over', style: `left:${expectedFrac * 100}%; width:${(1 - expectedFrac) * 100}%` }) : null,
    el('div', { class: 'cadence-tick', style: `left:${expectedFrac * 100}%` }),
  );
  return bar;
}

// ─── Silent clients ────────────────────────────────────────────────────

function silenceUrgency(days) {
  if (days == null) return 'quiet';
  if (days >= 30) return 'over';
  if (days >= 14) return 'due';
  if (days <= 3) return 'ok';
  return 'quiet';
}
function silenceLabel(days) {
  if (days == null) return 'No contact';
  if (days === 0) return 'Today';
  return `${days}d`;
}
function silentDays(detail) {
  if (!detail) return null;
  const m = detail.match(/(\d+)\s*day/);
  return m ? Number(m[1]) : null;
}

function silentClients(b, refresh) {
  if (!b.silentClients.length) return null;
  return el('section', { class: 'briefing-section' },
    el('div', { class: 'briefing-section-head' },
      el('span', { class: 'eyebrow' }, `Silent clients · ${b.silentClients.length}`),
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/c/companies') }, 'Companies →'),
    ),
    el('div', { class: 'list' }, ...b.silentClients.map((c) => {
      const name = c.title.replace(/^Silent client:\s*/i, '');
      const days = silentDays(c.detail);
      return el('div', { class: 'item row-item' },
        el('button', { class: 'item-body', type: 'button', onclick: () => go(`#/c/companies/${c.source_id}`) },
          el('div', { class: 'item-title serif' }, name),
          c.detail ? el('div', { class: 'item-meta' }, c.detail) : null,
        ),
        pill(days == null ? 'over' : silenceUrgency(days), silenceLabel(days)),
        el('button', {
          class: 'ghost small', type: 'button',
          onclick: async () => {
            const { error } = await sb.from('conversations').insert({
              company_id: c.source_id, interaction_type: 'other', direction: 'outbound',
              summary: 'Checked in', occurred_at: new Date().toISOString(),
            });
            if (error) { fail(error); return; }
            toast('Logged');
            refresh();
          },
        }, 'Log check-in'),
      );
    })),
  );
}

// ─── Attention ─────────────────────────────────────────────────────────

function attentionSection(b, refresh) {
  if (!b.attentionItems.length) return null;
  return el('section', { class: 'briefing-section' },
    el('div', { class: 'briefing-section-head' },
      el('span', { class: 'eyebrow' }, `Attention${b.attentionActiveCount ? ` · ${b.attentionActiveCount} active` : ''}`),
      b.attentionActiveCount > b.attentionItems.length
        ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/attention') }, 'See all →')
        : null,
    ),
    el('div', { class: 'list' }, ...b.attentionItems.map((a) => attentionRow(a, refresh))),
  );
}

function attentionRow(a, refresh) {
  const act = async (patch, msg) => {
    const { error } = await sb.from('attention_items').update(patch).eq('id', a.id);
    if (error) { fail(error); return; }
    toast(msg);
    refresh();
  };
  return el('div', { class: 'item', style: 'cursor:default' },
    el('div', { style: 'display:flex; align-items:flex-start; gap:8px' },
      el('span', { class: `urgency-dot ${a.urgency}` }),
      el('div', { style: 'flex:1; min-width:0' },
        el('div', { class: 'item-title' }, a.title),
        a.detail ? el('div', { class: 'item-meta plain' }, a.detail) : null,
        el('div', { class: 'actions', style: 'margin-top:6px' },
          el('button', { class: 'ghost small', type: 'button', onclick: () => act({ status: 'acted_on', acted_on_at: new Date().toISOString() }, 'Marked done') }, 'Done'),
          el('button', { class: 'ghost small', type: 'button', onclick: () => act({ status: 'snoozed', snoozed_until: ymd(addDays(new Date(), 1)) }, 'Snoozed') }, 'Snooze'),
          el('button', { class: 'ghost small', type: 'button', onclick: () => act({ status: 'dismissed', dismissed_at: new Date().toISOString() }, 'Dismissed') }, 'Dismiss'),
        ),
      ),
    ),
  );
}

// ─── Reflection ────────────────────────────────────────────────────────

function reflection(b, t, refresh) {
  const r = b.resurfacing;
  if (!r.item && !r.exhausted) return null;
  return el('section', { class: 'briefing-reflection' },
    el('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, 'Reflection'),
    r.item
      ? el('div', {},
          el('blockquote', { style: 'margin:0; font-family:var(--serif); font-style:italic; font-size:17px; line-height:1.4; color:var(--ink)' }, `“${r.item.excerpt}”`),
          r.item.source ? el('div', { class: 'eyebrow', style: 'margin-top:10px' }, `— ${r.item.source}`) : null,
          el('div', { style: 'margin-top:10px; display:flex; align-items:center; gap:16px; flex-wrap:wrap' },
            el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(r.item.href) },
              `Open in ${r.item.kind === 'quote' ? 'Quotes' : 'Journal'} →`),
            el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => { skipResurfaceItem(t, r.item.id); refresh(); } }, 'Next →'),
            r.skipped > 0 ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => { resetResurfaceSkip(); refresh(); } }, 'Reset') : null,
          ),
        )
      : el('div', {},
          el('p', { style: 'margin:0; font-family:var(--serif); font-style:italic; font-size:15px; color:var(--ink-2)' },
            'You’ve seen every item in today’s rotation. Tomorrow’s pick will come from the same pool, fresh.'),
          el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none; margin-top:10px; display:inline-block', onclick: () => { resetResurfaceSkip(); refresh(); } }, 'Reset rotation now →'),
        ),
  );
}

// ─── Latest quote ──────────────────────────────────────────────────────

function latestQuote(b) {
  const q = b.latestQuote;
  if (!q || q.id === b.resurfacing.item?.id) return null;
  const attrib = [q.source_author, q.source_reference].filter(Boolean).join(' · ');
  return el('section', { class: 'briefing-quote' },
    el('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, 'Latest quote'),
    el('blockquote', { style: 'margin:0; font-family:var(--serif); font-style:italic; font-size:15px; line-height:1.4; color:var(--ink)' }, `“${q.text}”`),
    attrib ? el('div', { class: 'eyebrow', style: 'margin-top:10px' }, `— ${attrib}`) : null,
    el('div', { style: 'margin-top:10px; display:flex; align-items:center; gap:16px; flex-wrap:wrap' },
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/quotes/${q.id}`) }, 'Open quote →'),
      q.source_url ? el('a', { href: q.source_url, target: '_blank', rel: 'noopener noreferrer', class: 'linkish', style: 'text-decoration:none' }, 'Open source ↗') : null,
    ),
  );
}

// ─── Right rail ────────────────────────────────────────────────────────

function todaysEvents(b) {
  if (!b.events.length) return null;
  return el('section', { class: 'briefing-section' },
    el('div', { class: 'briefing-section-head' },
      el('span', { class: 'eyebrow' }, `Today · ${b.events.length} ${b.events.length === 1 ? 'event' : 'events'}`),
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/c/calendar') }, 'Open →'),
    ),
    b.nextEvent
      ? el('div', { class: 'briefing-event' },
          el('span', { style: 'font-family:var(--mono); font-size:12px; color:var(--ink); flex:0 0 auto; width:48px' },
            b.nextEvent.all_day ? 'All day' : hhmm(new Date(b.nextEvent.start_at).toTimeString().slice(0, 5))),
          el('span', { style: 'font-family:var(--sans); font-size:13px; color:var(--ink-2)' }, b.nextEvent.title),
        )
      : null,
    b.events.length > 1
      ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none; margin-top:6px; display:inline-block', onclick: () => go('#/c/calendar') },
          `+ ${b.events.length - 1} more →`)
      : null,
  );
}

function doing(b, refresh) {
  const { railTasks, railOverflow, openCount, overdueCount } = b.tasks;
  if (!railTasks.length && !openCount) return null;
  return el('section', { class: 'briefing-section' },
    el('div', { class: 'briefing-section-head' },
      el('span', { class: 'eyebrow' },
        'Doing',
        ` · ${openCount} open`,
        overdueCount > 0 ? el('span', { class: 'over' }, ` · ${overdueCount} overdue`) : null,
      ),
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/tasks') }, 'All tasks →'),
    ),
    railTasks.length === 0
      ? el('p', { class: 'briefing-empty' }, 'No tasks overdue or due today. Star one below to pin it as Top 3.')
      : el('div', { class: 'list' }, ...railTasks.map((x) => taskRow(x, refresh, { pinned: x.top3_for_date === today() }))),
    b.tasks.top3.length < 3 && railTasks.length > 0
      ? el('p', { class: 'item-meta plain', style: 'margin-top:8px' },
          `${3 - b.tasks.top3.length} Top 3 ${3 - b.tasks.top3.length === 1 ? 'slot' : 'slots'} open · tap ☆ on a row to pin`)
      : null,
    railOverflow > 0
      ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none; margin-top:6px; display:inline-block', onclick: () => go('#/tasks') }, `+ ${railOverflow} more →`)
      : null,
  );
}

function routinesCompact(b, t, refresh) {
  const r = b.routines;
  if (!r.all.length) return null;
  return el('section', { class: 'briefing-section' },
    el('div', { class: 'briefing-section-head' },
      el('span', { class: 'eyebrow' }, `Routines · ${r.done} of ${r.all.length} today`),
      el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go('#/routines') }, 'All →'),
    ),
    el('div', { class: 'list' }, ...r.all.map((x) => routineRow(x, doneSet(r), t, refresh))),
  );
}

function doneSet(r) {
  const doneIds = new Set(r.all.filter((x) => !r.remaining.some((y) => y.id === x.id)).map((x) => x.id));
  return doneIds;
}

function routineRow(x, doneIds, t, refresh) {
  const isDone = doneIds.has(x.id);
  return el('div', { class: 'item row-item' },
    tickBox({
      done: isDone, label: isDone ? `Uncheck ${x.name}` : `Check off ${x.name}`,
      onClick: async () => {
        if (isDone) {
          const { error } = await sb.from('routine_completions').delete().eq('routine_id', x.id).eq('completed_date', t);
          if (error) { fail(error); return; }
        } else {
          const { error } = await sb.from('routine_completions').insert({ routine_id: x.id, completed_date: t });
          if (error) { fail(error); return; }
        }
        refresh();
      },
    }),
    el('button', { class: 'item-body', type: 'button', onclick: () => go(`#/routines/${x.id}`) },
      el('div', { class: `item-title ${isDone ? 'done' : ''}` }, x.name),
      x.time_of_day ? el('div', { class: 'item-meta' }, humanise(x.time_of_day)) : null,
    ),
  );
}

// ─── Capture chips ─────────────────────────────────────────────────────

function captureChips() {
  const chips = [
    { label: 'Journal', href: '#/c/journal/new' },
    { label: 'Quote', href: '#/c/quotes/new' },
    { label: 'Note', href: '#/c/notes/new' },
    { label: 'Task', href: '#/tasks/new' },
  ];
  return el('section', { class: 'briefing-capture' },
    el('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Capture'),
    el('div', { style: 'display:flex; align-items:center; gap:8px; flex-wrap:wrap' },
      ...chips.map((c) => el('button', { class: 'capture-chip', type: 'button', onclick: () => go(c.href) }, c.label)),
      el('span', { class: 'eyebrow', style: 'margin-left:4px' }, '— or hold the mic.'),
    ),
  );
}
