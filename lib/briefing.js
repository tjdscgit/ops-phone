// Domain cadence and the Today briefing.
//
// A port of the dashboard's `lib/cadence.ts` and `routes/briefing/today`,
// which are the source of truth for the editorial home screen: the "23 days
// since a journal entry" facts, and the anchor line above them.
//
// It runs in the browser rather than on a server because none of it needs a
// secret — it's all reads the signed-in user is already entitled to make.
// Three "latest date" rollups plus a handful of counts, fanned out in one
// parallel batch so Today paints once.
//
// Two deliberate departures from the dashboard, both because the dashboard is
// wrong against this database:
//
//   1. It reads `routines.last_done_date`, a column that does not exist here.
//      Completion lives in `routine_completions`, keyed by date, so that's
//      what this uses. On the dashboard every routine reads as outstanding.
//   2. It anchors the day's event window to `T00:00:00Z` — UTC. Ten hours out
//      in this timezone, so evening events land on the wrong day. This uses
//      local midnight, like the rest of the app.

import { sb, ref } from './db.js';
import { today, ymd } from './ui.js';

const RULES = ['days_since_journal', 'days_since_publish', 'no_activity_days'];

const UNIT = {
  days_since_journal: 'days since a journal entry',
  days_since_publish: 'days since publish',
  no_activity_days: 'days since project activity',
};

const LAST_LABEL = {
  days_since_journal: 'Last entry',
  days_since_publish: 'Last publish',
  no_activity_days: 'Last activity',
};

// The one specific next action a slipping line offers, and where it goes.
function nextActionFor(rule, domainName) {
  switch (rule) {
    case 'days_since_journal':
      return { next: 'Capture a journal entry', href: '#/c/journal/new', label: 'Journal' };
    case 'days_since_publish':
      return { next: `Ship something for ${domainName}`, href: '#/c/content', label: 'Content' };
    default:
      return { next: `Pick up a project in ${domainName}`, href: '#/c/projects', label: 'Projects' };
  }
}

// A domain's cadence rule lives in its failure_patterns jsonb as
// [{ rule, value }]. Only the three "days since X" rules are computable here;
// anything else is left to the observations pass.
function pickRule(patterns) {
  if (!Array.isArray(patterns)) return null;
  for (const p of patterns) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.rule === 'string' && typeof p.value === 'number' && RULES.includes(p.rule)) {
      return { rule: p.rule, cadence: p.value };
    }
  }
  return null;
}

const daysSince = (iso) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

export async function computeCadences() {
  const [domainsRes, journalRes, publishRes, activityRes] = await Promise.all([
    sb.from('stewardship_domains')
      .select('id, name, failure_patterns, last_shipped_at')
      .eq('active', true).eq('is_system', false),
    sb.from('journal_entries').select('entry_date')
      .order('entry_date', { ascending: false }).limit(1),
    sb.from('content_items').select('domain_id, published_at')
      .eq('status', 'published').not('published_at', 'is', null)
      .order('published_at', { ascending: false }),
    // Joined through the project, since activity_log has no domain of its own.
    sb.from('activity_log').select('logged_at, projects(domain_id)')
      .order('logged_at', { ascending: false }).limit(500),
  ]);

  const domains = domainsRes.data ?? [];
  const lastJournal = journalRes.data?.[0]?.entry_date ?? null;

  // Both lists arrive newest-first, so the first hit per domain is the latest.
  const latestPublish = new Map();
  for (const r of publishRes.data ?? []) {
    if (r.domain_id && r.published_at && !latestPublish.has(r.domain_id)) {
      latestPublish.set(r.domain_id, r.published_at);
    }
  }

  const latestActivity = new Map();
  for (const r of activityRes.data ?? []) {
    const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    const did = proj?.domain_id;
    if (did && !latestActivity.has(did)) latestActivity.set(did, r.logged_at);
  }

  const rows = [];
  for (const d of domains) {
    const hit = pickRule(d.failure_patterns);

    // No computable rule: listed, but with no fact and no routing.
    if (!hit) {
      rows.push({
        id: d.id, name: d.name, rule: null, metric: null, cadence: null,
        ratio: 0, status: 'unconfigured', last: null, unit: '', next: '',
        href: `#/c/domains/${d.id}`, label: 'Open folder',
      });
      continue;
    }

    let lastIso = null;
    if (hit.rule === 'days_since_journal') {
      lastIso = lastJournal;
    } else if (hit.rule === 'days_since_publish') {
      // Whichever is more recent: a tracked publish, or the manual "shipped"
      // stamp — so work done off-dashboard still counts toward cadence.
      const c = latestPublish.get(d.id) ?? null;
      const m = d.last_shipped_at ?? null;
      lastIso = (c && m) ? (c > m ? c : m) : (c ?? m);
    } else {
      lastIso = latestActivity.get(d.id) ?? null;
    }

    // Configured but never touched — a "set this up first" case, not slippage.
    if (!lastIso) {
      rows.push({
        id: d.id, name: d.name, rule: hit.rule, metric: null, cadence: hit.cadence,
        ratio: 0, status: 'unconfigured', last: null, unit: UNIT[hit.rule], next: '',
        href: `#/c/domains/${d.id}`, label: 'Open folder',
      });
      continue;
    }

    const metric = daysSince(lastIso);
    const ratio = hit.cadence > 0 ? metric / hit.cadence : 0;
    const { next, href, label } = nextActionFor(hit.rule, d.name);

    rows.push({
      id: d.id, name: d.name, rule: hit.rule, metric, cadence: hit.cadence, ratio,
      // Past the threshold is a slip; three-quarters of the way there is stale.
      status: ratio > 1 ? 'slip' : ratio > 0.7 ? 'stale' : 'ok',
      last: `${LAST_LABEL[hit.rule]} ${String(lastIso).slice(0, 10)}`,
      unit: UNIT[hit.rule],
      next, href, label,
    });
  }

  // Worst first; unconfigured sinks to the bottom.
  rows.sort((a, b) => {
    if (a.status === 'unconfigured' && b.status !== 'unconfigured') return 1;
    if (b.status === 'unconfigured' && a.status !== 'unconfigured') return -1;
    return b.ratio - a.ratio;
  });

  return rows;
}

// Everything the Today screen needs, in one batch.
export async function loadBriefing() {
  const t = today();
  const dayStart = new Date(t + 'T00:00:00').toISOString();
  const dayEnd = new Date(t + 'T23:59:59').toISOString();
  const inboxId = ref.inbox?.id ?? null;

  const [cadences, inboxRes, eventsRes, openRes, routinesRes, doneRes, quoteRes] =
    await Promise.all([
      computeCadences(),
      inboxId
        ? sb.from('tasks').select('id', { count: 'exact', head: true })
            .eq('domain_id', inboxId).eq('status', 'open')
        : Promise.resolve({ count: 0 }),
      sb.from('calendar_events').select('id, start_at, title, all_day, location')
        .gte('start_at', dayStart).lte('start_at', dayEnd)
        .order('start_at', { ascending: true }),
      sb.from('tasks')
        .select('id, title, due_date, due_time, priority, status, domain_id, project_id, waiting_on, completed_at, top3_for_date')
        .eq('status', 'open'),
      sb.from('routines').select('id, name, time_of_day, goal_days')
        .eq('active', true).is('archived_at', null)
        .order('position', { ascending: true, nullsFirst: false }).order('name'),
      sb.from('routine_completions').select('routine_id').eq('completed_date', t),
      sb.from('quotes').select('id, text, source_author, source_reference, source_url')
        .order('created_at', { ascending: false }).limit(1),
    ]);

  const events = eventsRes.data ?? [];
  const openTasks = openRes.data ?? [];

  const overdue = openTasks
    .filter((x) => x.due_date && x.due_date < t)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const top3 = openTasks.filter((x) => x.top3_for_date === t);
  const dueToday = openTasks.filter(
    (x) => x.due_date === t && !top3.some((s) => s.id === x.id));

  // The strip previews what's actually actionable, most urgent first: overdue,
  // then anything pinned for today, then the rest of today's list. Without
  // overdue in there, a day with nothing pinned reads as "nothing to do" while
  // work sits past its deadline.
  const seen = new Set();
  const doingTitles = [];
  for (const x of [...overdue, ...top3, ...dueToday]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    doingTitles.push(x.title);
    if (doingTitles.length >= 3) break;
  }

  const routines = routinesRes.data ?? [];
  const doneIds = new Set((doneRes.data ?? []).map((c) => c.routine_id));
  const remaining = routines.filter((r) => !doneIds.has(r.id));

  const q = quoteRes.data?.[0] ?? null;

  return {
    // Only slipping and stale lines surface. Today leads with what's behind,
    // not with a status board of everything that's fine.
    briefLines: cadences.filter((c) => c.status === 'slip' || c.status === 'stale'),
    cadences,
    inboxCount: inboxRes.count ?? 0,
    events,
    nextEvent: events[0] ?? null,
    tasks: { all: openTasks, overdue, top3, dueToday, doingTitles },
    routines: { all: routines, done: routines.length - remaining.length, remaining },
    latestQuote: q,
  };
}
