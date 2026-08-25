// Boot, auth, routing and the app shell.

import { sb, loadRef } from './lib/db.js';
import {
  $, el, panel, hint, svg, toast, fail, screenHead,
  currentTheme, setTheme, humanise,
} from './lib/ui.js';
import { route, startRouter, go, currentPath } from './lib/router.js';
import { listView, formView } from './lib/engine.js';
import { byKey, GROUPS } from './schema.js';
import { todayView } from './views/today.js';
import { workView } from './views/work.js';
import { tasksList, taskForm } from './views/tasks.js';
import { routinesList, routineForm } from './views/routines.js';
import { captureView } from './views/capture.js';
import { groupView } from './views/group.js';
import { enablePush, pushStatus } from './views/push.js';
import { attentionView } from './views/attention.js';
import { notificationsView } from './views/notifications.js';
import { searchView } from './views/search.js';
import { contentList, contentNew, contentDetail } from './views/content.js';
import { peopleList, personNew, personDetail } from './views/people.js';
import { companiesList, companyNew, companyDetail } from './views/companies.js';

// ─── Routes ──────────────────────────────────────────────────────────────

route('/today', todayView);
route('/work', workView);
route('/capture', captureView);
route('/settings', settingsView);
route('/attention', attentionView);
route('/notifications', notificationsView);
route('/search', searchView);

route('/tasks', tasksList);
route('/tasks/:id', taskForm);

route('/routines', routinesList);
route('/routines/:id', routineForm);

// Content / People / Companies are real ports (facet rail, card grid, detail
// shell), not the generic descriptor-driven list/form — so they're routed
// explicitly here, ahead of the '/c/:key' catch-all below which would
// otherwise match these same paths first-come.
route('/c/content', contentList);
route('/c/content/new', contentNew);
route('/c/content/:id', contentDetail);
route('/c/people', peopleList);
route('/c/people/new', personNew);
route('/c/people/:id', personDetail);
route('/c/companies', companiesList);
route('/c/companies/new', companyNew);
route('/c/companies/:id', companyDetail);

// Area index screens behind the Work / People / Library tabs.
route('/g/:label', groupView);

// Descriptor-driven areas. `/c/` keeps them in one namespace so a new one in
// schema.js is routable without touching this file.
route('/c/:key', async (mount, { key }) => {
  const desc = byKey(key);
  if (!desc) return go('#/today');
  await listView(mount, desc, { backTo: backForKey(key) });
});

route('/c/:key/:id', async (mount, { key, id }) => {
  const desc = byKey(key);
  if (!desc) return go('#/today');
  await formView(mount, desc, id, { backTo: `#/c/${key}` });
});

// A child row of a parent row, e.g. a milestone inside a project.
route('/c/:key/:parentId/:childKey/:childId', async (mount, { key, parentId, childKey, childId }) => {
  const parent = byKey(key);
  const child = parent?.children?.find((c) => c.key === childKey);
  if (!child) return go('#/today');
  await formView(mount, child, childId, {
    parentId,
    fk: child.fk,
    backTo: `#/c/${key}/${parentId}`,
  });
});

// Back out of a list to the area it belongs to, not to a generic menu.
function backForKey(key) {
  const g = GROUPS.find((x) => x.keys.includes(key));
  if (!g) return '#/today';
  // Content and People are tabs in their own right, so their lists are a
  // top-level destination with nothing to go back to.
  if (key === 'content' || key === 'people') return null;
  return `#/g/${g.label.toLowerCase()}`;
}

// ─── Bottom navigation ───────────────────────────────────────────────────
// Five tabs plus More, mirroring the dashboard's mobile shell. Capture is not
// a tab — it's the floating button, because it's an action available from
// anywhere rather than a place you go.

// Copied verbatim from apps/web/src/components/Icon.tsx's ICONS map so the
// phone and dashboard use the same glyphs, not lookalikes.
const ICONS = {
  today: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  work: '<rect x="3" y="5" width="13" height="3" rx=".5"/><rect x="7" y="10.5" width="14" height="3" rx=".5"/><rect x="5" y="16" width="11" height="3" rx=".5"/>',
  tasks: '<rect x="3.5" y="4.5" width="6" height="6" rx=".5"/><path d="M5.2 7.4l1.3 1.3 2.3-2.6"/><rect x="3.5" y="13.5" width="6" height="6" rx=".5"/><path d="M13 7.5h7.5M13 16.5h7.5"/>',
  content: '<rect x="3.5" y="4" width="5" height="16" rx=".5"/><rect x="9.5" y="4" width="5" height="11" rx=".5"/><rect x="15.5" y="4" width="5" height="14" rx=".5"/>',
  people: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6"/>',
  companies: '<rect x="3.5" y="4" width="7.5" height="16" rx=".5"/><rect x="13.5" y="9.5" width="7" height="10.5" rx=".5"/><path d="M6.2 8h2.2M6.2 12h2.2M16.2 13.5h1.8"/>',
  library: '<path d="M4 4.5v15l3 .5V5.5z"/><path d="M10 4.5v15l3 .5V5.5z"/><path d="M16.2 5.8l3 14.7 1.5-.4-3-14.7z"/>',
  routines: '<path d="M4.5 9.5a7.5 7.5 0 0113-4.2M19.5 14.5a7.5 7.5 0 01-13 4.2"/><path d="M4.5 5.5v4h4M19.5 18.5v-4h-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.2 16.2L21 21"/>',
  capture: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M12 4a5.5 5.5 0 00-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0012 4zM10.2 18.5a2 2 0 003.6 0"/>',
  flag: '<path d="M6 21V4.5M6 4.5h11l-2 3.5 2 3.5H6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5l1.7 1-2 3.4-1.9-.7a7.6 7.6 0 01-1.7 1l-.3 2h-4l-.3-2a7.6 7.6 0 01-1.7-1l-1.9.7-2-3.4 1.7-1a7 7 0 010-2l-1.7-1 2-3.4 1.9.7a7.6 7.6 0 011.7-1l.3-2h4l.3 2c.6.25 1.2.58 1.7 1l1.9-.7 2 3.4-1.7 1a7 7 0 010 2z"/>',
  pin: '<path d="M15 3.5l5.5 5.5-2.2 2.2-1-.4-3.6 3.6.5 3.6-1.6 1.6-3.4-3.4L5 21l-.5-.5 4.8-4.2-3.4-3.4L7.5 11l3.6.5 3.6-3.6-.4-1z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
};

const TABS = [
  { href: '#/today', label: 'Today', icon: 'today' },
  { href: '#/work', label: 'Work', icon: 'work' },
  { href: '#/c/content', label: 'Content', icon: 'content' },
  { href: '#/c/people', label: 'People', icon: 'people' },
  { href: '#/g/library', label: 'Library', icon: 'library' },
];

// Every route that isn't one of the five tabs lives behind More, so More
// highlights on Tasks, Routines, Notes, Settings and the rest.
const MORE_ITEMS = [
  { href: '#/tasks', label: 'Tasks', glyph: '☰' },
  { href: '#/routines', label: 'Routines', glyph: '↻' },
  { href: '#/c/notes', label: 'Notes', glyph: '✎' },
  { href: '#/c/captured', label: 'Inbox', glyph: '⬚' },
  { href: '#/c/calendar', label: 'Calendar', glyph: '▤' },
  { href: '#/c/companies', label: 'Companies', glyph: '⌂' },
  { href: '#/c/observations', label: 'Observations', glyph: '◎' },
  { href: '#/g/health', label: 'Health', glyph: '♡' },
  { href: '#/c/domains', label: 'Folders', glyph: '▣' },
  { href: '#/settings', label: 'Settings', glyph: '⚙' },
];

function buildNav() {
  $('nav').replaceChildren(
    ...TABS.map((t) => {
      const b = el('button', {
        class: 'tab', type: 'button', 'data-href': t.href,
        onclick: () => go(t.href),
      });
      b.append(svg(ICONS[t.icon]), el('span', {}, t.label));
      return b;
    }),
    (() => {
      const b = el('button', {
        class: 'tab', type: 'button', 'data-more': 'true',
        'aria-haspopup': 'dialog',
        onclick: openMoreSheet,
      });
      b.append(svg(ICONS.more), el('span', {}, 'More'));
      return b;
    })(),
  );
}

// ─── Desktop rail ────────────────────────────────────────────────────────
// A port of apps/web's IconRail (design handoff, Jul 2026): the same nav set
// in the same order, collapsed to 64px and expanding to 236px on hover or
// pin — not the phone's own five-tab-plus-More shell, which stays for the
// narrow width where this rail doesn't fit.

const RAIL_NAV = [
  { href: '#/today', label: 'Today', icon: 'today' },
  { href: '#/work', label: 'Work', icon: 'work' },
  { href: '#/tasks', label: 'Tasks', icon: 'tasks' },
  { href: '#/c/content', label: 'Content', icon: 'content' },
  { href: '#/c/people', label: 'People', icon: 'people' },
  { href: '#/c/companies', label: 'Companies', icon: 'companies' },
  { href: '#/g/library', label: 'Library', icon: 'library' },
  { href: '#/routines', label: 'Routines', icon: 'routines' },
];

let railPinned = false;
let badgeCounts = { attention: 0, notifications: 0 };

async function loadBadgeCounts() {
  const [a, n] = await Promise.all([
    sb.from('attention_items').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('notifications').select('id', { count: 'exact', head: true }).eq('status', 'unread'),
  ]);
  badgeCounts = { attention: a.count ?? 0, notifications: n.count ?? 0 };
}

function buildRail() {
  try { railPinned = localStorage.getItem('ops-rail-pin') === '1'; } catch { /* private mode */ }

  const item = ({ href, label, icon, onClick, badge, badgeAccent, iconStyle }) => {
    const b = el('button', {
      class: 'rail-item', type: 'button',
      'data-href': href || null,
      onclick: onClick || (() => go(href)),
      title: label,
    });
    const g = el('span', { class: 'glyph' });
    g.append(svg(ICONS[icon], 20));
    if (iconStyle) g.firstChild.setAttribute('style', iconStyle);
    if (badge) g.append(el('span', { class: `rail-dot ${badgeAccent ? 'accent' : ''}` }));
    b.append(g, el('span', { class: 'label' }, label));
    if (badge) b.append(el('span', { class: `rail-badge ${badgeAccent ? 'accent' : ''}` }, badge));
    return b;
  };

  const togglePin = () => {
    railPinned = !railPinned;
    try { localStorage.setItem('ops-rail-pin', railPinned ? '1' : '0'); } catch { /* private mode */ }
    buildRail();
  };

  const attnBadge = badgeCounts.attention > 0 ? (badgeCounts.attention > 99 ? '99+' : String(badgeCounts.attention)) : null;
  const notifBadge = badgeCounts.notifications > 0 ? (badgeCounts.notifications > 99 ? '99+' : String(badgeCounts.notifications)) : null;

  const rail = $('rail');
  rail.classList.toggle('pinned', railPinned);
  document.documentElement.style.setProperty('--rail-slot', railPinned ? 'var(--rail-open)' : 'var(--rail)');

  rail.replaceChildren(
    el('div', { class: 'rail-head' },
      el('div', { class: 'rail-mark' }, 'R'),
      el('div', { class: 'rail-name' },
        el('b', {}, 'Roseberry'),
        el('span', {}, 'Ops'),
      ),
    ),
    el('div', { class: 'rail-items' },
      ...RAIL_NAV.map((t) => item({ href: t.href, label: t.label, icon: t.icon })),
    ),
    el('div', { class: 'rail-foot' },
      item({ label: 'Capture', icon: 'capture', onClick: () => go('#/capture') }),
      item({ href: '#/search', label: 'Search', icon: 'search' }),
      item({ href: '#/attention', label: 'Attention', icon: 'flag', badge: attnBadge }),
      item({ href: '#/notifications', label: 'Notifications', icon: 'bell', badge: notifBadge, badgeAccent: true }),
      item({ href: '#/settings', label: 'Settings', icon: 'gear' }),
      item({
        label: railPinned ? 'Unpin nav' : 'Keep open', icon: 'pin', onClick: togglePin,
        iconStyle: railPinned ? '' : 'transform:rotate(-40deg);opacity:.7',
      }),
      el('div', { class: 'rail-account' },
        el('span', { class: 'eyebrow', id: 'railEmail' }, ''),
        el('button', {
          class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.08em; text-decoration:none',
          onclick: async () => { await sb.auth.signOut(); location.reload(); },
        }, 'Sign out'),
      ),
    ),
  );

  sb.auth.getSession().then(({ data: { session } }) => {
    const slot = $('railEmail');
    if (slot && session?.user?.email) slot.textContent = session.user.email;
  });

  markActive(currentPath());
}

// `[` pins/unpins the rail, unless focus is in an editable field.
window.addEventListener('keydown', (e) => {
  if (e.key !== '[') return;
  const t = e.target;
  const editable = t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable);
  if (editable) return;
  const rail = $('rail');
  if (rail.classList.contains('hidden')) return;
  railPinned = !railPinned;
  try { localStorage.setItem('ops-rail-pin', railPinned ? '1' : '0'); } catch { /* private mode */ }
  buildRail();
});

// First path segment → breadcrumb label + subtitle. Ported from Topbar.tsx's
// CRUMBS map, with routes renamed to match this app's hash paths.
const CRUMBS = {
  today: { label: 'Today', sub: 'Briefing' },
  work: { label: 'Work', sub: 'Manager’s map' },
  tasks: { label: 'Tasks', sub: 'Everything open' },
  c: { label: 'Browse' }, // overwritten below once the :key segment is known
  routines: { label: 'Routines', sub: 'Daily habits' },
  attention: { label: 'Attention' },
  notifications: { label: 'Notifications' },
  settings: { label: 'Settings' },
  search: { label: 'Search' },
  capture: { label: 'Capture' },
};
const CRUMB_BY_KEY = {
  content: { label: 'Content', sub: 'Pipeline' },
  people: { label: 'People', sub: 'Relationships' },
  companies: { label: 'Companies', sub: 'CRM' },
};

function updateTopbar(path) {
  const bar = $('topbar');
  if (!bar || bar.classList.contains('hidden')) return;

  const [seg, key] = path.split('/').filter(Boolean);
  const crumb = (seg === 'c' && CRUMB_BY_KEY[key])
    || CRUMBS[seg]
    || { label: (seg || 'today').charAt(0).toUpperCase() + (seg || 'today').slice(1) };

  bar.querySelector('.topbar-crumb').replaceChildren(
    el('span', {}, crumb.label),
    crumb.sub ? el('span', { class: 'dim' }, ' / ') : null,
    crumb.sub ? el('span', { class: 'dim' }, crumb.sub) : null,
  );
}

function markActive(path) {
  updateTopbar(path);

  const matches = (href) => {
    const base = href.slice(1);
    return path === base || path.startsWith(base + '/');
  };

  let anyTab = false;
  for (const b of document.querySelectorAll('.tab[data-href]')) {
    const active = matches(b.dataset.href);
    if (active) anyTab = true;
    b.setAttribute('aria-current', String(active));
  }
  // On the phone, anything not on a tab belongs to More.
  const more = document.querySelector('.tab[data-more]');
  if (more) more.setAttribute('aria-current', String(!anyTab));

  // The rail lists every destination, so it needs no catch-all. Longest match
  // wins, otherwise '#/c/people' would also light up under a '#/c' prefix.
  let best = null;
  for (const b of document.querySelectorAll('.rail-item[data-href]')) {
    b.setAttribute('aria-current', 'false');
    if (matches(b.dataset.href) &&
        (!best || b.dataset.href.length > best.dataset.href.length)) best = b;
  }
  if (best) best.setAttribute('aria-current', 'true');
}

// ─── Bottom sheet ────────────────────────────────────────────────────────
// One #sheet/#sheetScrim pair, reused by the More menu and by any screen's
// mobile Filters (the phone counterpart of the dashboard's FacetRail, which
// renders the same facet groups in a desktop sidebar and a mobile sheet).
// Exported so a view (e.g. Work) can open it with its own content.

export function openSheet(content) {
  const sheet = $('sheet');
  const scrim = $('sheetScrim');

  sheet.replaceChildren(el('div', { class: 'sheet-grip' }), content);

  scrim.classList.remove('hidden');
  sheet.classList.remove('hidden');
  // Force a reflow so the browser commits the off-screen start state before
  // `.show` moves it — a rAF would do the same but never fires in a
  // background tab, which would leave the sheet rendered but stuck off-screen.
  void sheet.offsetHeight;
  scrim.classList.add('show');
  sheet.classList.add('show');

  scrim.onclick = closeSheet;
}

export function closeSheet() {
  const sheet = $('sheet');
  const scrim = $('sheetScrim');
  sheet.classList.remove('show');
  scrim.classList.remove('show');
  setTimeout(() => {
    sheet.classList.add('hidden');
    scrim.classList.add('hidden');
  }, 220);
}

function openMoreSheet() {
  openSheet(el('div', {},
    el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'More')),
    el('div', {}, ...MORE_ITEMS.map((it) =>
      el('button', {
        class: 'sheet-item', type: 'button',
        onclick: () => { closeSheet(); go(it.href); },
      },
        el('span', { class: 'glyph' }, it.glyph),
        el('span', { style: 'flex:1' }, it.label),
      ))),
    el('div', { class: 'sheet-foot' },
      el('span', { class: 'eyebrow', id: 'sheetEmail' }, ''),
      el('button', {
        class: 'ghost small',
        onclick: async () => { await sb.auth.signOut(); location.reload(); },
      }, 'Sign out'),
    ),
  ));

  sb.auth.getSession().then(({ data: { session } }) => {
    const slot = $('sheetEmail');
    if (slot && session?.user?.email) slot.textContent = session.user.email;
  });
}

// Back should dismiss the sheet rather than leave the screen.
window.addEventListener('hashchange', () => {
  if (!$('sheet').classList.contains('hidden')) closeSheet();
});

// ─── Settings ────────────────────────────────────────────────────────────

async function settingsView(mount) {
  const themeBtn = el('button', { class: 'ghost', onclick: toggleTheme },
    currentTheme() === 'dark' ? 'Switch to light' : 'Switch to dark');

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    themeBtn.textContent = next === 'dark' ? 'Switch to light' : 'Switch to dark';
  }

  const status = hint('');
  const pushBtn = el('button', { class: 'ghost', onclick: async () => {
    await enablePush();
    status.textContent = await pushStatus();
  } }, 'Enable notifications');

  pushStatus().then((s) => { status.textContent = s; });

  mount.replaceChildren(
    screenHead('Setup', 'Settings'),
    el('div', { class: 'section-label' }, el('div', { class: 'eyebrow' }, 'Appearance')),
    el('div', { class: 'form-actions' }, themeBtn),
    el('div', { class: 'section-label' }, el('div', { class: 'eyebrow' }, 'Notifications')),
    el('div', { class: 'form-actions' }, pushBtn),
    status,
    hint('Reminders only fire for tasks that have a due time and at least one reminder set.'),
  );
}

// ─── Auth ────────────────────────────────────────────────────────────────

function signInScreen() {
  const email = el('input', {
    type: 'email', inputmode: 'email', autocomplete: 'username',
    // Phone keyboards capitalise and autocorrect by default, which silently
    // breaks email sign-in.
    autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
  });
  const password = el('input', { type: 'password', autocomplete: 'current-password' });

  const submit = async () => {
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    });
    btn.disabled = false;
    if (error) { fail(error); return; }
    boot();
  };

  // Enter on the password field should submit; on a phone keyboard the Go key
  // is closer than the button.
  password.onkeydown = (e) => { if (e.key === 'Enter') submit(); };

  const btn = el('button', { class: 'primary', onclick: submit }, 'Sign in');

  $('auth').replaceChildren(
    el('div', { class: 'eyebrow' }, 'Roseberry'),
    el('h1', { class: 'brand' }, 'Ops'),
    el('div', { style: 'height:24px' }),
    panel(
      el('div', { class: 'field' }, el('label', {}, 'Email'), email),
      el('div', { class: 'field' }, el('label', {}, 'Password'), password),
    ),
    el('div', { class: 'form-actions' }, btn),
  );
}

// ─── Topbar ──────────────────────────────────────────────────────────────
// Desktop-only, 60px, sticky: breadcrumb on the left, Search + Capture on the
// right. A port of apps/web's Topbar.tsx. Built once; updateTopbar() (called
// from markActive on every navigation) only rewrites the breadcrumb.

function buildTopbar() {
  $('topbar').replaceChildren(
    el('div', { class: 'topbar-crumb' }),
    el('button', {
      class: 'topbar-search', type: 'button', onclick: () => go('#/search'),
    },
      svg(ICONS.search, 15),
      el('span', { style: 'flex:1; text-align:left' }, 'Search'),
      el('span', { class: 'topbar-kbd' }, '⌘K'),
    ),
    el('button', {
      class: 'topbar-capture', type: 'button', onclick: () => go('#/capture'),
    },
      svg(ICONS.capture, 14),
      'Capture',
    ),
  );
}

let routerStarted = false;

async function boot() {
  const { data: { session } } = await sb.auth.getSession();

  $('auth').classList.toggle('hidden', !!session);
  $('main').classList.toggle('hidden', !session);
  $('nav').classList.toggle('hidden', !session);
  $('rail').classList.toggle('hidden', !session);
  $('topbar').classList.toggle('hidden', !session);
  $('fab').classList.toggle('hidden', !session);

  if (!session) { signInScreen(); return; }

  // Reference data backs every picker in the app, so it has to be in place
  // before the first view renders.
  try {
    await loadRef();
  } catch (err) {
    fail(err);
  }
  await loadBadgeCounts().catch(() => {});

  buildNav();
  buildTopbar();
  buildRail();
  $('fab').onclick = () => go('#/capture');

  if (!routerStarted) {
    routerStarted = true;
    startRouter($('main'), markActive);
  } else {
    go(location.hash || '#/today');
  }
  markActive(currentPath());
}

// A token can expire while the app sits open on a phone for days. Rather than
// letting every query start failing, drop back to the sign-in screen.
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.reload();
});

// Keep the status bar in step with whichever theme was restored before paint.
setTheme(currentTheme());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

boot();
