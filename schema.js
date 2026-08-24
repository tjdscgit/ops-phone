// Descriptors for every collection the app can browse and edit.
//
// Most of this app is the same shape repeated: a list of rows, a form to add
// or edit one, and a delete. Rather than write that fifteen times, each area
// is described here and rendered by lib/engine.js. Areas that need real
// interaction — Today, Tasks, Routines — are hand-built in views/ instead.
//
// Every `chips` field's options are copied from the table's CHECK constraint.
// Inventing a value that isn't in the constraint fails the insert at the
// database, so these lists are not decorative — keep them in step with the
// schema.

import { refName } from './lib/db.js';
import { niceDate, niceStamp, humanise } from './lib/ui.js';

// Assembles list metadata: drops empties, joins the rest with a separator.
const meta = (...parts) => parts.filter(Boolean).join(' · ');

export const SCHEMA = {

  // ── Projects ───────────────────────────────────────────────────────────
  projects: {
    key: 'projects',
    table: 'projects',
    label: 'Projects',
    singular: 'project',
    order: { col: 'name', asc: true },
    search: ['name', 'description'],
    filters: [
      { label: 'Active', apply: (q) => q.eq('status', 'active') },
      { label: 'All', apply: (q) => q },
      { label: 'Done', apply: (q) => q.eq('status', 'done') },
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, primary: true },
      { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
      { name: 'domain_id', label: 'Folder', type: 'ref', ref: 'domain' },
      { name: 'status', label: 'Status', type: 'chips', options: ['active', 'paused', 'done', 'archived'] },
      { name: 'kind', label: 'Kind', type: 'chips', options: ['project', 'area'] },
      { name: 'type', label: 'Type', type: 'chips', options: ['client', 'internal', 'content'] },
      { name: 'engagement_type', label: 'Engagement', type: 'chips', options: ['project', 'retainer'] },
      { name: 'primary_contact_id', label: 'Primary contact', type: 'ref', ref: 'person' },
      { name: 'company_id', label: 'Company', type: 'ref', ref: 'company' },
      { name: 'start_date', label: 'Start date', type: 'date' },
      { name: 'target_date', label: 'Target date', type: 'date' },
      { name: 'quoted_hours', label: 'Quoted hours', type: 'number' },
      { name: 'hours_logged', label: 'Hours logged', type: 'number' },
    ],
    title: (r) => r.name,
    meta: (r) => meta(humanise(r.status), refName('domain', r.domain_id),
      r.target_date && `due ${niceDate(r.target_date)}`),
    children: [
      {
        key: 'milestones', table: 'milestones', fk: 'project_id',
        label: 'Milestones', singular: 'milestone',
        order: { col: 'position', asc: true },
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, primary: true },
          { name: 'status', label: 'Status', type: 'chips', options: ['open', 'done'] },
          { name: 'weight', label: 'Weight', type: 'number', min: 1 },
          { name: 'position', label: 'Position', type: 'number' },
        ],
        title: (r) => r.title,
        meta: (r) => meta(humanise(r.status), r.weight && `weight ${r.weight}`),
      },
      {
        key: 'checklist', table: 'project_checklist_items', fk: 'project_id',
        label: 'Checklist', singular: 'checklist item',
        order: { col: 'position', asc: true },
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, primary: true },
          { name: 'done', label: 'Done', type: 'bool' },
          { name: 'recurrence_rule', label: 'Repeats', type: 'chips',
            options: ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'] },
          { name: 'position', label: 'Position', type: 'number' },
        ],
        title: (r) => r.title,
        meta: (r) => meta(r.done && 'done', humanise(r.recurrence_rule)),
      },
    ],
  },

  // ── Notes ──────────────────────────────────────────────────────────────
  notes: {
    key: 'notes',
    table: 'notes',
    label: 'Notes',
    singular: 'note',
    order: { col: 'created_at', asc: false },
    search: ['title', 'body'],
    filters: [
      { label: 'All', apply: (q) => q },
      { label: 'Needs review', apply: (q) => q.eq('needs_review', true) },
    ],
    fields: [
      { name: 'body', label: 'Note', type: 'textarea', rows: 8, required: true, primary: true },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'source_type', label: 'Kind', type: 'chips',
        options: ['own_thought', 'reading_response', 'meeting_note', 'brainstorm', 'observation', 'other'] },
      { name: 'tags', label: 'Tags', type: 'tags' },
      { name: 'related_project_id', label: 'Project', type: 'ref', ref: 'project' },
      { name: 'related_person_id', label: 'Person', type: 'ref', ref: 'person' },
      { name: 'source_reference', label: 'Source reference', type: 'text' },
      { name: 'needs_review', label: 'Needs review', type: 'bool' },
    ],
    // Notes are often a body with no title, so fall back to the first line.
    title: (r) => r.title || String(r.body || '').split('\n')[0].slice(0, 80) || '(empty)',
    meta: (r) => meta(niceDate(r.created_at), humanise(r.source_type),
      r.needs_review && 'needs review', (r.tags || []).join(', ')),
  },

  // ── Inbox / captured data ──────────────────────────────────────────────
  captured: {
    key: 'captured',
    table: 'captured_data',
    label: 'Inbox',
    singular: 'captured item',
    order: { col: 'created_at', asc: false },
    filters: [
      { label: 'Unprocessed', apply: (q) => q.in('processed_status', ['raw', 'parsed']) },
      { label: 'All', apply: (q) => q },
    ],
    fields: [
      { name: 'payload', label: 'Content', type: 'json', rows: 6, required: true, primary: true },
      { name: 'type', label: 'Type', type: 'text', required: true },
      { name: 'source', label: 'Source', type: 'chips',
        options: ['manual', 'zapier', 'cowork', 'n8n', 'webhook', 'smart_glasses', 'watch', 'other'] },
      { name: 'processed_status', label: 'Status', type: 'chips',
        options: ['raw', 'parsed', 'displayed', 'archived'] },
      { name: 'display_hint', label: 'Display as', type: 'chips', options: ['card', 'log', 'hidden'] },
      { name: 'tags', label: 'Tags', type: 'tags' },
    ],
    defaults: { source: 'manual', type: 'note', processed_status: 'raw' },
    title: (r) => {
      const p = r.payload;
      if (p && typeof p === 'object') return p.text || p.title || p.body || r.type;
      return String(p ?? r.type).slice(0, 80);
    },
    meta: (r) => meta(niceDate(r.created_at), r.source, humanise(r.processed_status)),
  },

  // ── Calendar ───────────────────────────────────────────────────────────
  calendar: {
    key: 'calendar',
    table: 'calendar_events',
    label: 'Calendar',
    singular: 'event',
    order: { col: 'start_at', asc: true },
    search: ['title', 'location'],
    filters: [
      // Default hides the past: an agenda is about what's coming. The 12-hour
      // grace window keeps this morning's events visible this afternoon.
      { label: 'Upcoming', apply: (q) => q.gte('start_at', new Date(Date.now() - 12 * 3600e3).toISOString()) },
      { label: 'All', apply: (q) => q },
    ],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, primary: true },
      { name: 'start_at', label: 'Starts', type: 'datetime', required: true, default: 'now' },
      { name: 'end_at', label: 'Ends', type: 'datetime', required: true },
      { name: 'all_day', label: 'All day', type: 'bool' },
      { name: 'location', label: 'Location', type: 'text' },
      { name: 'description', label: 'Description', type: 'textarea', rows: 4 },
    ],
    // Events created here are tagged so a future Google sync can tell which
    // rows it owns and which it must not overwrite.
    defaults: { source: 'created_here' },
    title: (r) => r.title,
    meta: (r) => meta(r.all_day ? niceDate(r.start_at) : niceStamp(r.start_at), r.location),
  },

  // ── People ─────────────────────────────────────────────────────────────
  people: {
    key: 'people',
    table: 'people',
    label: 'People',
    singular: 'person',
    order: { col: 'name', asc: true },
    search: ['name', 'email', 'company'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, primary: true },
      { name: 'relationship_type', label: 'Relationship', type: 'chips',
        options: ['client', 'family', 'church', 'friend', 'team', 'vendor', 'other'] },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'company_id', label: 'Company', type: 'ref', ref: 'company' },
      { name: 'role_at_company', label: 'Role', type: 'text' },
      { name: 'birthday', label: 'Birthday', type: 'date' },
      { name: 'anniversary', label: 'Anniversary', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
    ],
    title: (r) => r.name,
    meta: (r) => meta(humanise(r.relationship_type), refName('company', r.company_id) || r.company),
    children: [
      {
        key: 'facts', table: 'person_facts', fk: 'person_id',
        label: 'Facts', singular: 'fact',
        order: { col: 'created_at', asc: false },
        fields: [
          { name: 'fact_value', label: 'Fact', type: 'textarea', rows: 2, required: true, primary: true },
          { name: 'fact_type', label: 'Type', type: 'chips',
            options: ['birthday', 'anniversary', 'kid_name', 'shared', 'follow_up', 'other'] },
          { name: 'date_relevant', label: 'Date', type: 'date' },
          { name: 'recurring', label: 'Recurring', type: 'bool' },
        ],
        title: (r) => r.fact_value,
        meta: (r) => meta(humanise(r.fact_type), niceDate(r.date_relevant)),
      },
      {
        key: 'interactions', table: 'person_interactions', fk: 'person_id',
        label: 'Interactions', singular: 'interaction',
        order: { col: 'occurred_at', asc: false },
        fields: [
          { name: 'subject', label: 'Subject', type: 'text', primary: true },
          { name: 'body', label: 'What happened', type: 'textarea', rows: 4 },
          { name: 'interaction_type', label: 'Type', type: 'chips',
            options: ['call', 'email', 'in_person', 'text', 'meeting', 'other'] },
          { name: 'direction', label: 'Direction', type: 'chips',
            options: ['inbound', 'outbound', 'internal'] },
          { name: 'occurred_at', label: 'When', type: 'datetime', default: 'now' },
        ],
        defaults: { captured_via: 'manual' },
        title: (r) => r.subject || humanise(r.interaction_type) || 'Interaction',
        meta: (r) => meta(niceStamp(r.occurred_at), humanise(r.direction)),
      },
    ],
  },

  // ── Companies ──────────────────────────────────────────────────────────
  companies: {
    key: 'companies',
    table: 'companies',
    label: 'Companies',
    singular: 'company',
    order: { col: 'name', asc: true },
    search: ['name', 'primary_email'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, primary: true },
      { name: 'relationship_type', label: 'Relationship', type: 'chips',
        options: ['active_client', 'past_client', 'prospect', 'vendor', 'partner', 'brand_deal', 'other'] },
      { name: 'domain_id', label: 'Folder', type: 'ref', ref: 'domain' },
      { name: 'website', label: 'Website', type: 'url' },
      { name: 'primary_email', label: 'Email', type: 'email' },
      { name: 'primary_phone', label: 'Phone', type: 'tel' },
      { name: 'checkin_interval_days', label: 'Check in every (days)', type: 'number', min: 1 },
      { name: 'next_review_at', label: 'Next review', type: 'date' },
      { name: 'active', label: 'Active', type: 'bool', default: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
    ],
    title: (r) => r.name,
    meta: (r) => meta(humanise(r.relationship_type), r.next_review_at && `review ${niceDate(r.next_review_at)}`),
  },

  // ── Library: books ─────────────────────────────────────────────────────
  books: {
    key: 'books',
    table: 'books',
    label: 'Books',
    singular: 'book',
    order: { col: 'title', asc: true },
    search: ['title', 'author'],
    filters: [
      { label: 'Reading', apply: (q) => q.eq('status', 'reading') },
      { label: 'All', apply: (q) => q },
      { label: 'Finished', apply: (q) => q.eq('status', 'finished') },
      { label: 'Want to read', apply: (q) => q.eq('status', 'want_to_read') },
    ],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, primary: true },
      { name: 'author', label: 'Author', type: 'text' },
      { name: 'status', label: 'Status', type: 'chips',
        options: ['want_to_read', 'reading', 'finished', 'abandoned'] },
      { name: 'format', label: 'Format', type: 'chips', options: ['physical', 'kindle', 'audiobook'] },
      { name: 'rating', label: 'Rating', type: 'chips', options: [1, 2, 3, 4, 5] },
      { name: 'started_at', label: 'Started', type: 'date' },
      { name: 'finished_at', label: 'Finished', type: 'date' },
      { name: 'isbn', label: 'ISBN', type: 'text' },
      { name: 'my_summary', label: 'My summary', type: 'textarea', rows: 5 },
    ],
    title: (r) => r.title,
    meta: (r) => meta(r.author, humanise(r.status), r.rating && `${r.rating}/5`),
  },

  // ── Library: quotes ────────────────────────────────────────────────────
  quotes: {
    key: 'quotes',
    table: 'quotes',
    label: 'Quotes',
    singular: 'quote',
    order: { col: 'created_at', asc: false },
    search: ['text', 'source_reference', 'source_author'],
    fields: [
      { name: 'text', label: 'Quote', type: 'textarea', rows: 6, required: true, primary: true },
      { name: 'source_type', label: 'From', type: 'chips',
        options: ['book', 'article', 'podcast', 'sermon', 'video', 'conversation', 'other'] },
      { name: 'book_id', label: 'Book', type: 'ref', ref: 'book' },
      { name: 'source_author', label: 'Author', type: 'text' },
      { name: 'source_reference', label: 'Reference', type: 'text' },
      { name: 'source_url', label: 'URL', type: 'url' },
      { name: 'page_number', label: 'Page', type: 'number' },
      { name: 'chapter', label: 'Chapter', type: 'text' },
      { name: 'tags', label: 'Tags', type: 'tags' },
    ],
    defaults: { added_via: 'manual' },
    title: (r) => r.text,
    meta: (r) => meta(refName('book', r.book_id) || r.source_author,
      r.page_number && `p${r.page_number}`, niceDate(r.created_at)),
    children: [
      {
        key: 'annotations', table: 'quote_annotations', fk: 'quote_id',
        label: 'Annotations', singular: 'annotation',
        order: { col: 'annotated_at', asc: false },
        fields: [
          { name: 'body', label: 'Annotation', type: 'textarea', rows: 4, required: true, primary: true },
          { name: 'context', label: 'Context', type: 'chips',
            options: ['on_capture', 'on_revisit', 'on_surface', 'unspecified'] },
          { name: 'tags', label: 'Tags', type: 'tags' },
        ],
        title: (r) => r.body,
        meta: (r) => meta(niceStamp(r.annotated_at), humanise(r.context)),
      },
    ],
  },

  // ── Library: journal ───────────────────────────────────────────────────
  journal: {
    key: 'journal',
    table: 'journal_entries',
    label: 'Journal',
    singular: 'journal entry',
    order: { col: 'entry_date', asc: false },
    search: ['transcription_text'],
    fields: [
      { name: 'transcription_text', label: 'Entry', type: 'textarea', rows: 10, required: true, primary: true },
      { name: 'entry_date', label: 'Date', type: 'date', default: 'today' },
      { name: 'book_id', label: 'Journal book', type: 'ref', ref: 'journalBook' },
      { name: 'tags', label: 'Tags', type: 'tags' },
    ],
    // 'typed' is the only source a phone form can honestly claim; the other
    // two exist for the photo and voice capture pipelines.
    defaults: { source: 'typed' },
    title: (r) => String(r.transcription_text || '').split('\n')[0].slice(0, 80) || '(empty)',
    meta: (r) => meta(niceDate(r.entry_date), (r.tags || []).join(', ')),
  },

  journalBooks: {
    key: 'journal-books',
    table: 'journal_books',
    label: 'Journal books',
    singular: 'journal book',
    order: { col: 'book_number', asc: false },
    fields: [
      { name: 'book_number', label: 'Number', type: 'number', required: true, primary: true },
      { name: 'start_date', label: 'Started', type: 'date' },
      { name: 'end_date', label: 'Finished', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    title: (r) => `Book ${r.book_number ?? '?'}`,
    meta: (r) => meta(niceDate(r.start_date), r.end_date && `to ${niceDate(r.end_date)}`),
  },

  // ── Content ────────────────────────────────────────────────────────────
  content: {
    key: 'content',
    table: 'content_items',
    label: 'Content',
    singular: 'content item',
    order: { col: 'updated_at', asc: false },
    search: ['title'],
    filters: [
      { label: 'In flight', apply: (q) => q.in('status', ['idea', 'outline', 'filming', 'editing', 'derivatives_pending']) },
      { label: 'All', apply: (q) => q },
      { label: 'Published', apply: (q) => q.eq('status', 'published') },
    ],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, primary: true },
      { name: 'status', label: 'Status', type: 'chips',
        options: ['idea', 'outline', 'filming', 'editing', 'published', 'derivatives_pending', 'done'] },
      { name: 'type', label: 'Type', type: 'chips',
        options: ['video', 'article', 'short_clip', 'podcast_episode', 'newsletter', 'course'] },
      { name: 'domain_id', label: 'Folder', type: 'ref', ref: 'domain' },
      { name: 'holder', label: 'With', type: 'chips', options: ['me', 'editor'] },
      { name: 'target_publish_date', label: 'Target publish', type: 'date' },
      { name: 'outline_md', label: 'Outline', type: 'textarea', rows: 8 },
      { name: 'video_url', label: 'Video URL', type: 'url' },
      { name: 'article_url', label: 'Article URL', type: 'url' },
    ],
    title: (r) => r.title,
    meta: (r) => meta(humanise(r.status), humanise(r.type),
      r.target_publish_date && `target ${niceDate(r.target_publish_date)}`),
    children: [
      {
        key: 'checklist', table: 'content_checklist_items', fk: 'content_item_id',
        label: 'Checklist', singular: 'checklist item',
        order: { col: 'position', asc: true },
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, primary: true },
          { name: 'done', label: 'Done', type: 'bool' },
          { name: 'position', label: 'Position', type: 'number' },
        ],
        title: (r) => r.title,
        meta: (r) => (r.done ? 'done' : ''),
      },
    ],
  },

  // ── Health ─────────────────────────────────────────────────────────────
  wellbeing: {
    key: 'wellbeing',
    table: 'wellbeing_check_ins',
    label: 'Check-ins',
    singular: 'check-in',
    order: { col: 'checked_in_at', asc: false },
    fields: [
      { name: 'mood', label: 'Mood', type: 'chips', options: [1, 2, 3, 4, 5] },
      { name: 'energy', label: 'Energy', type: 'chips', options: [1, 2, 3, 4, 5] },
      { name: 'sleep_quality', label: 'Sleep', type: 'chips', options: [1, 2, 3, 4, 5] },
      { name: 'pain', label: 'Pain (0–10)', type: 'chips', options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { name: 'checked_in_at', label: 'When', type: 'datetime', default: 'now' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    title: (r) => `Mood ${r.mood ?? '–'} · Energy ${r.energy ?? '–'}`,
    meta: (r) => meta(niceStamp(r.checked_in_at),
      r.sleep_quality && `sleep ${r.sleep_quality}`, r.pain != null && `pain ${r.pain}`),
  },

  workouts: {
    key: 'workouts',
    table: 'workouts',
    label: 'Workouts',
    singular: 'workout',
    order: { col: 'started_at', asc: false },
    search: ['activity_type'],
    fields: [
      { name: 'activity_type', label: 'Activity', type: 'text', required: true, primary: true },
      { name: 'started_at', label: 'Started', type: 'datetime', default: 'now' },
      { name: 'duration_min', label: 'Duration (min)', type: 'number' },
      { name: 'distance_m', label: 'Distance (m)', type: 'number' },
      { name: 'avg_hr', label: 'Avg HR', type: 'number' },
      { name: 'max_hr', label: 'Max HR', type: 'number' },
      { name: 'calories', label: 'Calories', type: 'number' },
      { name: 'elevation_gain_m', label: 'Elevation (m)', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    defaults: { source: 'manual' },
    title: (r) => humanise(r.activity_type),
    meta: (r) => meta(niceStamp(r.started_at), r.duration_min && `${r.duration_min} min`,
      r.distance_m && `${(r.distance_m / 1000).toFixed(1)} km`),
  },

  medications: {
    key: 'medications',
    table: 'medications',
    label: 'Medications',
    singular: 'medication',
    order: { col: 'name', asc: true },
    search: ['name'],
    filters: [
      { label: 'Current', apply: (q) => q.eq('active', true) },
      { label: 'All', apply: (q) => q },
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, primary: true },
      { name: 'kind', label: 'Kind', type: 'chips',
        options: ['prescription', 'supplement', 'vitamin', 'otc'] },
      { name: 'dosage', label: 'Dosage', type: 'text' },
      { name: 'frequency', label: 'Frequency', type: 'text' },
      { name: 'reason', label: 'Reason', type: 'text' },
      { name: 'prescribing_provider', label: 'Prescribed by', type: 'text' },
      { name: 'start_date', label: 'Started', type: 'date' },
      { name: 'stop_date', label: 'Stopped', type: 'date' },
      { name: 'active', label: 'Currently taking', type: 'bool', default: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    title: (r) => r.name,
    meta: (r) => meta(r.dosage, r.frequency, humanise(r.kind), !r.active && 'stopped'),
  },

  healthVisits: {
    key: 'visits',
    table: 'health_visits',
    label: 'Visits',
    singular: 'visit',
    order: { col: 'visit_date', asc: false },
    search: ['provider_name', 'reason'],
    fields: [
      { name: 'provider_name', label: 'Provider', type: 'text', required: true, primary: true },
      { name: 'visit_date', label: 'Date', type: 'date', default: 'today' },
      { name: 'visit_type', label: 'Type', type: 'chips',
        options: ['annual', 'sick', 'specialist', 'follow_up', 'lab', 'imaging', 'urgent_care', 'emergency', 'telehealth', 'other'] },
      { name: 'provider_specialty', label: 'Specialty', type: 'text' },
      { name: 'reason', label: 'Reason', type: 'textarea', rows: 2 },
      { name: 'assessment', label: 'Assessment', type: 'textarea', rows: 4 },
      { name: 'plan', label: 'Plan', type: 'textarea', rows: 4 },
      { name: 'follow_up_date', label: 'Follow up', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    title: (r) => r.provider_name || 'Visit',
    meta: (r) => meta(niceDate(r.visit_date), humanise(r.visit_type), r.reason),
  },

  healthMetrics: {
    key: 'metrics',
    table: 'health_metrics',
    label: 'Metrics',
    singular: 'metric',
    order: { col: 'measured_at', asc: false },
    search: ['metric'],
    fields: [
      { name: 'metric', label: 'Metric', type: 'text', required: true, primary: true },
      { name: 'value', label: 'Value', type: 'number' },
      { name: 'value_secondary', label: 'Second value', type: 'number',
        help: 'For paired readings like blood pressure — systolic above, diastolic here.' },
      { name: 'unit', label: 'Unit', type: 'text' },
      { name: 'measured_at', label: 'When', type: 'datetime', default: 'now' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    defaults: { source: 'manual' },
    title: (r) => humanise(r.metric),
    meta: (r) => meta(
      [r.value, r.value_secondary].filter((v) => v != null).join('/') + (r.unit ? ` ${r.unit}` : ''),
      niceStamp(r.measured_at)),
  },

  labPanels: {
    key: 'labs',
    table: 'lab_panels',
    label: 'Lab panels',
    singular: 'lab panel',
    order: { col: 'drawn_date', asc: false },
    search: ['panel_name'],
    fields: [
      { name: 'panel_name', label: 'Panel', type: 'text', required: true, primary: true },
      { name: 'drawn_date', label: 'Drawn', type: 'date', default: 'today' },
      { name: 'ordering_provider', label: 'Ordered by', type: 'text' },
      { name: 'lab_facility', label: 'Lab', type: 'text' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    title: (r) => r.panel_name || 'Panel',
    meta: (r) => meta(niceDate(r.drawn_date), r.lab_facility),
    children: [
      {
        key: 'results', table: 'lab_results', fk: 'panel_id',
        label: 'Results', singular: 'result',
        order: { col: 'analyte', asc: true },
        fields: [
          { name: 'analyte', label: 'Analyte', type: 'text', required: true, primary: true },
          { name: 'value', label: 'Value', type: 'number' },
          { name: 'value_text', label: 'Value (text)', type: 'text' },
          { name: 'unit', label: 'Unit', type: 'text' },
          { name: 'reference_range_low', label: 'Ref low', type: 'number' },
          { name: 'reference_range_high', label: 'Ref high', type: 'number' },
          { name: 'flag', label: 'Flag', type: 'chips',
            options: ['low', 'high', 'critical_low', 'critical_high', 'abnormal'] },
          { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
        ],
        title: (r) => r.analyte,
        meta: (r) => meta(
          String(r.value ?? r.value_text ?? '') + (r.unit ? ` ${r.unit}` : ''),
          r.flag && humanise(r.flag)),
      },
    ],
  },

  // ── Observations ───────────────────────────────────────────────────────
  observations: {
    key: 'observations',
    table: 'observations',
    label: 'Observations',
    singular: 'observation',
    order: { col: 'surfaced_at', asc: false },
    search: ['title', 'body'],
    filters: [
      { label: 'Open', apply: (q) => q.is('dismissed_at', null) },
      { label: 'All', apply: (q) => q },
    ],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, primary: true },
      { name: 'body', label: 'Detail', type: 'textarea', rows: 4 },
      { name: 'type', label: 'Type', type: 'text', required: true },
      { name: 'severity', label: 'Severity', type: 'chips', options: ['info', 'notable', 'concerning'] },
      { name: 'domain_id', label: 'Folder', type: 'ref', ref: 'domain' },
      { name: 'project_id', label: 'Project', type: 'ref', ref: 'project' },
      { name: 'acted_on', label: 'Acted on', type: 'bool' },
    ],
    defaults: { type: 'manual' },
    title: (r) => r.title,
    meta: (r) => meta(humanise(r.severity), niceDate(r.surfaced_at), r.acted_on && 'acted on'),
  },

  // ── Folders ────────────────────────────────────────────────────────────
  // Editable because the folder list drives the chips on every capture form;
  // being unable to add one from the phone would send you back to a desk.
  domains: {
    key: 'domains',
    table: 'stewardship_domains',
    label: 'Folders',
    singular: 'folder',
    order: { col: 'name', asc: true },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, primary: true },
      { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
      { name: 'expected_cadence', label: 'Expected cadence', type: 'text' },
      { name: 'active', label: 'Active', type: 'bool', default: true },
      { name: 'parked', label: 'Parked', type: 'bool' },
      { name: 'stale_enabled', label: 'Warn when stale', type: 'bool' },
      { name: 'stale_days', label: 'Stale after (days)', type: 'number', min: 1 },
    ],
    title: (r) => r.name,
    meta: (r) => meta(r.is_system && 'system', !r.active && 'inactive', r.parked && 'parked'),
  },
};

// Look a descriptor up by its route segment rather than its object key, since
// that is what the URL carries.
export const byKey = (key) => Object.values(SCHEMA).find((d) => d.key === key);

// ─── Grouping ────────────────────────────────────────────────────────────
// Which area of the app each collection belongs to. Drives two things: the
// eyebrow above every list title, and the ordering of the More sheet. Kept
// here rather than in the view so a new descriptor only has to be declared
// once.

export const GROUPS = [
  { label: 'Work', keys: ['projects', 'content', 'observations'] },
  { label: 'Capture', keys: ['notes', 'captured', 'calendar'] },
  { label: 'People', keys: ['people', 'companies'] },
  { label: 'Library', keys: ['books', 'quotes', 'journal', 'journal-books'] },
  { label: 'Health', keys: ['wellbeing', 'workouts', 'medications', 'visits', 'metrics', 'labs'] },
  { label: 'Setup', keys: ['domains'] },
];

export function groupOf(key) {
  return GROUPS.find((g) => g.keys.includes(key))?.label ?? null;
}
