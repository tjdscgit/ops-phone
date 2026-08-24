// Today — the editorial home screen.
//
// Ported from the dashboard's Today page: a masthead with an anchor line, a
// newspaper column of brief lines about what's slipping, then the things you
// act on. The dashboard's tone rule holds here — brief lines state facts, not
// advice: "23 days since a journal entry", never "you should journal more".
//
// Everything on it comes from one parallel batch (see lib/briefing.js) so the
// screen paints once rather than filling in piece by piece.

import { sb, ref, refName } from '../lib/db.js';
import {
  el, hint, chips, toast, fail, spinner,
  screenHead, sectionLabel, pill, tickBox,
  today, ymd, addDays, niceStamp, hhmm, humanise,
} from '../lib/ui.js';
import { go } from '../lib/router.js';
import { loadBriefing } from '../lib/briefing.js';
import { taskRow } from './tasks.js';

export async function todayView(mount) {
  const now = new Date();
  mount.replaceChildren(
    screenHead(
      now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      greeting(),
    ),
    spinner(),
  );

  let b;
  try {
    b = await loadBriefing();
  } catch (err) {
    mount.lastChild.replaceWith(hint(err?.message || String(err)));
    return;
  }

  const t = today();
  const body = el('div', { class: 'screen' });
  const reload = () => go('#/today');

  // ── Anchor line ────────────────────────────────────────────────────────
  // One sentence of orientation under the masthead, the way the dashboard
  // leads: what's on, what's set, what's waiting to be triaged.
  const anchor = anchorLine(b);
  if (anchor) body.append(el('p', { class: 'anchor' }, ...anchor));

  // ── Brief lines ────────────────────────────────────────────────────────
  if (b.briefLines.length) {
    body.append(sectionLabel('Slipping'));
    const col = el('div', { class: 'brief' });
    for (const line of b.briefLines) col.append(briefLine(line));
    body.append(col);
  }

  // ── Focus ──────────────────────────────────────────────────────────────
  body.append(focusBlock(t));

  // ── Attention ──────────────────────────────────────────────────────────
  const attn = await loadAttention(t);
  if (attn.length) {
    body.append(
      sectionLabel('Needs attention', pill('quiet', String(attn.length), false)),
      el('div', { class: 'list' }, ...attn.map(attentionRow)),
    );
  }

  // ── On today ───────────────────────────────────────────────────────────
  if (b.events.length) {
    body.append(
      sectionLabel('On today'),
      el('div', { class: 'list' }, ...b.events.map((e) =>
        el('button', { class: 'item', type: 'button', onclick: () => go(`#/c/calendar/${e.id}`) },
          el('div', { class: 'item-title serif' }, e.title),
          el('div', { class: 'item-meta' },
            e.all_day ? 'All day' : niceStamp(e.start_at),
            e.location ? el('span', {}, e.location) : null),
        ))),
    );
  }

  // ── Tasks ──────────────────────────────────────────────────────────────
  if (b.tasks.overdue.length) {
    body.append(
      sectionLabel('Overdue', pill('over', String(b.tasks.overdue.length), false)),
      el('div', { class: 'list' }, ...b.tasks.overdue.map((x) => taskRow(x, reload))),
    );
  }

  // Pinned tasks are the dashboard's Top 3 — the day's stated intent, so they
  // sit above the rest of the due list rather than mixed into it.
  if (b.tasks.top3.length) {
    body.append(
      sectionLabel('Top 3', pill('quiet', `${b.tasks.top3.length}/3`, false)),
      el('div', { class: 'list' }, ...b.tasks.top3.map((x) => taskRow(x, reload, { pinned: true }))),
    );
  }

  body.append(
    sectionLabel('Due today',
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'New task',
        onclick: () => go('#/tasks/new'),
      }, '+')),
    b.tasks.dueToday.length
      ? el('div', { class: 'list' }, ...b.tasks.dueToday.map((x) => taskRow(x, reload)))
      : hint('Nothing due today.'),
  );

  // ── Routines ───────────────────────────────────────────────────────────
  const r = b.routines;
  if (r.all.length) {
    body.append(
      sectionLabel('Routines',
        pill(r.remaining.length ? 'quiet' : 'ok', `${r.done}/${r.all.length}`, false)),
      r.remaining.length
        ? el('div', { class: 'list' }, ...r.remaining.map((x) => quickRoutine(x, t, reload)))
        : hint('All done today.'),
    );
  }

  // ── Latest quote ───────────────────────────────────────────────────────
  // The newest quote in the library, and it stays put until a newer one is
  // saved — not a daily rotation.
  if (b.latestQuote) {
    const q = b.latestQuote;
    const attrib = [q.source_author, q.source_reference].filter(Boolean).join(', ');
    body.append(
      sectionLabel('From the library'),
      el('button', {
        class: 'item quote', type: 'button', onclick: () => go(`#/c/quotes/${q.id}`),
      },
        el('div', { class: 'quote-text' }, q.text),
        attrib ? el('div', { class: 'item-meta' }, attrib) : null,
      ),
    );
  }

  mount.lastChild.replaceWith(body);
}

// ─── Anchor line ─────────────────────────────────────────────────────────

function anchorLine(b) {
  const parts = [];

  if (b.events.length) {
    const e = b.nextEvent;
    const when = e.all_day ? 'all day' : hhmm(new Date(e.start_at).toTimeString().slice(0, 5));
    parts.push(
      el('span', {}, `${b.events.length} event${b.events.length === 1 ? '' : 's'} today`),
      el('span', { class: 'dim' }, ' — next '),
      el('b', {}, `${when} ${e.title}`),
      el('span', {}, '. '),
    );
  }

  const due = b.tasks.dueToday.length + b.tasks.top3.length;
  if (due) parts.push(el('span', {}, `${due} task${due === 1 ? '' : 's'} set. `));
  if (b.tasks.overdue.length) {
    parts.push(el('b', { class: 'over' }, `${b.tasks.overdue.length} overdue. `));
  }
  if (b.inboxCount) {
    parts.push(el('button', {
      class: 'linkish', type: 'button', onclick: () => go('#/tasks'),
    }, `${b.inboxCount} in the inbox to sort.`));
  }

  return parts.length ? parts : null;
}

// ─── Brief line ──────────────────────────────────────────────────────────
// Big metric, small unit, the domain it belongs to, when it last happened,
// and the one action it offers.

function briefLine(line) {
  return el('button', {
    class: `brief-line ${line.status}`, type: 'button',
    onclick: () => go(line.href),
  },
    el('div', { class: 'brief-metric' },
      el('span', { class: 'big' }, line.big ?? String(line.metric)),
      el('span', { class: 'unit' }, line.unit),
    ),
    el('div', { class: 'brief-body' },
      el('div', { class: 'brief-name' },
        line.name,
        line.status === 'slip'
          ? pill('over', `${line.cadence}d cadence`)
          : pill('due', `${line.cadence}d cadence`),
      ),
      line.last ? el('div', { class: 'item-meta' }, line.last) : null,
      el('div', { class: 'brief-next' }, line.next, el('span', { class: 'arrow' }, '→')),
    ),
  );
}

// ─── Focus ───────────────────────────────────────────────────────────────

function focusBlock(t) {
  const wrap = el('div', {});

  const render = async () => {
    wrap.replaceChildren(sectionLabel("Today's focus"), spinner());
    const { data } = await sb.from('daily_focus').select('*').eq('date', t);
    const rows = data ?? [];
    wrap.replaceChildren(sectionLabel("Today's focus"));

    if (rows.length) {
      const list = el('div', { class: 'list' });
      for (const f of rows) {
        const label = f.target_type === 'project'
          ? refName('project', f.target_id)
          : refName('contentItem', f.target_id);
        list.append(el('div', { class: 'item row-item' },
          el('div', { class: 'item-body static' },
            el('div', { class: 'item-title serif' }, label || '(missing)'),
            el('div', { class: 'item-meta' }, humanise(f.target_type)),
          ),
          el('button', {
            class: 'tick dismiss', type: 'button', 'aria-label': 'Clear focus',
            onclick: async () => {
              const { error } = await sb.from('daily_focus').delete()
                .eq('date', t).eq('target_type', f.target_type).eq('target_id', f.target_id);
              if (error) { fail(error); return; }
              render();
            },
          }, '×'),
        ));
      }
      wrap.append(list);
      return;
    }

    const choices = [
      ...ref.projects.filter((p) => p.status === 'active')
        .map((p) => ({ value: `project:${p.id}`, label: p.name })),
      ...ref.contentItems.filter((c) => c.status !== 'done' && c.status !== 'published')
        .map((c) => ({ value: `content_item:${c.id}`, label: c.title })),
    ];

    if (!choices.length) {
      wrap.append(hint('Add an active project or content item to set a focus.'));
      return;
    }

    wrap.append(el('div', { class: 'controls' },
      chips(choices, null, async (val) => {
        const [target_type, target_id] = val.split(':');
        const { error } = await sb.from('daily_focus').insert({ date: t, target_type, target_id });
        if (error) { fail(error); return; }
        toast('Focus set');
        render();
      })));
  };

  render();
  return wrap;
}

// ─── Attention ───────────────────────────────────────────────────────────

async function loadAttention(t) {
  const { data } = await sb.from('attention_items').select('*')
    .eq('status', 'active')
    .or(`snoozed_until.is.null,snoozed_until.lte.${t}`)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(10);
  return data ?? [];
}

function attentionRow(a) {
  const act = async (patch, msg) => {
    const { error } = await sb.from('attention_items').update(patch).eq('id', a.id);
    if (error) { fail(error); return; }
    toast(msg);
    go('#/today');
  };

  return el('div', { class: 'item', style: 'cursor:default' },
    el('div', { style: 'display:flex; align-items:flex-start; gap:8px' },
      el('div', { style: 'flex:1; min-width:0' },
        el('div', { class: 'item-title serif' }, a.title),
        a.detail ? el('div', { class: 'item-meta plain' }, a.detail) : null,
      ),
      a.urgency === 'high' ? pill('over', 'High') : null,
    ),
    a.suggested_action
      ? el('div', { class: 'item-meta plain', style: 'font-style:italic' }, a.suggested_action)
      : null,
    el('div', { class: 'actions' },
      el('button', {
        class: 'ghost small',
        onclick: () => act({ status: 'acted_on', acted_on_at: new Date().toISOString() }, 'Marked done'),
      }, 'Done'),
      el('button', {
        class: 'ghost small',
        onclick: () => act({ status: 'snoozed', snoozed_until: ymd(addDays(new Date(), 1)) }, 'Snoozed'),
      }, 'Snooze'),
      el('button', {
        class: 'ghost small',
        onclick: () => act({ status: 'dismissed', dismissed_at: new Date().toISOString() }, 'Dismissed'),
      }, 'Dismiss'),
    ),
  );
}

// ─── Routine quick-tick ──────────────────────────────────────────────────

function quickRoutine(r, t, refresh) {
  return el('div', { class: 'item row-item' },
    tickBox({
      label: 'Mark done',
      onClick: async () => {
        const { error } = await sb.from('routine_completions')
          .insert({ routine_id: r.id, completed_date: t });
        if (error) { fail(error); return; }
        toast('Done');
        refresh();
      },
    }),
    el('button', { class: 'item-body', type: 'button', onclick: () => go(`#/routines/${r.id}`) },
      el('div', { class: 'item-title' }, r.name),
      el('div', { class: 'item-meta' }, humanise(r.time_of_day || 'anytime')),
    ),
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Afternoon' : 'Evening';
}
