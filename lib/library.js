// Library — data layer. A port of apps/web's library/lib-data.ts: normalizes
// notes + quotes + journal entries into one merged, newest-first feed for the
// unified /library view, plus the books shelf's sort/tint/badge helpers.
// Runs client-side against Supabase directly — nothing here needs a secret.

import { sb } from './db.js';

export const LIB_TYPES = [
  { value: 'all', label: 'Everything' },
  { value: 'note', label: 'Notes' },
  { value: 'quote', label: 'Quotes' },
  { value: 'journal', label: 'Journal' },
  { value: 'book', label: 'Books' },
];

export const NOTE_SOURCE_ORDER = ['own_thought', 'reading_response', 'meeting_note', 'brainstorm', 'observation', 'other'];
export const NOTE_SOURCE_LABEL = {
  own_thought: 'Own', reading_response: 'Reading', meeting_note: 'Meeting',
  brainstorm: 'Brainstorm', observation: 'Observation', other: 'Other',
};

export const QUOTE_SOURCE_ORDER = ['book', 'article', 'podcast', 'sermon', 'video', 'conversation', 'other'];
export const QUOTE_SOURCE_LABEL = {
  book: 'Book', article: 'Article', podcast: 'Podcast', sermon: 'Sermon',
  video: 'Video', conversation: 'Conversation', other: 'Other',
};

export const BOOK_STATUS_ORDER = ['want_to_read', 'reading', 'finished', 'abandoned'];
export const BOOK_STATUS_LABEL = { want_to_read: 'Want', reading: 'Reading', finished: 'Finished', abandoned: 'Abandoned' };
export const BOOK_STATUS_PILL = { want_to_read: 'quiet', reading: 'due', finished: 'ok', abandoned: 'over' };

export const BOOK_SORTS = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'finished_desc', label: 'Finished' },
  { value: 'rating_desc', label: 'Rating' },
  { value: 'recent', label: 'Recent' },
];

function surnameKey(name) {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toLowerCase();
}

// Exact port of library-view.tsx's sortBooks: nulls sink to the bottom,
// title breaks every tie.
export function sortBooks(a, b, key) {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'author': {
      const aa = (a.author ?? '').trim();
      const bb = (b.author ?? '').trim();
      if (!aa && !bb) return a.title.localeCompare(b.title);
      if (!aa) return 1;
      if (!bb) return -1;
      return surnameKey(aa).localeCompare(surnameKey(bb)) || a.title.localeCompare(b.title);
    }
    case 'finished_desc': {
      const aa = a.finished_at ?? '';
      const bb = b.finished_at ?? '';
      if (!aa && !bb) return a.title.localeCompare(b.title);
      if (!aa) return 1;
      if (!bb) return -1;
      return bb.localeCompare(aa);
    }
    case 'rating_desc': {
      const aa = a.rating ?? -1;
      const bb = b.rating ?? -1;
      if (aa === bb) return a.title.localeCompare(b.title);
      return bb - aa;
    }
    case 'recent':
      return b.created_at.localeCompare(a.created_at);
    default:
      return 0;
  }
}

export function bookBadge(b, sort) {
  if (sort === 'rating_desc' && b.rating) return '★'.repeat(b.rating);
  if (sort === 'finished_desc' && b.finished_at) return b.finished_at.slice(0, 7);
  return null;
}

// A muted, deterministic cover tint for books with no cover image.
const COVER_TINTS = [
  { bg: '#2F5D8A', fg: '#EAF1F8' },
  { bg: '#6B5B95', fg: '#F0ECF6' },
  { bg: '#3B6A52', fg: '#E9F2ED' },
  { bg: '#A8763E', fg: '#F8EFE3' },
  { bg: '#8A4B3C', fg: '#F7EAE5' },
  { bg: '#4A6B70', fg: '#E9F1F2' },
  { bg: '#8A6A2F', fg: '#F6EEDE' },
];
export function coverTint(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return COVER_TINTS[h % COVER_TINTS.length];
}

// ─── Date labels ─────────────────────────────────────────────────────────
// The dashboard fetches the app timezone server-side; the phone just uses
// the device's own clock, like the rest of this app (see ui.js's niceDate).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function tsDateLabel(iso) {
  const d = new Date(iso);
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

// A bare YYYY-MM-DD (journal entry_date) parsed at LOCAL midnight — parsing
// it as an instant then formatting in another zone is the classic off-by-one
// that would put journal entries on the wrong day.
export function dateOnlyLabel(ymd) {
  const d = new Date(`${ymd}T00:00:00`);
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

// First image attachment (notes + journal carry a jsonb attachments array;
// quotes don't). A missing content_type is treated as an image, matching
// what the upload pipeline actually stores.
function pickImages(atts) {
  const imgs = (atts ?? []).filter((a) => a.url && (!a.content_type || a.content_type.startsWith('image')));
  return { image: imgs[0]?.url ?? null, count: imgs.length };
}

// Merge notes + quotes + journal into one normalized, newest-first feed —
// the same shape library-view.tsx's masonry grid renders.
export function buildEntries(notes, quotes, journal) {
  const out = [];
  for (const n of notes) {
    const { image, count } = pickImages(n.attachments);
    out.push({
      kind: 'note', id: n.id, sortAt: n.created_at, dateLabel: tsDateLabel(n.created_at),
      title: n.title, body: n.body, source: n.source_type ?? null, who: null, book: null,
      tags: n.tags ?? [], needsReview: !!n.needs_review, image, photoCount: count,
      href: `#/library/notes/${n.id}`,
    });
  }
  for (const q of quotes) {
    out.push({
      kind: 'quote', id: q.id, sortAt: q.created_at, dateLabel: tsDateLabel(q.created_at),
      title: null, body: q.text, source: q.source_type ?? null, who: q.source_author ?? null,
      book: q.book?.title ?? null, tags: q.tags ?? [], needsReview: false, image: null, photoCount: 0,
      href: `#/library/quotes/${q.id}`,
    });
  }
  for (const j of journal) {
    const { image, count } = pickImages(j.attachments);
    out.push({
      kind: 'journal', id: j.id, sortAt: `${j.entry_date}T12:00:00.000Z`, dateLabel: dateOnlyLabel(j.entry_date),
      title: null, body: j.transcription_text ?? '', source: null, who: null, book: null,
      tags: [], needsReview: false, image, photoCount: count, href: `#/library/journal/${j.id}`,
    });
  }
  out.sort((a, b) => b.sortAt.localeCompare(a.sortAt));
  return out;
}

// Fetch to the same hard ceiling library-view.tsx uses, so the facet rail
// sees the whole corpus rather than just the newest page.
const LIMIT = 2000;

export async function loadLibraryData() {
  const [notesR, quotesR, journalR, booksR] = await Promise.all([
    sb.from('notes').select('*').order('created_at', { ascending: false }).limit(LIMIT),
    sb.from('quotes').select('*, book:books(id,title,author,cover_image_url)').order('created_at', { ascending: false }).limit(LIMIT),
    sb.from('journal_entries').select('*').order('entry_date', { ascending: false }).limit(LIMIT),
    sb.from('books').select('*').order('title', { ascending: true }),
  ]);
  const notes = notesR.data ?? [];
  const quotes = quotesR.data ?? [];
  const journal = journalR.data ?? [];
  const books = booksR.data ?? [];

  // books carries no quote_count column — the dashboard's API computes it
  // server-side; here it's a cheap client-side tally from the quotes above.
  const countByBook = new Map();
  for (const q of quotes) if (q.book_id) countByBook.set(q.book_id, (countByBook.get(q.book_id) ?? 0) + 1);
  for (const b of books) b.quote_count = countByBook.get(b.id) ?? 0;

  return { entries: buildEntries(notes, quotes, journal), books };
}
