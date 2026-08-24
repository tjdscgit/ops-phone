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
import { tasksList, taskForm } from './views/tasks.js';
import { routinesList, routineForm } from './views/routines.js';
import { captureView } from './views/capture.js';
import { groupView } from './views/group.js';
import { enablePush, pushStatus } from './views/push.js';

// ─── Routes ──────────────────────────────────────────────────────────────

route('/today', todayView);
route('/capture', captureView);
route('/settings', settingsView);

route('/tasks', tasksList);
route('/tasks/:id', taskForm);

route('/routines', routinesList);
route('/routines/:id', routineForm);

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

const ICONS = {
  today: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  work: '<rect x="3" y="5" width="13" height="3" rx="0.5"/><rect x="7" y="10.5" width="14" height="3" rx="0.5"/><rect x="5" y="16" width="11" height="3" rx="0.5"/>',
  content: '<rect x="3.5" y="4" width="5" height="16" rx="0.5"/><rect x="9.5" y="4" width="5" height="11" rx="0.5"/><rect x="15.5" y="4" width="5" height="14" rx="0.5"/>',
  people: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6"/>',
  library: '<path d="M4 4.5v15l3 .5V5.5z"/><path d="M10 4.5v15l3 .5V5.5z"/><path d="M16.2 5.8l3 14.7 1.5-.4-3-14.7z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
};

const TABS = [
  { href: '#/today', label: 'Today', icon: 'today' },
  { href: '#/g/work', label: 'Work', icon: 'work' },
  { href: '#/c/content', label: 'Content', icon: 'content' },
  { href: '#/g/people', label: 'People', icon: 'people' },
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
        onclick: openSheet,
      });
      b.append(svg(ICONS.more), el('span', {}, 'More'));
      return b;
    })(),
  );
}

// ─── Desktop rail ────────────────────────────────────────────────────────
// Above 800px the bottom bar gives way to a rail down the left. There is room
// for everything there, so the rail lists the five tabs AND what the phone
// hides behind More — no sheet needed on a desktop.

const RAIL_GLYPHS = {
  capture: '<path d="M12 5v14M5 12h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
};

function buildRail() {
  const item = ({ href, label, icon, glyph, cls, onClick }) => {
    const b = el('button', {
      class: `rail-item ${cls || ''}`, type: 'button',
      'data-href': href || null,
      onclick: onClick || (() => go(href)),
    });
    const g = el('span', { class: 'glyph' });
    g.append(icon ? svg(ICONS[icon], 20) : svg(RAIL_GLYPHS[glyph], 20));
    b.append(g, el('span', { class: 'label' }, label));
    return b;
  };

  $('rail').replaceChildren(
    el('div', { class: 'rail-head' },
      el('div', { class: 'rail-mark' }, 'R'),
      el('div', { class: 'rail-name' },
        el('b', {}, 'Roseberry'),
        el('span', {}, 'Ops'),
      ),
    ),
    el('div', { class: 'rail-items' },
      item({ label: 'Capture', glyph: 'capture', cls: 'cta', onClick: () => go('#/capture') }),
      el('div', { class: 'rail-sep' }),
      ...TABS.map((t) => item({ href: t.href, label: t.label, icon: t.icon })),
      el('div', { class: 'rail-sep' }),
      ...MORE_ITEMS.filter((m) => m.href !== '#/settings')
        .map((m) => railGlyphItem(m, item)),
    ),
    el('div', { class: 'rail-foot' },
      item({ href: '#/settings', label: 'Settings', glyph: 'settings' }),
      el('button', {
        class: 'rail-item', type: 'button',
        onclick: async () => { await sb.auth.signOut(); location.reload(); },
      },
        el('span', { class: 'glyph' }, '⏻'),
        el('span', { class: 'label' }, 'Sign out'),
      ),
    ),
  );
}

// The More items carry a text glyph rather than an SVG; reuse it in the rail
// so the two shells name things identically.
function railGlyphItem(m, item) {
  const b = el('button', {
    class: 'rail-item', type: 'button', 'data-href': m.href,
    onclick: () => go(m.href),
  });
  b.append(el('span', { class: 'glyph' }, m.glyph), el('span', { class: 'label' }, m.label));
  return b;
}

function markActive(path) {
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

// ─── More sheet ──────────────────────────────────────────────────────────

function openSheet() {
  const sheet = $('sheet');
  const scrim = $('sheetScrim');

  sheet.replaceChildren(
    el('div', { class: 'sheet-grip' }),
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
  );

  scrim.classList.remove('hidden');
  sheet.classList.remove('hidden');
  // Force a reflow so the browser commits the off-screen start state before
  // `.show` moves it — a rAF would do the same but never fires in a
  // background tab, which would leave the sheet rendered but stuck off-screen.
  void sheet.offsetHeight;
  scrim.classList.add('show');
  sheet.classList.add('show');

  scrim.onclick = closeSheet;

  sb.auth.getSession().then(({ data: { session } }) => {
    const slot = $('sheetEmail');
    if (slot && session?.user?.email) slot.textContent = session.user.email;
  });
}

function closeSheet() {
  const sheet = $('sheet');
  const scrim = $('sheetScrim');
  sheet.classList.remove('show');
  scrim.classList.remove('show');
  setTimeout(() => {
    sheet.classList.add('hidden');
    scrim.classList.add('hidden');
  }, 220);
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

let routerStarted = false;

async function boot() {
  const { data: { session } } = await sb.auth.getSession();

  $('auth').classList.toggle('hidden', !!session);
  $('main').classList.toggle('hidden', !session);
  $('nav').classList.toggle('hidden', !session);
  $('rail').classList.toggle('hidden', !session);
  $('fab').classList.toggle('hidden', !session);

  if (!session) { signInScreen(); return; }

  // Reference data backs every picker in the app, so it has to be in place
  // before the first view renders.
  try {
    await loadRef();
  } catch (err) {
    fail(err);
  }

  buildNav();
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
