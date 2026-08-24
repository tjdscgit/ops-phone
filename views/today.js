// Today — the home screen.
//
// Everything here is something you'd want to see before deciding what to do
// next: what you said mattered today, what the system flagged, what's due,
// what's on, and which routines are still outstanding. It's assembled from
// six tables in one parallel fetch so the screen paints once rather than
// filling in piece by piece.

import { sb, ref, refName } from '../lib/db.js';
import {
  el, panel, hint, chips, toast, fail, spinner,
  screenHead, sectionLabel, pill, tickBox,
  today, ymd, addDays, niceStamp, humanise,
} from '../lib/ui.js';
import { go } from '../lib/router.js';
import { taskRow } from './tasks.js';

export async function todayView(mount) {
  const now = new Date();
  const head = screenHead(
    now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
    greeting(),
  );
  mount.replaceChildren(head, spinner());

  const t = today();
  const dayStart = new Date(t + 'T00:00:00').toISOString();
  const dayEnd = new Date(t + 'T23:59:59').toISOString();

  const [tasksRes, focusRes, attnRes, eventsRes, routinesRes, doneRes] = await Promise.all([
    sb.from('tasks')
      .select('id, title, status, due_date, due_time, priority, domain_id, project_id, waiting_on, completed_at')
      .eq('status', 'open').not('due_date', 'is', null).lte('due_date', t)
      .order('due_date', { ascending: true }).order('priority', { ascending: true }),
    sb.from('daily_focus').select('*').eq('date', t),
    sb.from('attention_items').select('*')
      .eq('status', 'active')
      // A snoozed item is one you've already decided about; or() keeps rows
      // that were never snoozed alongside those whose snooze has run out.
      .or(`snoozed_until.is.null,snoozed_until.lte.${t}`)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(10),
    sb.from('calendar_events').select('*')
      .lte('start_at', dayEnd).gte('end_at', dayStart)
      .order('start_at'),
    sb.from('routines').select('id, name, time_of_day, goal_days')
      .is('archived_at', null).eq('active', true)
      .order('position', { ascending: true, nullsFirst: false }).order('name'),
    sb.from('routine_completions').select('routine_id, completed_date')
      .eq('completed_date', t),
  ]);

  const body = el('div', { class: 'screen' });

  body.append(focusBlock(focusRes.data ?? [], t));

  // Flagged items come before the task list: the point of the attention rules
  // is to surface something you would not otherwise have gone looking for.
  const attn = attnRes.data ?? [];
  if (attn.length) {
    body.append(
      sectionLabel('Needs attention'),
      el('div', { class: 'list' }, ...attn.map((a) => attentionRow(a))),
    );
  }

  const events = eventsRes.data ?? [];
  if (events.length) {
    body.append(
      sectionLabel('On today'),
      el('div', { class: 'list' }, ...events.map((e) =>
        el('button', {
          class: 'item', type: 'button', onclick: () => go(`#/c/calendar/${e.id}`),
        },
          el('div', { class: 'item-title serif' }, e.title),
          el('div', { class: 'item-meta' },
            e.all_day ? 'All day' : niceStamp(e.start_at),
            e.location ? el('span', {}, e.location) : null),
        ))),
    );
  }

  const tasks = tasksRes.data ?? [];
  const overdue = tasks.filter((x) => x.due_date < t);
  const due = tasks.filter((x) => x.due_date === t);

  if (overdue.length) {
    body.append(
      sectionLabel('Overdue', pill('over', String(overdue.length), false)),
      el('div', { class: 'list' }, ...overdue.map((x) => taskRow(x, reload))),
    );
  }

  body.append(
    sectionLabel('Due today',
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'New task',
        onclick: () => go('#/tasks/new'),
      }, '+')),
    due.length
      ? el('div', { class: 'list' }, ...due.map((x) => taskRow(x, reload)))
      : hint(tasksRes.error ? tasksRes.error.message : 'Nothing due today.'),
  );

  // Routines are last and collapsed to the outstanding ones — once they're
  // all ticked the section disappears, which is the reward.
  const routines = routinesRes.data ?? [];
  const doneToday = new Set((doneRes.data ?? []).map((c) => c.routine_id));
  const outstanding = routines.filter((r) => !doneToday.has(r.id));

  if (routines.length) {
    body.append(
      sectionLabel('Routines',
        pill(outstanding.length ? 'quiet' : 'ok',
          `${routines.length - outstanding.length}/${routines.length}`, false)),
      outstanding.length
        ? el('div', { class: 'list' }, ...outstanding.map((r) => quickRoutine(r, t, reload)))
        : hint('All done today.'),
    );
  }

  mount.lastChild.replaceWith(body);

  function reload() { go('#/today'); }
}

// ─── Focus ───────────────────────────────────────────────────────────────
// daily_focus is keyed by (date, target_type, target_id) and points at a
// project or a content item — it's "the thing today is really about", not a
// free-text note.

function focusBlock(rows, t) {
  const wrap = el('div', {});

  const render = () => {
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
              rows.splice(rows.indexOf(f), 1);
              render();
            },
          }, '×'),
        ));
      }
      wrap.append(list);
      return;
    }

    // Nothing set yet: offer the pickers rather than an empty slot, since
    // setting focus is a morning action and should be one tap away.
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

    wrap.append(
      el('div', { class: 'controls' },
        chips(choices, null, async (val) => {
          const [target_type, target_id] = val.split(':');
          const { error } = await sb.from('daily_focus')
            .insert({ date: t, target_type, target_id });
          if (error) { fail(error); return; }
          rows.push({ date: t, target_type, target_id });
          toast('Focus set');
          render();
        })),
    );
  };

  render();
  return wrap;
}

// ─── Attention items ─────────────────────────────────────────────────────

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
        // Snoozing to tomorrow rather than dismissing: most of these are
        // "not now" rather than "never".
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

// ─── Helpers ─────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Afternoon' : 'Evening';
}
