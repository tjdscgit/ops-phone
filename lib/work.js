// The Work page's computed manager's map — a port of the dashboard's
// `apps/api/src/lib/work.ts` (Addendum 08 §5-6). One aggregation over
// projects + domains + in-flight content + attention flags, per domain, with
// the contract's ordering. Nothing here is curated; everything is derived.
//
// Runs client-side, like the rest of this app's ports, because none of it
// needs a secret. One departure from the source: "today" is the phone's own
// local calendar date rather than app_settings.timezone, matching the
// precedent set in lib/briefing.js.

import { sb } from './db.js';
import { today } from './ui.js';
import { urgencyFromCounts, parentUrgency, contentUrgency, moveVerb } from './urgency.js';

const IN_FLIGHT_CONTENT = ['outline', 'filming', 'editing', 'derivatives_pending'];
const SHIPPED_CONTENT = ['published', 'done'];

export async function loadWork() {
  const t = today();

  const [domainsRes, projectsRes, tasksRes, contentRes, childRes, attnRes, activityRes, ideasRes] =
    await Promise.all([
      sb.from('stewardship_domains').select('id, name, parked').eq('active', true).eq('is_system', false),
      sb.from('projects')
        .select('id, name, domain_id, engagement_type, target_date, retainer_anchor_day, status, company:companies(name), milestones(weight, status)')
        .in('status', ['active', 'paused']),
      sb.from('tasks').select('id, domain_id, project_id, status, due_date, waiting_since, waiting_on').neq('status', 'done'),
      sb.from('content_items').select('id, title, type, status, holder, holder_since, target_publish_date, domain_id, parent_id')
        .in('status', IN_FLIGHT_CONTENT).is('archived_at', null),
      sb.from('content_items').select('parent_id, type, status').not('parent_id', 'is', null)
        .is('archived_at', null).limit(2000),
      sb.from('attention_items').select('source_type, source_id, urgency').eq('status', 'active'),
      sb.from('activity_log').select('project_id, logged_at').order('logged_at', { ascending: false }).limit(5000),
      sb.from('content_items').select('id', { count: 'exact', head: true }).eq('status', 'idea').is('archived_at', null),
    ]);

  for (const r of [domainsRes, projectsRes, tasksRes, contentRes, childRes, attnRes, activityRes, ideasRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const domains = domainsRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const content = contentRes.data ?? [];

  const flaggedProjects = new Set();
  const flaggedDomains = new Set();
  const flaggedContent = new Set();
  // Highest attention urgency per domain-scoped item — floors the domain
  // pill so it can never read calmer than an active domain attention item.
  const domainAttnUrgency = new Map();
  for (const a of attnRes.data ?? []) {
    if (a.source_type === 'project') flaggedProjects.add(a.source_id);
    else if (a.source_type === 'domain') {
      flaggedDomains.add(a.source_id);
      const floor = a.urgency === 'high' ? 'over' : 'due';
      if (domainAttnUrgency.get(a.source_id) !== 'over') domainAttnUrgency.set(a.source_id, floor);
    } else if (a.source_type === 'content') flaggedContent.add(a.source_id);
  }

  // Flagged content can be in any status — resolve each to its domain for
  // the rollup badge.
  const flaggedContentByDomain = new Map();
  if (flaggedContent.size > 0) {
    const { data: fcData, error: fcErr } = await sb
      .from('content_items').select('id, domain_id').in('id', [...flaggedContent]);
    if (fcErr) throw new Error(fcErr.message);
    for (const c of fcData ?? []) {
      if (c.domain_id) flaggedContentByDomain.set(c.domain_id, (flaggedContentByDomain.get(c.domain_id) ?? 0) + 1);
    }
  }

  const latestActivity = new Map();
  for (const a of activityRes.data ?? []) {
    if (a.project_id && !latestActivity.has(a.project_id)) latestActivity.set(a.project_id, a.logged_at);
  }

  // Unpublished short-clip child counts per parent (for the harvest verb).
  const unpublishedShorts = new Map();
  for (const c of childRes.data ?? []) {
    if (c.type !== 'short_clip' || SHIPPED_CONTENT.includes(c.status)) continue;
    unpublishedShorts.set(c.parent_id, (unpublishedShorts.get(c.parent_id) ?? 0) + 1);
  }

  const projectsByDomain = groupBy(projects, (p) => p.domain_id ?? '');
  const contentByDomain = groupBy(content, (c) => c.domain_id ?? '');
  const tasksByDomain = groupBy(tasks, (t) => t.domain_id);

  const build = (d) => {
    const domTasks = tasksByDomain.get(d.id) ?? [];
    const tasksByProject = groupBy(domTasks, (t) => t.project_id ?? '__direct__');

    const projectCards = (projectsByDomain.get(d.id) ?? []).map((p) => {
      const pt = tasksByProject.get(p.id) ?? [];
      const counts = bucketTasks(pt, t);
      const rep = representativeWaiting(pt, t);
      const isRetainer = p.engagement_type === 'retainer';
      return {
        id: p.id,
        kind: isRetainer ? 'retainer' : 'target',
        name: p.name,
        client: p.company?.name ?? null,
        target: isRetainer ? null : p.target_date,
        cycle: isRetainer && p.retainer_anchor_day ? computeCycle(p.retainer_anchor_day, t) : null,
        pct: isRetainer ? null : progressPct(p.milestones ?? []),
        open: counts.open,
        overdue: counts.overdue,
        waiting: counts.waiting,
        waitOn: rep?.waiting_on ?? null,
        waitDays: rep?.days ?? null,
        recency: recencyLabel(latestActivity.get(p.id), t),
        flagged: flaggedProjects.has(p.id),
        paused: p.status === 'paused',
        urgency: urgencyFromCounts({
          overdue: counts.overdue,
          dueToday: counts.today,
          open: counts.open,
          waiting: counts.waiting,
          targetNear: !isRetainer && p.target_date != null && daysBetween(t, p.target_date) <= 7,
        }),
      };
    });
    // Flagged first, then target proximity (soonest first, undated last).
    projectCards.sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      const at = a.target ?? '9999-12-31';
      const bt = b.target ?? '9999-12-31';
      return at.localeCompare(bt) || a.name.localeCompare(b.name);
    });

    const contentRows = (contentByDomain.get(d.id) ?? []).map((c) => {
      const holder = c.holder === 'editor' ? 'editor' : 'me';
      const myMoveDue = holder === 'me' && c.target_publish_date != null &&
        daysBetween(t, c.target_publish_date) <= 7;
      const days = c.holder_since ? daysBetween(c.holder_since.slice(0, 10), t) : null;
      return {
        id: c.id,
        title: c.title,
        type: c.type,
        status: c.status,
        holder,
        days,
        move: holder === 'me' ? moveVerb(c.status, c.type, unpublishedShorts.get(c.id) ?? 0) : null,
        target: c.target_publish_date,
        myMoveDue,
        flagged: flaggedContent.has(c.id),
        urgency: contentUrgency({ holder, target: c.target_publish_date, myMoveDue, days, today: t }),
      };
    });

    const directTasks = tasksByProject.get('__direct__') ?? [];
    const dc = bucketTasks(directTasks, t);
    const direct = { open: dc.open, overdue: dc.overdue, waiting: dc.waiting, waitingAging: dc.waitingAging, today: dc.today };

    const all = bucketTasks(domTasks, t);
    const flaggedCount =
      (flaggedDomains.has(d.id) ? 1 : 0) +
      projectCards.filter((p) => p.flagged).length +
      (flaggedContentByDomain.get(d.id) ?? 0);
    const rollup = { attention: flaggedCount, open: all.open, overdue: all.overdue, waiting: all.waiting };

    const domainAttnFloor = domainAttnUrgency.get(d.id);
    const urgency = parentUrgency(
      { overdue: all.overdue, dueToday: all.today, open: all.open, waiting: all.waiting },
      [
        ...projectCards.map((p) => p.urgency),
        ...contentRows.map((c) => c.urgency),
        ...(domainAttnFloor ? [domainAttnFloor] : []),
      ],
    );

    return { id: d.id, name: d.name, parked: d.parked, urgency, rollup, projects: projectCards, content: contentRows, direct };
  };

  const active = domains.filter((d) => !d.parked).map(build);
  const parked = domains.filter((d) => d.parked).map(build);

  const workVolume = (w) => w.rollup.open + w.rollup.waiting + w.projects.length + w.content.length;
  active.sort((a, b) => {
    if ((a.rollup.attention > 0) !== (b.rollup.attention > 0)) return a.rollup.attention > 0 ? -1 : 1;
    return workVolume(b) - workVolume(a) || a.name.localeCompare(b.name);
  });
  parked.sort((a, b) => a.name.localeCompare(b.name));

  return { domains: active, parked, ideasCount: ideasRes.count ?? 0 };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function groupBy(arr, key) {
  const m = new Map();
  for (const item of arr) {
    const k = key(item);
    const g = m.get(k);
    if (g) g.push(item);
    else m.set(k, [item]);
  }
  return m;
}

function bucketTasks(ts, t) {
  let open = 0, overdue = 0, waiting = 0, waitingAging = 0, todayCount = 0;
  for (const x of ts) {
    if (x.status === 'waiting') {
      waiting++;
      if (x.waiting_since && daysBetween(x.waiting_since.slice(0, 10), t) >= 7) waitingAging++;
      continue;
    }
    if (x.status === 'open') {
      open++;
      if (x.due_date && x.due_date < t) overdue++;
      if (x.due_date === t) todayCount++;
    }
  }
  return { open, overdue, waiting, waitingAging, today: todayCount };
}

function representativeWaiting(ts, t) {
  let best = null;
  for (const x of ts) {
    if (x.status !== 'waiting') continue;
    const days = x.waiting_since ? daysBetween(x.waiting_since.slice(0, 10), t) : 0;
    if (!best || days > best.days) best = { waiting_on: x.waiting_on, days };
  }
  return best;
}

function progressPct(milestones) {
  const total = milestones.reduce((s, m) => s + m.weight, 0);
  if (total === 0) return null;
  const done = milestones.filter((m) => m.status === 'done').reduce((s, m) => s + m.weight, 0);
  return Math.round((done / total) * 100);
}

function daysBetween(fromYmd, toYmd) {
  const [ay, am, ad] = fromYmd.split('-').map((s) => parseInt(s, 10));
  const [by, bm, bd] = toYmd.split('-').map((s) => parseInt(s, 10));
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function recencyLabel(latestIso, t) {
  if (!latestIso) return 'no activity yet';
  const days = daysBetween(latestIso.slice(0, 10), t);
  if (days <= 0) return 'active today';
  if (days <= 3) return `active ${days}d ago`;
  return `quiet ${days}d`;
}

// Retainer cycle position. Day-of-month anchor, clamped to month end.
function computeCycle(anchorDay, todayYmd) {
  const [y, m, d] = todayYmd.split('-').map((s) => parseInt(s, 10));
  const daysInMonth = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const clamp = (yy, mm) => Math.min(anchorDay, daysInMonth(yy, mm));

  const todayUtc = Date.UTC(y, m - 1, d);
  const thisAnchor = Date.UTC(y, m - 1, clamp(y, m));

  let csY, csM;
  if (thisAnchor <= todayUtc) { csY = y; csM = m; }
  else if (m === 1) { csY = y - 1; csM = 12; }
  else { csY = y; csM = m - 1; }
  const cycleStart = Date.UTC(csY, csM - 1, clamp(csY, csM));

  const nY = csM === 12 ? csY + 1 : csY;
  const nM = csM === 12 ? 1 : csM + 1;
  const nextAnchor = Date.UTC(nY, nM - 1, clamp(nY, nM));

  const length = Math.round((nextAnchor - cycleStart) / 86_400_000);
  const day = Math.round((todayUtc - cycleStart) / 86_400_000) + 1;
  return { day, length };
}
