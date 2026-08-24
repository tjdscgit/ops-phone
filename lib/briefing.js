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

import { sb, ref, refName } from './db.js';
import { today } from './ui.js';

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

// ─── Resurfacing ─────────────────────────────────────────────────────────
// A client-side port of apps/api/src/routes/library.ts's GET
// /api/library/resurfacing: a weighted, date-seeded pick from quotes +
// journal entries so the same item shows all day and a different one
// rotates in tomorrow. The server version excludes ids from a same-day
// httpOnly cookie ("Next" button); there's no server here, so the skip set
// lives in localStorage instead, cleared whenever the date rolls over.

function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  // Murmur3 finalizer — avalanche so a 1-byte input diff scrambles the whole
  // hash. Without this, consecutive dates hash to nearly the same value and
  // the pick barely rotates.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = h ^ (h >>> 16);
  return Math.abs(h);
}

const RESURFACE_SKIP_KEY = 'ops-resurface-skip';

function getResurfaceSkip(t) {
  try {
    const raw = JSON.parse(localStorage.getItem(RESURFACE_SKIP_KEY) ?? 'null');
    return raw?.date === t && Array.isArray(raw.ids) ? raw.ids : [];
  } catch { return []; }
}

export function skipResurfaceItem(t, id) {
  const ids = getResurfaceSkip(t);
  if (!ids.includes(id)) ids.push(id);
  try { localStorage.setItem(RESURFACE_SKIP_KEY, JSON.stringify({ date: t, ids })); } catch { /* private mode */ }
}

export function resetResurfaceSkip() {
  try { localStorage.removeItem(RESURFACE_SKIP_KEY); } catch { /* private mode */ }
}

async function loadResurfacing(t) {
  const skipIds = new Set(getResurfaceSkip(t));

  const [quotesRes, journalRes] = await Promise.all([
    sb.from('quotes').select('id, text, source_author, resurface_weight, book:books(title, author)').gt('resurface_weight', 0),
    sb.from('journal_entries').select('id, transcription_text, entry_date, resurface_weight').gt('resurface_weight', 0),
  ]);

  const pool = [];
  for (const q of quotesRes.data ?? []) {
    const book = Array.isArray(q.book) ? q.book[0] : q.book;
    const sourceBits = [book?.title, book?.author ?? q.source_author].filter(Boolean);
    pool.push({
      kind: 'quote', id: q.id, weight: Number(q.resurface_weight ?? 1),
      excerpt: String(q.text ?? ''), source: sourceBits.length ? sourceBits.join(' · ') : null,
      href: `#/c/quotes/${q.id}`,
    });
  }
  for (const j of journalRes.data ?? []) {
    pool.push({
      kind: 'journal', id: j.id, weight: Number(j.resurface_weight ?? 1),
      excerpt: String(j.transcription_text ?? ''), source: j.entry_date ?? null,
      href: `#/c/journal/${j.id}`,
    });
  }

  if (pool.length === 0) return { item: null, exhausted: false };

  const originalPoolSize = pool.length;
  const filtered = skipIds.size ? pool.filter((p) => !skipIds.has(p.id)) : pool;
  if (filtered.length === 0) return { item: null, exhausted: true, poolSize: originalPoolSize };

  const seed = simpleHash(t);
  const totalWeight = filtered.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return { item: null, exhausted: false };
  const pickAt = ((seed % 1_000_000) / 1_000_000) * totalWeight;
  let acc = 0;
  let chosen = filtered[0];
  for (const item of filtered) {
    acc += item.weight;
    if (acc >= pickAt) { chosen = item; break; }
  }

  const MAX = 240;
  let excerpt = chosen.excerpt.trim();
  if (excerpt.length > MAX) {
    const cut = excerpt.slice(0, MAX);
    const lastSpace = cut.lastIndexOf(' ');
    excerpt = (lastSpace > 100 ? cut.slice(0, lastSpace) : cut) + '…';
  }

  return { item: { ...chosen, excerpt }, exhausted: false, poolSize: originalPoolSize, skipped: skipIds.size };
}

// Everything the Today screen needs, in one batch — a client-side port of
// apps/web's Today page.tsx server component: masthead pills, Focus,
// anchor line, Inbox triage, brief lines (cadence), Silent clients,
// Attention, Reflection (resurfacing), Latest quote, Today's events, Doing
// (top3 + overdue + due today), Routines.
export async function loadBriefing() {
  const t = today();
  const dayStart = new Date(t + 'T00:00:00').toISOString();
  const dayEnd = new Date(t + 'T23:59:59').toISOString();
  const inboxId = ref.inbox?.id ?? null;

  const [
    cadences, inboxRes, eventsRes, openRes, waitingRes, routinesRes, doneRes,
    quoteRes, resurfacing, attnRes, focusRes, unreadRes,
  ] = await Promise.all([
    computeCadences(),
    inboxId
      ? sb.from('tasks').select('id', { count: 'exact', head: true }).eq('domain_id', inboxId).eq('status', 'open')
      : Promise.resolve({ count: 0 }),
    sb.from('calendar_events').select('id, start_at, title, all_day, location')
      .gte('start_at', dayStart).lte('start_at', dayEnd).order('start_at', { ascending: true }),
    sb.from('tasks')
      .select('id, title, due_date, due_time, priority, status, domain_id, project_id, waiting_on, completed_at, top3_for_date, created_at')
      .eq('status', 'open'),
    sb.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
    sb.from('routines').select('id, name, time_of_day, goal_days')
      .eq('active', true).is('archived_at', null)
      .order('position', { ascending: true, nullsFirst: false }).order('name'),
    sb.from('routine_completions').select('routine_id').eq('completed_date', t),
    sb.from('quotes').select('id, text, source_author, source_reference, source_url')
      .order('created_at', { ascending: false }).limit(1),
    loadResurfacing(t),
    sb.from('attention_items').select('*').eq('status', 'active').order('score', { ascending: false, nullsFirst: false }),
    sb.from('daily_focus').select('*').eq('date', t).limit(1),
    sb.from('notifications').select('id', { count: 'exact', head: true }).eq('status', 'unread'),
  ]);

  const events = eventsRes.data ?? [];
  const openTasks = openRes.data ?? [];

  // Right-rail actionable tasks: Top 3 first, then overdue, then due today —
  // each bucket excludes ids already claimed by an earlier one.
  const top3 = openTasks.filter((x) => x.top3_for_date === t)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const top3Ids = new Set(top3.map((x) => x.id));
  const overdue = openTasks
    .filter((x) => !top3Ids.has(x.id) && x.due_date && x.due_date < t)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const dueToday = openTasks
    .filter((x) => !top3Ids.has(x.id) && x.due_date === t)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  // Masthead pill counts everything overdue, top3-pinned or not — the rail
  // list above excludes top3 items only to avoid showing a task twice.
  const allOverdueCount = openTasks.filter((x) => x.due_date && x.due_date < t).length;
  const RAIL_CAP = 10;
  const railTasksAll = [...top3, ...overdue, ...dueToday];
  const railTasks = railTasksAll.slice(0, RAIL_CAP);
  const railOverflow = Math.max(0, railTasksAll.length - RAIL_CAP);

  const routines = routinesRes.data ?? [];
  const doneIds = new Set((doneRes.data ?? []).map((c) => c.routine_id));
  const remaining = routines.filter((r) => !doneIds.has(r.id));

  const q = quoteRes.data?.[0] ?? null;

  // Silent clients (company_silent) get pulled out of the general Attention
  // list so they're never shown twice, matching page.tsx.
  const active = attnRes.data ?? [];
  const silentClients = active.filter((i) => i.rule_type === 'company_silent').slice(0, 6);
  const attentionItems = active
    .filter((i) => i.rule_type !== 'company_silent')
    .filter((i) => i.urgency === 'high' || i.urgency === 'normal')
    .slice(0, 5);

  const focusRow = focusRes.data?.[0] ?? null;
  const focus = focusRow
    ? {
        href: focusRow.target_type === 'project' ? `#/c/projects/${focusRow.target_id}` : `#/c/content/${focusRow.target_id}`,
        title: focusRow.target_type === 'project' ? refName('project', focusRow.target_id) : refName('contentItem', focusRow.target_id),
        note: focusRow.note ?? null,
      }
    : null;

  return {
    // Only slipping and stale lines surface. Today leads with what's behind,
    // not with a status board of everything that's fine.
    briefLines: cadences.filter((c) => c.status === 'slip' || c.status === 'stale'),
    cadences,
    inboxCount: inboxRes.count ?? 0,
    events,
    nextEvent: events[0] ?? null,
    tasks: {
      all: openTasks, overdue, top3, dueToday,
      openCount: openTasks.length, overdueCount: allOverdueCount,
      waitingCount: waitingRes.count ?? 0,
      railTasks, railOverflow,
    },
    routines: { all: routines, done: routines.length - remaining.length, remaining },
    latestQuote: q,
    resurfacing,
    attentionItems, silentClients, attentionActiveCount: active.length,
    focus,
    unreadCount: unreadRes.count ?? 0,
  };
}
