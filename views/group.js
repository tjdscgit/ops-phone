// A group index — one screen listing the collections inside an area.
//
// The design gives Work, People and Library a single tab each, but each covers
// several tables. Rather than invent a bespoke screen per area, a tab lands
// here and hands off to the descriptor-driven lists.

import { el, hint, screenHead } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { GROUPS, byKey } from '../schema.js';

// Extra destinations that belong to an area but aren't descriptor-driven.
const EXTRAS = {
  Work: [{ href: '#/tasks', label: 'Tasks', note: 'Everything open, waiting or done' }],
};

export async function groupView(mount, { label }) {
  const name = GROUPS.map((g) => g.label).find(
    (l) => l.toLowerCase() === String(label).toLowerCase(),
  );
  if (!name) return go('#/today');

  const group = GROUPS.find((g) => g.label === name);

  const rows = [
    ...(EXTRAS[name] ?? []),
    ...group.keys.map((k) => {
      const d = byKey(k);
      return d ? { href: `#/c/${k}`, label: d.label, note: null } : null;
    }).filter(Boolean),
  ];

  mount.replaceChildren(
    screenHead(name, name === 'Library' ? 'Reading & notes' : name),
    rows.length
      ? el('div', { class: 'list' }, ...rows.map((r) =>
          el('button', { class: 'item', type: 'button', onclick: () => go(r.href) },
            el('div', { class: 'item-title serif' }, r.label),
            r.note ? el('div', { class: 'item-meta' }, r.note) : null,
          )))
      : hint('Nothing here yet.'),
  );
}
