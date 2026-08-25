// Library — the unified archive. A port of the dashboard's library-view.tsx
// (masonry feed + book shelf) and the notes/quotes/journal/books detail +
// new pages (Detail Pages v2, Addendum 10 §10): reader-style pages, not the
// operational detail-shell Content/People/Companies use.
//
// Image UPLOAD is deliberately not ported — apps/web's ImageUploader posts to
// Bunny via a server action that needs a secret this static app doesn't have
// (same reasoning as leaving Chat/Ask off: a live-looking dead control would
// be worse than the honest gap). Existing attachments still render read-only
// via the photo gallery below; new ones can't be attached from here yet.

import { sb, ref } from '../lib/db.js';
import { el, hint, spinner, pill, toast, fail, confirmDelete, sectionLabel } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { openSheet, closeSheet } from '../app.js';
import {
  LIB_TYPES, NOTE_SOURCE_ORDER, NOTE_SOURCE_LABEL, QUOTE_SOURCE_ORDER, QUOTE_SOURCE_LABEL,
  BOOK_STATUS_ORDER, BOOK_STATUS_LABEL, BOOK_STATUS_PILL, BOOK_SORTS,
  sortBooks, bookBadge, coverTint, loadLibraryData,
} from '../lib/library.js';

const TOP_TAGS = 12;
const RENDER_CAP = 180;
const EMPTY_NOUN = { note: 'notes', quote: 'quotes', journal: 'journal entries', book: 'books' };

// The hash router (lib/router.js) matches the WHOLE hash after '#' against a
// literal pattern — it never strips a '?query'. A link like '#/library?type=
// note' would fall through every route (no match) and bounce to Today. Every
// internal link below uses a path segment instead: '/library/:type', routed
// in app.js alongside the rest of Library's routes.

// ─── Unified list ──────────────────────────────────────────────────────────

export async function libraryView(mount, params = {}) {
  mount.replaceChildren(spinner());
  const { entries, books } = await loadLibraryData();

  let type = LIB_TYPES.some((t) => t.value === params.type) ? params.type : 'all';
  let src = new Set();
  let tags = new Set();
  let needsReview = false;
  let showAllTags = false;
  let bookStatus = new Set();
  let sort = 'title';

  const layout = el('div', { class: 'work-layout' });
  mount.replaceChildren(layout);

  function pickType(k) {
    type = k; src = new Set(); tags = new Set(); needsReview = false; bookStatus = new Set(); showAllTags = false;
    render();
  }
  function reset() { pickType('all'); sort = 'title'; }

  function render() {
    const isBooks = type === 'book';
    const isQuotes = type === 'quote';

    const count = (k) => {
      if (k === 'all') return entries.length + books.length;
      if (k === 'book') return books.length;
      return entries.filter((e) => e.kind === k).length;
    };

    const tagPool = entries.filter((e) => type === 'all' || e.kind === type);

    const visibleEntries = isBooks ? [] : entries.filter((e) => {
      if (type !== 'all' && e.kind !== type) return false;
      if (src.size && (!e.source || !src.has(e.source))) return false;
      if (needsReview && !e.needsReview) return false;
      if (tags.size && !e.tags.some((t) => tags.has(t))) return false;
      return true;
    });

    const entryFilterOn = src.size > 0 || tags.size > 0 || needsReview;
    const showBooks = isBooks || (type === 'all' && !entryFilterOn);
    const visibleBooks = !showBooks ? [] : books
      .filter((b) => !bookStatus.size || bookStatus.has(b.status))
      .slice()
      .sort((a, b) => sortBooks(a, b, sort));

    const sourceOrder = isQuotes ? QUOTE_SOURCE_ORDER : NOTE_SOURCE_ORDER;
    const sourceLabel = isQuotes ? QUOTE_SOURCE_LABEL : NOTE_SOURCE_LABEL;
    const sources = sourceOrder
      .map((v) => ({ value: v, count: tagPool.filter((e) => e.source === v).length }))
      .filter((s) => s.count > 0);

    const tagCounts = new Map();
    for (const e of tagPool) for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const tagCloud = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const visibleTags = showAllTags ? tagCloud : tagCloud.slice(0, TOP_TAGS);
    const moreTags = tagCloud.length - visibleTags.length;

    const facetActive = src.size > 0 || tags.size > 0 || needsReview || bookStatus.size > 0;
    const activeFilters = src.size + tags.size + bookStatus.size + (needsReview ? 1 : 0) + (type !== 'all' ? 1 : 0);
    const needsReviewCount = tagPool.filter((e) => e.needsReview).length;
    const shownCount = visibleEntries.length + visibleBooks.length;

    const cappedEntries = visibleEntries.slice(0, RENDER_CAP);
    const entriesHidden = visibleEntries.length - cappedEntries.length;
    const cols = window.innerWidth >= 1280 ? 3 : window.innerWidth >= 768 ? 2 : 1;
    const columns = Array.from({ length: cols }, () => []);
    cappedEntries.forEach((e, i) => columns[i % cols].push(e));

    function buildFacetGroups() {
      return [
        facetGroup('Type', activeFilters > 0 ? clearBtn('Reset', reset) : null,
          ...LIB_TYPES.map((t) => facetRow({ on: type === t.value, name: t.label, count: count(t.value), onClick: () => pickType(t.value) })),
        ),
        el('div', { class: 'facet-sep' }),
        isBooks ? el('div', {},
          facetGroup('Status', bookStatus.size ? clearBtn('Clear', () => { bookStatus = new Set(); render(); }) : null,
            ...BOOK_STATUS_ORDER.map((s) => {
              const n = books.filter((b) => b.status === s).length;
              return n ? facetRow({ on: bookStatus.has(s), name: BOOK_STATUS_LABEL[s], count: n, onClick: () => { bookStatus.has(s) ? bookStatus.delete(s) : bookStatus.add(s); render(); } }) : null;
            }).filter(Boolean),
          ),
          el('div', { class: 'facet-sep' }),
          facetGroup('Sort', null,
            el('div', { class: 'facet-tags' }, ...BOOK_SORTS.map((s) => facetTag({ on: sort === s.value, name: s.label, onClick: () => { sort = s.value; render(); } }))),
          ),
        ) : null,
        !isBooks && (sources.length > 0 || (!isQuotes && needsReviewCount > 0)) ? el('div', {},
          facetGroup('Source', (src.size || needsReview) ? clearBtn('Clear', () => { src = new Set(); needsReview = false; render(); }) : null,
            ...sources.map((s) => facetRow({ on: src.has(s.value), name: sourceLabel[s.value] ?? s.value, count: s.count, onClick: () => { src.has(s.value) ? src.delete(s.value) : src.add(s.value); render(); } })),
            (!isQuotes && needsReviewCount > 0) ? facetRow({ on: needsReview, name: 'Needs review', count: needsReviewCount, onClick: () => { needsReview = !needsReview; render(); } }) : null,
          ),
          el('div', { class: 'facet-sep' }),
        ) : null,
        !isBooks && tagCloud.length > 0 ? facetGroup('Tag', tags.size ? clearBtn('Clear', () => { tags = new Set(); render(); }) : null,
          el('div', { class: 'facet-tags' },
            ...visibleTags.map(([t, n]) => facetTag({ on: tags.has(t), name: `#${t}`, count: n, onClick: () => { tags.has(t) ? tags.delete(t) : tags.add(t); render(); } })),
            moreTags > 0 ? el('button', { class: 'facet-tag', type: 'button', onclick: () => { showAllTags = true; render(); } }, `+${moreTags} more`) : null,
          ),
        ) : null,
      ].filter(Boolean);
    }

    function addActions() {
      if (type === 'book') return [{ href: '#/library/books/new', label: '+ Add book', solid: true }];
      if (type === 'journal') return [{ href: '#/library/journal/new', label: '+ New entry', solid: true }];
      if (type === 'quote') return [{ href: '#/library/quotes/new', label: '+ Add quote', solid: true }];
      return [{ href: '#/library/quotes/new', label: '+ Add quote', solid: false }, { href: '#/library/notes/new', label: '+ New note', solid: true }];
    }

    const emptyState = (cappedEntries.length === 0 && visibleBooks.length === 0)
      ? el('div', { class: 'work-empty' },
          el('div', { class: 'work-empty-title' }, facetActive ? 'Nothing matches.' : (type === 'all' ? 'Nothing here yet.' : `No ${EMPTY_NOUN[type] ?? 'items'} yet.`)),
          el('p', { class: 'item-meta plain' }, facetActive ? 'Clear a filter on the left.' : 'Voice captures, quotes, and journal entries land here.'),
        )
      : null;

    const booksBlock = (showBooks && visibleBooks.length > 0) ? el('div', { style: `margin-top:${isBooks ? 0 : 26}px` },
      sectionLabel(`Books · ${visibleBooks.length}`,
        el('span', { class: 'item-meta plain' }, `${visibleBooks.reduce((s, b) => s + (b.quote_count ?? 0), 0)} highlights · by ${(BOOK_SORTS.find((s) => s.value === sort)?.label ?? '').toLowerCase()}`)),
      el('div', { class: 'lib-book-grid' }, ...visibleBooks.map((b) => bookCard(b, sort))),
    ) : null;

    const body = el('div', { class: 'work-body' },
      el('header', { class: 'screen-head', style: 'padding-top:0' },
        el('div', { class: 'row-actions' },
          el('div', {},
            el('div', { class: 'eyebrow' }, `Archive · ${entries.length} entries · ${books.length} books`),
            el('h1', {}, 'Library'),
          ),
          el('div', { class: 'work-head-actions' },
            facetActive ? pill('plain', `${shownCount} shown`, false) : null,
            ...addActions().map((a) => el('button', { class: a.solid ? 'work-cta' : 'ghost small', type: 'button', onclick: () => go(a.href) }, a.label)),
          ),
        ),
      ),
      emptyState,
      cappedEntries.length > 0 ? el('div', { class: 'lib-masonry' },
        ...columns.map((col) => el('div', { class: 'lib-col' }, ...col.map((e) => entryCard(e, tags, (t) => { tags.has(t) ? tags.delete(t) : tags.add(t); render(); })))),
      ) : null,
      entriesHidden > 0 ? el('p', { class: 'item-meta plain', style: 'margin-top:14px' }, `Showing ${cappedEntries.length.toLocaleString()} of ${visibleEntries.length.toLocaleString()} — narrow with a filter.`) : null,
      booksBlock,
    );

    const desktopRail = el('aside', { class: 'facet-rail' }, ...buildFacetGroups());
    const filtersBtn = el('button', {
      class: 'filters-fab', type: 'button',
      onclick: () => openSheet(el('div', {},
        el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'Filters')),
        el('div', { style: 'padding-top:8px' }, ...buildFacetGroups()),
      )),
    }, `Filters${activeFilters ? ` · ${activeFilters}` : ''}`);

    layout.replaceChildren(desktopRail, filtersBtn, body);
  }

  render();
}

function entryCard(e, selectedTags, onTag) {
  const kicker = e.kind === 'quote' ? (e.who || 'Quote') : e.kind === 'journal' ? 'Journal' : (e.source ? NOTE_SOURCE_LABEL[e.source] ?? 'Note' : 'Note');
  return el('article', { class: 'lib-card' },
    e.image ? el('button', { class: 'lib-card-image-btn', type: 'button', onclick: () => go(e.href) },
      el('img', { src: e.image, alt: '', loading: 'lazy', class: 'lib-card-image' })) : null,
    el('div', { class: 'lib-card-body' },
      el('div', { class: 'lib-card-kicker' },
        el('span', { class: 'lib-card-kicker-text' }, kicker),
        e.photoCount > 0 ? el('span', { class: 'lib-card-photo-count' }, `📷 ${e.photoCount}`) : null,
        el('span', { class: 'lib-card-date' }, e.dateLabel),
      ),
      el('button', { class: 'lib-card-link', type: 'button', onclick: () => go(e.href) },
        e.kind === 'quote'
          ? el('div', {},
              el('p', { class: 'lib-card-quote' }, `“${e.body}”`),
              e.book ? el('div', { class: 'lib-card-book' }, e.book) : null,
            )
          : el('div', {},
              e.title ? el('h4', { class: 'lib-card-title' }, e.title) : null,
              el('p', { class: 'lib-card-text' }, e.body),
            ),
      ),
      (e.tags.length > 0 || e.needsReview) ? el('div', { class: 'lib-tagrow' },
        e.needsReview ? el('span', { class: 'lib-tag lib-tag-warn' }, 'Needs review') : null,
        ...e.tags.map((t) => el('button', { class: `lib-tag ${selectedTags.has(t) ? 'on' : ''}`, type: 'button', onclick: () => onTag(t) }, `#${t}`)),
      ) : null,
    ),
  );
}

function bookCard(b, sort) {
  const badge = bookBadge(b, sort);
  const tint = coverTint(b.title);
  return el('button', { class: 'lib-book-card', type: 'button', onclick: () => go(`#/library/books/${b.id}`) },
    b.cover_image_url
      ? el('img', { src: b.cover_image_url, alt: b.title, class: 'lib-book-cover' })
      : el('div', { class: 'lib-book-cover lib-book-cover-tint', style: `background:${tint.bg}; color:${tint.fg}` }, el('span', {}, b.title)),
    el('div', { class: 'lib-book-title' }, b.title),
    b.author ? el('div', { class: 'lib-book-author' }, b.author) : null,
    el('div', { class: 'lib-book-foot' },
      pill(BOOK_STATUS_PILL[b.status], BOOK_STATUS_LABEL[b.status]),
      el('span', { class: 'lib-book-meta' }, `${b.quote_count ?? 0} hl${badge ? ` · ${badge}` : ''}`),
    ),
  );
}

// ─── Shared facet-rail helpers (local copies — every ported list view keeps
// its own, per views/content.js's precedent) ───────────────────────────────

function facetGroup(label, action, ...children) { return el('div', { class: 'facet-group' }, el('div', { class: 'facet-group-head' }, el('span', { class: 'eyebrow' }, label), action ? el('div', {}, action) : null), ...children); }
function facetRow({ on, name, count, onClick }) { return el('button', { class: `facet-row ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, el('span', { class: 'facet-row-name' }, name), count != null ? el('span', { class: 'facet-row-count' }, String(count)) : null); }
function facetTag({ on, name, count, onClick }) { return el('button', { class: `facet-tag ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, name, count != null ? ` ${count}` : ''); }
function clearBtn(label, onClick) { return el('button', { class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.09em; text-decoration:none', onclick }, label); }

// ─── Reader-page shared bits ────────────────────────────────────────────────

function crumb(label, onClick) {
  return el('div', { class: 'lib-crumb' }, el('button', { class: 'linkish', type: 'button', onclick: onClick }, `← ${label}`));
}

function editLink(title, formNode) {
  return el('button', {
    class: 'linkish', type: 'button',
    style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.08em; text-decoration:none',
    onclick: () => openSheet(el('div', {},
      el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, title)),
      el('div', { style: 'padding:16px 20px 24px' }, formNode),
    )),
  }, 'Edit');
}

// Read-only photo viewer — a port of components/PhotoGallery.tsx. Uploading
// isn't wired here (see file header); this only displays what's already
// attached.
function photoGallery(attachments) {
  const images = (attachments ?? []).filter((a) => a.url && (!a.content_type || a.content_type.startsWith('image')));
  if (!images.length) return null;

  function openLightbox(startIdx) {
    let i = startIdx;
    const overlay = el('div', { class: 'lib-lightbox' });
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    }
    function step(d) { i = (i + d + images.length) % images.length; paint(); }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    }
    function paint() {
      const a = images[i];
      overlay.replaceChildren(
        el('div', { class: 'lib-lightbox-head' },
          el('span', {}, `${i + 1} / ${images.length}`),
          el('button', { type: 'button', style: 'background:none; border:none; color:inherit; cursor:pointer; font:inherit', onclick: close }, '✕ Close'),
        ),
        el('div', { class: 'lib-lightbox-body' },
          images.length > 1 ? el('button', { class: 'lib-lightbox-nav', type: 'button', onclick: (e) => { e.stopPropagation(); step(-1); } }, '‹') : null,
          el('img', { src: a.url, alt: a.alt || a.location || '', onclick: (e) => e.stopPropagation() }),
          images.length > 1 ? el('button', { class: 'lib-lightbox-nav', type: 'button', onclick: (e) => { e.stopPropagation(); step(1); } }, '›') : null,
        ),
      );
    }
    overlay.onclick = close;
    paint();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    document.body.append(overlay);
  }

  const n = images.length;
  const tile = (a, i, aspect) => el('button', { class: 'lib-gallery-tile', type: 'button', style: `aspect-ratio:${aspect}`, onclick: () => openLightbox(i) },
    el('img', { src: a.url, alt: a.alt || a.location || '', loading: 'lazy' }));

  if (n === 1) return el('div', { class: 'lib-gallery' }, tile(images[0], 0, '3/2'));
  if (n === 2) return el('div', { class: 'lib-gallery-row', style: 'grid-template-columns:1fr 1fr' }, tile(images[0], 0, '4/5'), tile(images[1], 1, '4/5'));
  return el('div', { class: 'lib-gallery' },
    tile(images[0], 0, '3/2'),
    el('div', { class: 'lib-gallery-row', style: 'grid-template-columns:repeat(auto-fill,minmax(90px,1fr))' }, ...images.slice(1).map((a, i) => tile(a, i + 1, '1/1'))),
  );
}

// Resurfacing control — a port of BoostButton.tsx's 4-state cycle:
// Normal(1) → Boost 2×(2) → Boost 5×(5) → Excluded(0) → Normal.
const BOOST_TABLE = { note: 'notes', quote: 'quotes', journal: 'journal_entries' };
const BOOST_NEXT = { normal: 2, boost2: 5, boost5: 0, excluded: 1 };
const BOOST_LABEL = { normal: 'Normal', boost2: '★ Boost 2×', boost5: '★★ Boost 5×', excluded: '✕ Excluded' };
const BOOST_STYLE = {
  normal: 'color:var(--ink-3); border-color:var(--line-strong)',
  boost2: 'color:var(--accent); border-color:var(--accent-line)',
  boost5: 'color:var(--bg); background:var(--accent); border-color:var(--accent)',
  excluded: 'color:var(--ink-4); border-color:var(--line-strong)',
};
function boostState(w) {
  if (w === undefined || w === null || w === 1) return 'normal';
  if (w === 0) return 'excluded';
  if (w >= 5) return 'boost5';
  if (w >= 2) return 'boost2';
  return 'normal';
}
function boostButton(kind, id, weight, onSaved) {
  const state = boostState(weight);
  return el('button', {
    type: 'button', class: 'ghost small', style: BOOST_STYLE[state],
    onclick: async () => {
      const { error } = await sb.from(BOOST_TABLE[kind]).update({ resurface_weight: BOOST_NEXT[state] }).eq('id', id);
      if (error) { fail(error); return; }
      onSaved?.();
    },
  }, BOOST_LABEL[state]);
}

function field(label, node) { return el('div', { class: 'field' }, el('label', {}, label), node); }
function tagsField(tags) {
  return (tags && tags.length) ? el('div', { class: 'lib-tagrow' }, ...tags.map((t) => el('span', { class: 'lib-tag', style: 'cursor:default' }, `#${t}`))) : null;
}

// ─── Notes ──────────────────────────────────────────────────────────────────

const NOTE_SOURCE_LABELS_FULL = {
  own_thought: 'Own thought', reading_response: 'Reading response', meeting_note: 'Meeting note',
  brainstorm: 'Brainstorm', observation: 'Observation', other: 'Other',
};

export async function noteDetail(mount, { id }) {
  mount.replaceChildren(spinner());
  const { data: note, error } = await sb
    .from('notes')
    .select('*, project:projects(id,name,color), person:people(id,name), quote:quotes(id,text)')
    .eq('id', id).single();
  if (error) { mount.lastChild.replaceWith(hint(error.message)); return; }

  function refresh() { noteDetail(mount, { id }); }

  const savedLabel = new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const hasRelated = Boolean(note.project || note.person || note.quote || note.source_reference);

  const related = hasRelated ? el('div', { style: 'display:flex; flex-wrap:wrap; gap:10px 16px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); margin-bottom:14px' },
    note.project ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/projects/${note.project.id}`) }, `Project · ${note.project.name}`) : null,
    note.person ? el('span', {}, `Person · ${note.person.name}`) : null,
    note.quote ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/library/quotes/${note.quote.id}`) }, `Quote · "${note.quote.text.length > 50 ? note.quote.text.slice(0, 50) + '…' : note.quote.text}"`) : null,
    (note.source_reference && !note.project && !note.person && !note.quote) ? el('span', {}, `Source · ${note.source_reference}`) : null,
  ) : null;

  mount.replaceChildren(el('div', { class: 'lib-reader' },
    crumb('Notes', () => go('#/library/note')),
    el('div', { class: 'lib-reader-eyebrow' },
      NOTE_SOURCE_LABELS_FULL[note.source_type] ?? note.source_type,
      note.needs_review ? el('span', { style: 'color:var(--warn)' }, ' · needs review') : null,
      el('span', { style: 'color:var(--ink-4)' }, ` · saved ${savedLabel}`),
    ),
    note.title ? el('h1', { class: 'lib-reader-title' }, note.title) : null,
    el('div', { class: 'lib-reader-body', style: note.title ? '' : 'margin-top:16px; font-size:20px' }, note.body),
    (note.attachments ?? []).length > 0 ? el('div', { style: 'margin-top:28px' }, photoGallery(note.attachments)) : null,
    el('div', { class: 'lib-reader-footer', style: 'flex-direction:column; align-items:stretch; gap:14px' },
      related,
      tagsField(note.tags),
      el('div', { style: 'display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap' },
        el('div', { style: 'display:flex; align-items:center; gap:10px' }, el('span', { class: 'eyebrow' }, 'Resurfacing'), boostButton('note', note.id, note.resurface_weight, refresh)),
        editLink('Edit note', noteForm(note, refresh)),
      ),
    ),
  ));
}

function noteForm(row, onSaved) {
  const isNew = !row?.id;
  const v = {
    title: row?.title ?? '', body: row?.body ?? '', source_type: row?.source_type ?? 'own_thought',
    source_reference: row?.source_reference ?? '', tags: (row?.tags ?? []).join(', '), needs_review: row?.needs_review ?? false,
  };
  const titleInput = el('input', { type: 'text', placeholder: 'Short headline. Leave blank for voice captures.', oninput: (e) => { v.title = e.target.value; } }); titleInput.value = v.title;
  const bodyInput = el('textarea', { rows: 8, oninput: (e) => { v.body = e.target.value; } }); bodyInput.value = v.body;
  const sourceSel = el('select', { onchange: (e) => { v.source_type = e.target.value; } });
  for (const [val, label] of Object.entries(NOTE_SOURCE_LABELS_FULL)) sourceSel.append(el('option', { value: val }, label));
  sourceSel.value = v.source_type;
  const refInput = el('input', { type: 'text', placeholder: 'e.g. Mere Christianity, Substack article', oninput: (e) => { v.source_reference = e.target.value; } }); refInput.value = v.source_reference;
  const tagsInput = el('input', { type: 'text', placeholder: 'leadership, stewardship', oninput: (e) => { v.tags = e.target.value; } }); tagsInput.value = v.tags;
  const reviewCb = el('input', { type: 'checkbox', checked: v.needs_review, onchange: (e) => { v.needs_review = e.target.checked; } });

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add note' : 'Save');
  const wrap = el('div', {},
    field('Title (optional)', titleInput),
    field('Body (required)', bodyInput),
    el('div', { class: 'row' }, field('Kind', sourceSel), field('Source reference', refInput)),
    field('Tags (comma-separated)', tagsInput),
    el('label', { class: 'check' }, reviewCb, 'Needs review'),
    (row && (row.attachments ?? []).length > 0) ? el('p', { class: 'hint' }, `${row.attachments.length} photo${row.attachments.length === 1 ? '' : 's'} attached — add more from the capture flow.`) : null,
    el('div', { class: 'form-actions' }, save, isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete note…')),
  );

  async function onSave() {
    if (!v.body.trim()) { toast('Write something first.', 'err'); return; }
    save.disabled = true;
    const payload = {
      title: v.title.trim() || null, body: v.body.trim(), source_type: v.source_type,
      source_reference: v.source_reference.trim() || null,
      tags: v.tags.trim() ? v.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      needs_review: v.needs_review,
    };
    const res = isNew ? await sb.from('notes').insert(payload).select('id').single() : await sb.from('notes').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Added' : 'Saved');
    closeSheet();
    if (isNew) go(`#/library/notes/${res.data.id}`); else onSaved?.();
  }
  async function onDelete() {
    if (!confirmDelete('this note')) return;
    const { error } = await sb.from('notes').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    closeSheet();
    go('#/library/note');
  }
  return wrap;
}

export async function noteNew(mount) {
  mount.replaceChildren(el('div', { class: 'lib-reader' },
    crumb('Notes', () => go('#/library/note')),
    el('header', { class: 'screen-head', style: 'padding:16px 0 20px' }, el('div', { class: 'eyebrow' }, 'Library'), el('h1', {}, 'New note')),
    noteForm(null),
  ));
}

// ─── Quotes ─────────────────────────────────────────────────────────────────

const QUOTE_SOURCE_LABELS_FULL = {
  book: 'Book', article: 'Article', podcast: 'Podcast', sermon: 'Sermon', video: 'Video', conversation: 'Conversation', other: 'Other',
};
const ANNOTATION_CONTEXT_LABEL = { on_capture: 'On capture', on_revisit: 'On revisit', on_surface: 'On surface', unspecified: 'Thought' };

export async function quoteDetail(mount, { id }) {
  mount.replaceChildren(spinner());
  const [quoteR, annotR] = await Promise.all([
    sb.from('quotes').select('*, book:books(id,title,author,cover_image_url)').eq('id', id).single(),
    sb.from('quote_annotations').select('*').eq('quote_id', id).order('annotated_at', { ascending: false }),
  ]);
  if (quoteR.error) { mount.lastChild.replaceWith(hint(quoteR.error.message)); return; }
  const quote = quoteR.data;
  const annotations = annotR.data ?? [];

  function refresh() { quoteDetail(mount, { id }); }

  const book = quote.book ?? null;
  const author = quote.source_author?.trim() || null;
  const sourceRef = quote.source_reference?.trim() || null;
  const pageStr = quote.page_number != null ? String(quote.page_number) : null;
  const chapter = quote.chapter?.trim() || null;
  const hasAttribution = Boolean(author || book || sourceRef || pageStr || chapter);
  const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const attribution = hasAttribution ? el('div', { style: 'margin-top:22px' },
    author ? el('div', { style: 'font-family:var(--serif); font-size:15px; font-style:italic; color:var(--ink-2)' }, `— ${author}`) : null,
    (book || sourceRef || pageStr || chapter) ? el('div', { style: 'margin-top:12px; display:flex; align-items:center; gap:12px' },
      book?.cover_image_url ? el('img', { src: book.cover_image_url, alt: book.title, style: 'width:40px; height:auto; border:1px solid var(--line); align-self:flex-start' }) : null,
      el('div', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); line-height:1.5' },
        book ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/library/books/${book.id}`) }, book.title) : (sourceRef ? el('span', {}, sourceRef) : null),
        (pageStr || chapter) ? el('div', { style: 'color:var(--ink-4); margin-top:2px' }, [pageStr ? `p. ${pageStr}` : null, chapter ? `ch. ${chapter}` : null].filter(Boolean).join(' · ')) : null,
      ),
    ) : null,
  ) : null;

  const annotList = annotations.length === 0
    ? el('p', { style: 'font-family:var(--sans); font-size:13px; font-style:italic; color:var(--ink-3); margin-bottom:20px' }, 'No thoughts yet. Add the first one below.')
    : el('div', { style: 'margin-bottom:24px' }, ...annotations.map((a) => {
        const onCapture = a.context === 'on_capture';
        return el('div', { class: `lib-annot ${onCapture ? 'accent' : ''}` },
          el('div', { class: 'lib-annot-meta' },
            el('span', {}, `${ANNOTATION_CONTEXT_LABEL[a.context] ?? 'Thought'} · ${fmt(a.annotated_at)}`),
            el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async () => { await sb.from('quote_annotations').delete().eq('id', a.id); refresh(); } }, 'Delete'),
          ),
          el('p', { class: 'lib-annot-body' }, a.body),
        );
      }));

  const addForm = (() => {
    const textarea = el('textarea', { rows: 3, placeholder: 'Add a thought on this quote…' });
    const btn = el('button', { class: 'ghost small', type: 'button', onclick: async () => {
      if (!textarea.value.trim()) return;
      btn.disabled = true;
      const { error } = await sb.from('quote_annotations').insert({ quote_id: quote.id, body: textarea.value.trim() });
      btn.disabled = false;
      if (error) { fail(error); return; }
      refresh();
    } }, 'Add thought');
    return el('div', {},
      textarea,
      el('div', { style: 'display:flex; justify-content:flex-end; margin-top:8px' }, btn),
    );
  })();

  mount.replaceChildren(el('div', { class: 'lib-reader' },
    crumb('Quotes', () => go('#/library/quote')),
    el('blockquote', { style: 'margin-top:26px; font-family:var(--serif); font-size:24px; font-style:italic; line-height:1.42; letter-spacing:-0.005em; color:var(--ink)' }, `“${quote.text}”`),
    attribution,
    quote.source_url ? el('a', { href: quote.source_url, target: '_blank', rel: 'noopener noreferrer', style: 'display:inline-block; margin-top:14px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent)' }, 'Open source ↗') : null,
    el('section', { style: 'margin-top:36px; padding-top:22px; border-top:1px solid var(--line)' },
      sectionLabel(`Thoughts${annotations.length ? ` · ${annotations.length}` : ''}`),
      el('div', { style: 'margin-top:14px' }, annotList),
      addForm,
    ),
    el('div', { class: 'lib-reader-footer', style: 'flex-direction:column; align-items:stretch; gap:14px' },
      tagsField(quote.tags),
      el('div', { style: 'display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap' },
        el('div', { style: 'display:flex; align-items:center; gap:10px' }, el('span', { class: 'eyebrow' }, 'Resurfacing'), boostButton('quote', quote.id, quote.resurface_weight, refresh)),
        editLink('Edit highlight', quoteForm(quote)),
      ),
    ),
  ));
}

function quoteForm(row) {
  const isNew = !row?.id;
  const v = {
    text: row?.text ?? '', book_id: row?.book_id ?? '', source_type: row?.source_type ?? '',
    source_author: row?.source_author ?? '', source_reference: row?.source_reference ?? '',
    source_url: row?.source_url ?? '', page_number: row?.page_number != null ? String(row.page_number) : '',
    chapter: row?.chapter ?? '', tags: (row?.tags ?? []).join(', '),
  };
  const textInput = el('textarea', { rows: 5, style: 'font-family:var(--serif); font-style:italic', oninput: (e) => { v.text = e.target.value; } }); textInput.value = v.text;
  const bookSel = el('select', { onchange: (e) => { v.book_id = e.target.value; } });
  bookSel.append(el('option', { value: '' }, '(none — standalone quote)'));
  for (const b of ref.books) bookSel.append(el('option', { value: b.id }, b.author ? `${b.title} — ${b.author}` : b.title));
  bookSel.value = v.book_id;
  const sourceSel = el('select', { onchange: (e) => { v.source_type = e.target.value; } });
  sourceSel.append(el('option', { value: '' }, '(none)'));
  for (const [val, label] of Object.entries(QUOTE_SOURCE_LABELS_FULL)) sourceSel.append(el('option', { value: val }, label));
  sourceSel.value = v.source_type;
  const pageInput = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'e.g. 47', oninput: (e) => { v.page_number = e.target.value; } }); pageInput.value = v.page_number;
  const authorInput = el('input', { type: 'text', oninput: (e) => { v.source_author = e.target.value; } }); authorInput.value = v.source_author;
  const chapterInput = el('input', { type: 'text', placeholder: 'optional', oninput: (e) => { v.chapter = e.target.value; } }); chapterInput.value = v.chapter;
  const refInput = el('input', { type: 'text', placeholder: 'optional', oninput: (e) => { v.source_reference = e.target.value; } }); refInput.value = v.source_reference;
  const urlInput = el('input', { type: 'url', placeholder: 'https://…', oninput: (e) => { v.source_url = e.target.value; } }); urlInput.value = v.source_url;
  const tagsInput = el('input', { type: 'text', placeholder: 'e.g. favorite, leadership', oninput: (e) => { v.tags = e.target.value; } }); tagsInput.value = v.tags;

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add highlight' : 'Save');
  const wrap = el('div', {},
    field('Highlight text (required)', textInput),
    field('Book', bookSel),
    el('div', { class: 'row' }, field('Source type', sourceSel), field('Page / location', pageInput)),
    field('Author (overrides book author)', authorInput),
    el('div', { class: 'row' }, field('Chapter', chapterInput), field('Source title', refInput)),
    field('Source URL', urlInput),
    field('Tags (comma-separated)', tagsInput),
    el('div', { class: 'form-actions' }, save, isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete quote…')),
  );

  async function onSave() {
    if (!v.text.trim()) { toast('Add the highlight text first.', 'err'); return; }
    save.disabled = true;
    const payload = {
      text: v.text.trim(), book_id: v.book_id || null, source_type: v.source_type || null,
      source_author: v.source_author.trim() || null, source_reference: v.source_reference.trim() || null,
      source_url: v.source_url.trim() || null,
      page_number: v.page_number.trim() ? Number(v.page_number.trim()) : null,
      chapter: v.chapter.trim() || null,
      tags: v.tags.trim() ? v.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    };
    const res = isNew ? await sb.from('quotes').insert(payload).select('id').single() : await sb.from('quotes').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Added' : 'Saved');
    closeSheet();
    go(isNew ? `#/library/quotes/${res.data.id}` : `#/library/quotes/${row.id}`);
  }
  async function onDelete() {
    if (!confirmDelete('this quote and all thoughts on it')) return;
    await sb.from('quote_annotations').delete().eq('quote_id', row.id);
    const { error } = await sb.from('quotes').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    closeSheet();
    go('#/library/quote');
  }
  return wrap;
}

export async function quoteNew(mount, { bookId } = {}) {
  if (bookId) {
    const preset = ref.books.find((b) => b.id === bookId);
    mount.replaceChildren(el('div', { class: 'lib-reader' },
      crumb('Book', () => go(`#/library/books/${bookId}`)),
      el('header', { class: 'screen-head', style: 'padding:16px 0 20px' }, el('div', { class: 'eyebrow' }, 'Library'), el('h1', {}, 'Add highlight')),
      quoteForm({ book_id: bookId, source_type: 'book', source_author: preset?.author ?? '' }),
    ));
    return;
  }
  mount.replaceChildren(el('div', { class: 'lib-reader' },
    crumb('Quotes', () => go('#/library/quote')),
    el('header', { class: 'screen-head', style: 'padding:16px 0 20px' }, el('div', { class: 'eyebrow' }, 'Library'), el('h1', {}, 'Add highlight')),
    quoteForm(null),
  ));
}

// ─── Journal ────────────────────────────────────────────────────────────────

export async function journalDetail(mount, { id }) {
  mount.replaceChildren(spinner());
  const { data: entry, error } = await sb.from('journal_entries').select('*').eq('id', id).single();
  if (error) { mount.lastChild.replaceWith(hint(error.message)); return; }

  const [prevR, nextR] = await Promise.all([
    sb.from('journal_entries').select('id, entry_date').lt('entry_date', entry.entry_date).order('entry_date', { ascending: false }).limit(1).maybeSingle(),
    sb.from('journal_entries').select('id, entry_date').gt('entry_date', entry.entry_date).order('entry_date', { ascending: true }).limit(1).maybeSingle(),
  ]);
  const prev = prevR.data ?? null;
  const next = nextR.data ?? null;

  function refresh() { journalDetail(mount, { id }); }

  const body = (entry.transcription_text ?? '').trim();
  const sourceLabel = entry.source !== 'typed' ? `via ${entry.source.replace(/_/g, ' ')}` : null;
  const fmtFull = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmtShort = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const dayNav = (prev || next) ? el('nav', { style: 'display:flex; align-items:center; justify-content:space-between; gap:16px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' },
    prev ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/library/journal/${prev.id}`) }, `‹ ${fmtShort(prev.entry_date)}`) : el('span', {}),
    next ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/library/journal/${next.id}`) }, `${fmtShort(next.entry_date)} ›`) : el('span', {}),
  ) : null;

  mount.replaceChildren(el('div', { class: 'lib-reader' },
    crumb('Journal', () => go('#/library/journal')),
    dayNav ? el('div', { style: 'margin-top:10px; margin-bottom:22px' }, dayNav) : null,
    el('div', { class: 'lib-reader-eyebrow' }, `Journal${sourceLabel ? ` · ${sourceLabel}` : ''}`),
    el('h1', { class: 'lib-reader-title', style: 'font-size:30px' }, fmtFull(entry.entry_date)),
    body ? el('div', { class: 'lib-reader-body' }, body) : null,
    (entry.attachments ?? []).length > 0 ? el('div', { style: `margin-top:${body ? 28 : 24}px` }, photoGallery(entry.attachments)) : null,
    (!body && (entry.attachments ?? []).length === 0) ? el('p', { style: 'margin-top:24px; font-family:var(--sans); font-size:14px; font-style:italic; color:var(--ink-3)' }, 'An empty entry — add a note from Edit.') : null,
    el('div', { class: 'lib-reader-footer' },
      el('div', { style: 'display:flex; align-items:center; gap:10px' }, el('span', { class: 'eyebrow' }, 'Resurfacing'), boostButton('journal', entry.id, entry.resurface_weight, refresh)),
      editLink('Edit entry', journalForm(entry)),
    ),
    dayNav ? el('div', { style: 'margin-top:22px' }, dayNav) : null,
  ));
}

function journalForm(row) {
  const isNew = !row?.id;
  const v = { entry_date: row?.entry_date ?? new Date().toISOString().slice(0, 10), transcription_text: row?.transcription_text ?? '' };
  const dateInput = el('input', { type: 'date', oninput: (e) => { v.entry_date = e.target.value; } }); dateInput.value = v.entry_date;
  const bodyInput = el('textarea', { rows: 9, placeholder: "What's on your mind?", oninput: (e) => { v.transcription_text = e.target.value; } }); bodyInput.value = v.transcription_text;

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Save entry' : 'Save');
  const wrap = el('div', {},
    field('Date', dateInput),
    field('Entry', bodyInput),
    (row && (row.attachments ?? []).length > 0) ? el('p', { class: 'hint' }, `${row.attachments.length} photo${row.attachments.length === 1 ? '' : 's'} attached — add more from the capture flow.`) : null,
    el('div', { class: 'form-actions' }, save, isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete entry…')),
  );

  async function onSave() {
    save.disabled = true;
    const payload = { entry_date: v.entry_date, transcription_text: v.transcription_text.trim() || null };
    const res = isNew ? await sb.from('journal_entries').insert({ ...payload, source: 'typed' }).select('id').single() : await sb.from('journal_entries').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Saved' : 'Saved');
    closeSheet();
    go(isNew ? `#/library/journal/${res.data.id}` : `#/library/journal/${row.id}`);
  }
  async function onDelete() {
    if (!confirmDelete('this journal entry')) return;
    const { error } = await sb.from('journal_entries').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    closeSheet();
    go('#/library/journal');
  }
  return wrap;
}

export async function journalNew(mount) {
  mount.replaceChildren(el('div', { class: 'lib-reader' },
    crumb('Journal', () => go('#/library/journal')),
    el('header', { class: 'screen-head', style: 'padding:16px 0 20px' }, el('div', { class: 'eyebrow' }, 'Library'), el('h1', {}, 'New entry')),
    journalForm(null),
  ));
}

// ─── Books ──────────────────────────────────────────────────────────────────

const BOOK_STATUS_LABELS_FULL = { want_to_read: 'Want to read', reading: 'Reading', finished: 'Finished', abandoned: 'Abandoned' };
const BOOK_FORMAT_LABELS = { physical: 'Physical', kindle: 'Kindle', audiobook: 'Audiobook' };

export async function bookDetail(mount, { id }) {
  mount.replaceChildren(spinner());
  const [bookR, quotesR] = await Promise.all([
    sb.from('books').select('*').eq('id', id).single(),
    sb.from('quotes').select('*').eq('book_id', id).order('created_at', { ascending: false }),
  ]);
  if (bookR.error) { mount.lastChild.replaceWith(hint(bookR.error.message)); return; }
  const book = bookR.data;
  const quotes = quotesR.data ?? [];

  const quoteIds = quotes.map((q) => q.id);
  let annotCounts = new Map();
  if (quoteIds.length) {
    const { data: annots } = await sb.from('quote_annotations').select('quote_id').in('quote_id', quoteIds);
    for (const a of annots ?? []) annotCounts.set(a.quote_id, (annotCounts.get(a.quote_id) ?? 0) + 1);
  }

  const fmt = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const dateRange = [book.started_at ? `Started ${fmt(book.started_at)}` : null, book.finished_at ? `Finished ${fmt(book.finished_at)}` : null].filter(Boolean).join(' · ');
  const tint = coverTint(book.title);

  const highlights = quotes.length === 0
    ? el('p', { style: 'font-family:var(--sans); font-size:13px; font-style:italic; color:var(--ink-3)' }, 'No highlights harvested from this book yet.')
    : el('div', { style: 'display:flex; flex-direction:column; gap:22px' }, ...quotes.map((q) => {
        const parts = [];
        if (q.page_number != null) parts.push(`Location ${q.page_number}`);
        if ((q.tags ?? []).length) parts.push(q.tags.map((t) => `#${t}`).join(' '));
        const ac = annotCounts.get(q.id) ?? 0;
        if (ac > 0) parts.push(`${ac} thought${ac === 1 ? '' : 's'}`);
        return el('button', { class: 'lib-card-link', type: 'button', style: 'border-left:2px solid var(--line); padding-left:14px', onclick: () => go(`#/library/quotes/${q.id}`) },
          el('p', { style: 'font-family:var(--serif); font-size:15px; font-style:italic; line-height:1.5; color:var(--ink)' }, `“${q.text}”`),
          parts.length ? el('div', { style: 'margin-top:8px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, parts.join(' · ')) : null,
        );
      }));

  mount.replaceChildren(el('div', { class: 'lib-reader wide' },
    crumb('Books', () => go('#/library/book')),
    el('div', { style: 'margin-top:14px; display:flex; gap:24px; flex-wrap:wrap' },
      book.cover_image_url
        ? el('img', { src: book.cover_image_url, alt: book.title, style: 'width:150px; height:auto; border:1px solid var(--line); flex:0 0 auto' })
        : el('div', { style: `width:150px; aspect-ratio:2/3; border:1px solid var(--line); flex:0 0 auto; display:flex; align-items:flex-start; padding:14px; background:${tint.bg}; color:${tint.fg}` },
            el('span', { style: 'font-family:var(--serif); font-size:14px; line-height:1.25' }, book.title)),
      el('div', { style: 'flex:1; min-width:220px' },
        el('div', { class: 'lib-reader-eyebrow' }, 'Book'),
        el('h1', { class: 'lib-reader-title', style: 'font-size:26px' }, book.title),
        book.author ? el('div', { style: 'margin-top:6px; font-family:var(--serif); font-size:15px; font-style:italic; color:var(--ink-2)' }, book.author) : null,
        el('div', { style: 'margin-top:14px; display:flex; flex-direction:column; gap:5px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' },
          el('div', {}, `${BOOK_STATUS_LABELS_FULL[book.status] ?? book.status}${book.format ? ` · ${BOOK_FORMAT_LABELS[book.format] ?? book.format}` : ''}`),
          dateRange ? el('div', {}, dateRange) : null,
          book.rating != null ? el('div', { style: 'color:var(--accent); letter-spacing:0.15em' }, '★'.repeat(book.rating) + '☆'.repeat(Math.max(0, 5 - book.rating))) : null,
        ),
        book.my_summary ? el('div', { style: 'margin-top:18px' }, sectionLabel('My summary'), el('p', { style: 'margin-top:6px; font-family:var(--serif); font-size:15px; line-height:1.6; color:var(--ink-2); white-space:pre-wrap' }, book.my_summary)) : null,
        el('div', { style: 'margin-top:18px' }, editLink('Edit book', bookForm(book))),
      ),
    ),
    el('section', { style: 'margin-top:40px; padding-top:20px; border-top:1px solid var(--line)' },
      sectionLabel(`Highlights${quotes.length ? ` · ${quotes.length}` : ''}`,
        el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/library/quotes/new/${book.id}`) }, '+ Add highlight')),
      el('div', { style: 'margin-top:16px' }, highlights),
    ),
  ));
}

function bookForm(row) {
  const isNew = !row?.id;
  const v = {
    title: row?.title ?? '', author: row?.author ?? '', isbn: row?.isbn ?? '', cover_image_url: row?.cover_image_url ?? '',
    status: row?.status ?? 'want_to_read', format: row?.format ?? '', started_at: row?.started_at ?? '', finished_at: row?.finished_at ?? '',
    rating: row?.rating ?? '', my_summary: row?.my_summary ?? '',
  };
  const titleInput = el('input', { type: 'text', required: true, oninput: (e) => { v.title = e.target.value; } }); titleInput.value = v.title;
  const authorInput = el('input', { type: 'text', oninput: (e) => { v.author = e.target.value; } }); authorInput.value = v.author;
  const coverInput = el('input', { type: 'url', placeholder: 'https://…', oninput: (e) => { v.cover_image_url = e.target.value; } }); coverInput.value = v.cover_image_url;
  const statusSel = el('select', { onchange: (e) => { v.status = e.target.value; } });
  for (const [val, label] of Object.entries(BOOK_STATUS_LABELS_FULL)) statusSel.append(el('option', { value: val }, label));
  statusSel.value = v.status;
  const formatSel = el('select', { onchange: (e) => { v.format = e.target.value; } });
  formatSel.append(el('option', { value: '' }, '(none)'));
  for (const [val, label] of Object.entries(BOOK_FORMAT_LABELS)) formatSel.append(el('option', { value: val }, label));
  formatSel.value = v.format;
  const startedInput = el('input', { type: 'date', oninput: (e) => { v.started_at = e.target.value; } }); startedInput.value = v.started_at;
  const finishedInput = el('input', { type: 'date', oninput: (e) => { v.finished_at = e.target.value; } }); finishedInput.value = v.finished_at;
  const ratingSel = el('select', { onchange: (e) => { v.rating = e.target.value; } });
  ratingSel.append(el('option', { value: '' }, '(no rating)'));
  for (let n = 1; n <= 5; n++) ratingSel.append(el('option', { value: String(n) }, `${n} / 5`));
  ratingSel.value = v.rating === '' ? '' : String(v.rating);
  const isbnInput = el('input', { type: 'text', placeholder: 'optional', oninput: (e) => { v.isbn = e.target.value; } }); isbnInput.value = v.isbn;
  const summaryInput = el('textarea', { rows: 4, oninput: (e) => { v.my_summary = e.target.value; } }); summaryInput.value = v.my_summary;

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add book' : 'Save');
  const wrap = el('div', {},
    field('Title (required)', titleInput),
    field('Author', authorInput),
    field('Cover image URL', coverInput),
    el('div', { class: 'row' }, field('Status', statusSel), field('Format', formatSel)),
    el('div', { class: 'row' }, field('Started', startedInput), field('Finished', finishedInput)),
    field('Rating (1-5, blank for none)', ratingSel),
    field('ISBN', isbnInput),
    field('My summary / notes', summaryInput),
    el('div', { class: 'form-actions' }, save, isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete book…')),
  );

  async function onSave() {
    if (!v.title.trim()) { toast('Title is required.', 'err'); return; }
    save.disabled = true;
    const payload = {
      title: v.title.trim(), author: v.author.trim() || null, isbn: v.isbn.trim() || null,
      cover_image_url: v.cover_image_url.trim() || null, status: v.status, format: v.format || null,
      started_at: v.started_at || null, finished_at: v.finished_at || null,
      rating: v.rating === '' ? null : Number(v.rating), my_summary: v.my_summary.trim() || null,
    };
    const res = isNew ? await sb.from('books').insert(payload).select('id').single() : await sb.from('books').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Added' : 'Saved');
    closeSheet();
    go(isNew ? `#/library/books/${res.data.id}` : `#/library/books/${row.id}`);
  }
  async function onDelete() {
    if (!confirmDelete(`"${row.title}" — highlights stay, just unlinked`)) return;
    const { error } = await sb.from('books').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    closeSheet();
    go('#/library/book');
  }
  return wrap;
}

export async function bookNew(mount) {
  mount.replaceChildren(el('div', { class: 'lib-reader' },
    crumb('Books', () => go('#/library/book')),
    el('header', { class: 'screen-head', style: 'padding:16px 0 20px' }, el('div', { class: 'eyebrow' }, 'Library'), el('h1', {}, 'Add book')),
    bookForm(null),
  ));
}
