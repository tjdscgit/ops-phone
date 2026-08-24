// Supabase access. Every table has RLS requiring a signed-in user and the
// policies are all `authenticated / USING (true)`, so once logged in the
// client can read and write anything directly — no API layer in between.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.OPS_CONFIG;
export const sb = createClient(cfg.supabaseUrl, cfg.supabaseKey);
export { cfg };

// ─── Reference data ──────────────────────────────────────────────────────
// Domains, projects and people are used as foreign-key pickers all over the
// app. They're small, they change rarely, and re-fetching them on every view
// change makes navigation feel sticky — so they're loaded once at boot and
// refreshed only when something writes to them.

export const ref = {
  domains: [],
  inbox: null,
  projects: [],
  people: [],
  companies: [],
  books: [],
  journalBooks: [],
  contentItems: [],
  milestones: [],
};

export async function loadRef() {
  const [domains, projects, people, companies, books, journalBooks, contentItems, milestones] =
    await Promise.all([
      sb.from('stewardship_domains').select('id, name, is_system, active').order('name'),
      sb.from('projects').select('id, name, status').order('name'),
      sb.from('people').select('id, name').order('name'),
      sb.from('companies').select('id, name').order('name'),
      sb.from('books').select('id, title, author').order('title'),
      sb.from('journal_books').select('id, book_number').order('book_number'),
      sb.from('content_items').select('id, title, status').order('title'),
      sb.from('milestones').select('id, title, project_id').order('title'),
    ]);

  const all = domains.data ?? [];
  // Inbox is the system domain. It's kept aside rather than listed with the
  // rest because tasks.domain_id is NOT NULL, so "no folder chosen" has to
  // fall back to something concrete.
  ref.inbox = all.find((d) => d.is_system) ?? null;
  ref.domains = all.filter((d) => !d.is_system);

  ref.projects = projects.data ?? [];
  ref.people = people.data ?? [];
  ref.companies = companies.data ?? [];
  ref.books = books.data ?? [];
  ref.journalBooks = journalBooks.data ?? [];
  ref.contentItems = contentItems.data ?? [];
  ref.milestones = milestones.data ?? [];
}

// Tables whose rows appear in the pickers above. After writing to one of
// these the cached list is stale, so the engine calls this.
const REF_TABLES = new Set([
  'stewardship_domains', 'projects', 'people', 'companies',
  'books', 'journal_books', 'content_items', 'milestones',
]);

export const isRefTable = (table) => REF_TABLES.has(table);

// ─── Option lists for foreign-key fields ─────────────────────────────────

export const refOptions = {
  domain: () => ref.domains.map((d) => ({ value: d.id, label: d.name })),
  domainWithInbox: () => [
    ref.inbox ? { value: ref.inbox.id, label: 'Inbox' } : null,
    ...ref.domains.map((d) => ({ value: d.id, label: d.name })),
  ].filter(Boolean),
  project: () => ref.projects.map((p) => ({ value: p.id, label: p.name })),
  person: () => ref.people.map((p) => ({ value: p.id, label: p.name })),
  company: () => ref.companies.map((c) => ({ value: c.id, label: c.name })),
  book: () => ref.books.map((b) => ({ value: b.id, label: b.title })),
  journalBook: () =>
    ref.journalBooks.map((b) => ({ value: b.id, label: `Book ${b.book_number ?? '?'}` })),
  contentItem: () => ref.contentItems.map((c) => ({ value: c.id, label: c.title })),
  milestone: () => ref.milestones.map((m) => ({ value: m.id, label: m.title })),
};

// Resolve a foreign key to its display name, for list metadata.
export function refName(kind, id) {
  if (!id) return '';
  const found = (refOptions[kind]?.() ?? []).find((o) => o.value === id);
  return found?.label ?? '';
}
