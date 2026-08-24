// Search — the rail/topbar's ⌘K destination. Filters the reference lists
// already held in memory (loaded at boot for the FK pickers), so results are
// instant with no extra round trip. Scoped to named things only (projects,
// content, people, companies) — full-text search over notes/tasks is a
// bigger, separate feature.

import { ref } from '../lib/db.js';
import { el, hint, screenHead } from '../lib/ui.js';
import { go } from '../lib/router.js';

export async function searchView(mount) {
  const input = el('input', {
    type: 'search', placeholder: 'Search projects, content, people, companies…',
    autofocus: true,
  });
  const results = el('div', {});

  input.oninput = () => draw(input.value.trim().toLowerCase());

  function draw(q) {
    if (!q) { results.replaceChildren(hint('Type to search.')); return; }

    const hits = [
      ...ref.projects.filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => ({ label: p.name, meta: 'Project', href: `#/c/projects/${p.id}` })),
      ...ref.contentItems.filter((c) => c.title.toLowerCase().includes(q))
        .map((c) => ({ label: c.title, meta: 'Content', href: `#/c/content/${c.id}` })),
      ...ref.people.filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => ({ label: p.name, meta: 'Person', href: `#/c/people/${p.id}` })),
      ...ref.companies.filter((c) => c.name.toLowerCase().includes(q))
        .map((c) => ({ label: c.name, meta: 'Company', href: `#/c/companies/${c.id}` })),
    ].slice(0, 50);

    results.replaceChildren(
      hits.length
        ? el('div', { class: 'list' }, ...hits.map((h) =>
            el('button', { class: 'item', type: 'button', onclick: () => go(h.href) },
              el('div', { class: 'item-title' }, h.label),
              el('div', { class: 'item-meta' }, h.meta),
            )))
        : hint('Nothing matches.'),
    );
  }

  draw('');

  mount.replaceChildren(
    screenHead('Find', 'Search'),
    el('div', { class: 'controls' }, input),
    results,
  );
  input.focus();
}
