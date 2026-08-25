// Content — the pipeline. A port of the dashboard's content-view.tsx (list),
// content-form.tsx (edit), checklist-section.tsx and [id]/page.tsx (detail).

import { sb, ref, refName } from '../lib/db.js';
import { el, hint, spinner, pill, toast, fail, humanise, confirmDelete, today } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { openSheet } from '../app.js';
import { domainColor } from '../lib/domain-colors.js';
import { youtubeThumbnailUrl, youtubeEmbedUrl } from '../lib/youtube.js';
import {
  detailHeader, crumbDot, actionButton, statStrip, stat, detailBody, detailSection, railBlock, kv, editDrawer,
} from '../lib/detail-shell.js';

const STAGES = [
  { id: 'idea', label: 'Idea', color: '#B6AFA4' },
  { id: 'outline', label: 'Outline', color: '#8A6A2F' },
  { id: 'filming', label: 'Filming', color: '#6B5B95' },
  { id: 'editing', label: 'Editing', color: '#2F5D8A' },
  { id: 'published', label: 'Published', color: '#3B6A52' },
  { id: 'derivatives_pending', label: 'Derivatives', color: '#4A6B70' },
  { id: 'done', label: 'Done', color: '#B6AFA4' },
];
const SHIPPED = new Set(['published', 'done']);
const TYPE_LABEL = { video: 'Video', course: 'Course', article: 'Article', short_clip: 'Short', podcast_episode: 'Podcast', newsletter: 'Newsletter' };
const URGENCY_LABEL = { over: 'Overdue', due: 'Due today', ok: 'On track', quiet: 'Quiet' };

function daysBetween(a, b) { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000); }
function ageColor(days) { if (days == null) return 'var(--ink-3)'; if (days >= 14) return 'var(--accent)'; if (days >= 7) return 'var(--accent)'; if (days >= 3) return 'var(--ink-2)'; return 'var(--ink-3)'; }
function contentUrgency({ holder, target, myMoveDue, days, today }) {
  if (holder === 'me' && target != null && target < today) return 'over';
  if (myMoveDue || (holder === 'editor' && days != null && days >= 7)) return 'due';
  return 'ok';
}
function moveVerb(status, type, unpublishedShorts) {
  switch (status) {
    case 'outline': return type === 'article' || type === 'newsletter' ? 'write it' : 'outline done — film it';
    case 'filming': return 'finish filming';
    case 'editing': return 'finish the edit';
    case 'derivatives_pending': return unpublishedShorts > 0 ? `harvest ${unpublishedShorts} shorts` : 'harvest shorts';
    default: return null;
  }
}

// ─── List ────────────────────────────────────────────────────────────────

export async function contentList(mount) {
  mount.replaceChildren(spinner());
  const { data, error } = await sb.from('content_items').select('*').is('archived_at', null);
  if (error) { mount.lastChild.replaceWith(hint(error.message)); return; }

  const items = data ?? [];
  const t = today();
  const stages = new Set();
  const types = new Set();
  const chans = new Set();
  let holder = null;
  const collapsed = new Set();

  const layout = el('div', { class: 'work-layout' });
  mount.lastChild.replaceWith(layout);

  async function render() {
    const channels = (() => {
      const m = new Map();
      for (const c of items) {
        if (!c.domain_id) continue;
        const name = refName('domain', c.domain_id) || '(channel)';
        const e = m.get(c.domain_id) ?? { name, count: 0 };
        e.count++; m.set(c.domain_id, e);
      }
      return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
    })();
    const typeFacets = (() => {
      const m = new Map();
      for (const c of items) m.set(c.type, (m.get(c.type) ?? 0) + 1);
      return [...m.entries()].map(([id, count]) => ({ id, count }));
    })();

    const visible = items.filter((c) => {
      if (stages.size && !stages.has(c.status)) return false;
      if (types.size && !types.has(c.type)) return false;
      if (chans.size && (!c.domain_id || !chans.has(c.domain_id))) return false;
      if (holder && c.holder !== holder) return false;
      return true;
    });

    const inFlight = items.filter((c) => !SHIPPED.has(c.status)).length;
    const shipped = items.filter((c) => SHIPPED.has(c.status)).length;
    const ideaCount = items.filter((c) => c.status === 'idea').length;
    const activeFilterCount = stages.size + types.size + chans.size + (holder ? 1 : 0);

    const buildFacetGroups = () => [
      facetGroup('Stage', activeFilterCount > 0 ? clearBtn('Reset', () => { stages.clear(); types.clear(); chans.clear(); holder = null; render(); }) : null,
        ...STAGES.map((s) => {
          const n = items.filter((c) => c.status === s.id).length;
          return n ? facetRow({ on: stages.has(s.id), color: s.color, name: s.label, count: n, onClick: () => { stages.has(s.id) ? stages.delete(s.id) : stages.add(s.id); render(); } }) : null;
        }).filter(Boolean),
      ),
      el('div', { class: 'facet-sep' }),
      channels.length ? el('div', {},
        facetGroup('Channel', chans.size ? clearBtn('Clear', () => { chans.clear(); render(); }) : null,
          ...channels.map((c) => facetRow({ on: chans.has(c.id), color: domainColor(c.name), name: c.name, count: c.count, onClick: () => { chans.has(c.id) ? chans.delete(c.id) : chans.add(c.id); render(); } })),
        ),
        el('div', { class: 'facet-sep' }),
      ) : null,
      facetGroup('Type', types.size ? clearBtn('Clear', () => { types.clear(); render(); }) : null,
        el('div', { class: 'facet-tags' }, ...typeFacets.map((tf) => facetTag({ on: types.has(tf.id), name: TYPE_LABEL[tf.id] ?? tf.id, count: tf.count, onClick: () => { types.has(tf.id) ? types.delete(tf.id) : types.add(tf.id); render(); } }))),
      ),
      el('div', { class: 'facet-sep' }),
      facetGroup('Holder', null,
        facetRow({ on: holder === 'me', name: 'My move', count: items.filter((c) => c.holder === 'me').length, onClick: () => { holder = holder === 'me' ? null : 'me'; render(); } }),
        facetRow({ on: holder === 'editor', name: 'With editor', count: items.filter((c) => c.holder === 'editor').length, onClick: () => { holder = holder === 'editor' ? null : 'editor'; render(); } }),
      ),
    ].filter(Boolean);

    const sections = [];
    for (const s of STAGES) {
      let rows = visible.filter((c) => c.status === s.id);
      if (!rows.length) continue;
      if (SHIPPED.has(s.id)) rows = [...rows].sort((a, b) => (b.published_at ?? b.updated_at).localeCompare(a.published_at ?? a.updated_at));
      const isCollapsed = collapsed.has(s.id);
      sections.push(el('section', { style: 'margin-bottom:28px' },
        el('div', { class: 'work-domain-head' },
          el('span', { class: 'work-swatch', style: `background:${s.color}` }),
          el('span', { class: 'work-domain-name' }, s.label),
          el('span', { class: 'item-meta plain', style: 'margin-left:auto' }, `${rows.length} item${rows.length === 1 ? '' : 's'}`),
          el('button', { class: 'work-collapse', type: 'button', onclick: () => { collapsed.has(s.id) ? collapsed.delete(s.id) : collapsed.add(s.id); render(); } }, isCollapsed ? '▸' : '▾'),
        ),
        !isCollapsed ? el('div', { class: 'work-content-list', style: 'margin-top:10px' }, ...rows.map((c) => contentRow(c, t, render))) : null,
      ));
    }
    if (!visible.length) sections.push(el('div', { style: 'padding:56px 0; text-align:center' },
      el('div', { style: 'font-family:var(--serif); font-size:22px; font-weight:500; color:var(--ink)' }, 'Nothing in this view.'),
      el('p', { class: 'item-meta plain' }, 'Loosen a filter, or reset them all.'),
    ));

    const body = el('div', { class: 'work-body' },
      el('header', { class: 'screen-head', style: 'padding-top:0' },
        el('div', { class: 'row-actions' },
          el('div', {},
            el('div', { class: 'eyebrow' }, `Pipeline · ${inFlight} in flight · ${shipped} published`),
            el('h1', {}, 'Content'),
          ),
          el('div', { class: 'work-head-actions' },
            el('button', { class: 'ghost small', type: 'button', onclick: () => { stages.clear(); stages.add('idea'); render(); } }, `Ideas · ${ideaCount}`),
            el('button', { class: 'work-cta', type: 'button', onclick: () => go('#/c/content/new') }, '+ Add item'),
          ),
        ),
      ),
      ...sections,
    );

    const desktopRail = el('aside', { class: 'facet-rail' }, ...buildFacetGroups());
    const filtersBtn = el('button', {
      class: 'filters-fab', type: 'button',
      onclick: () => openSheet(el('div', {},
        el('div', { class: 'sheet-head' }, el('div', { class: 'eyebrow' }, 'Filters')),
        el('div', { style: 'padding-top:8px' }, ...buildFacetGroups()),
      )),
    }, `Filters${activeFilterCount ? ` · ${activeFilterCount}` : ''}`);

    layout.replaceChildren(desktopRail, filtersBtn, body);
  }

  await render();
}

function contentRow(c, t, refresh) {
  const withEditor = c.holder === 'editor';
  const days = c.holder_since ? Math.max(0, daysBetween(c.holder_since.slice(0, 10), t)) : null;
  const myMoveDue = c.holder === 'me' && c.target_publish_date != null && daysBetween(t, c.target_publish_date) <= 7;
  const urgency = contentUrgency({ holder: c.holder, target: c.target_publish_date, myMoveDue, days, today: t });
  const thumb = c.video_url ? youtubeThumbnailUrl(c.video_url, 'mq') : null;
  const channelName = refName('domain', c.domain_id) || null;
  const isIdea = c.status === 'idea';

  return el('div', { class: 'work-content-row' },
    el('div', { style: 'width:56px; height:34px; flex:0 0 auto; border-radius:3px; background:var(--surface-2); overflow:hidden; display:grid; place-items:center' },
      thumb ? el('img', { src: thumb, alt: '', style: 'width:100%; height:100%; object-fit:cover' })
        : el('span', { style: 'font-family:var(--mono); font-size:8px; font-weight:600; text-transform:uppercase; color:var(--ink-4)' }, TYPE_LABEL[c.type] ?? c.type)),
    el('button', { class: 'work-content-main', type: 'button', onclick: () => go(`#/c/content/${c.id}`) },
      el('div', { class: 'work-content-title' }, c.title),
      el('div', { class: 'item-meta' },
        channelName ? el('span', { style: 'display:inline-flex; align-items:center; gap:5px' }, el('span', { style: `width:7px; height:7px; border-radius:2px; background:${domainColor(channelName)}` }), channelName) : null,
        withEditor ? el('span', {}, 'with editor ', el('span', { style: `color:${ageColor(days)}` }, `${days ?? 0}d`)) : (days != null ? `${days}d` : null),
        isIdea ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async (e) => { e.stopPropagation(); await sb.from('content_items').update({ idea_reviewed_at: new Date().toISOString() }).eq('id', c.id); toast('Kept'); refresh(); } }, 'Keep') : null,
        isIdea ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async (e) => { e.stopPropagation(); await sb.from('content_items').update({ archived_at: new Date().toISOString() }).eq('id', c.id); toast('Archived'); refresh(); } }, 'Archive') : null,
      ),
    ),
    pill(urgency, URGENCY_LABEL[urgency]),
    el('button', {
      class: 'ghost small', type: 'button', title: withEditor ? 'Take it back' : 'Send to editor',
      onclick: async () => { const { error } = await sb.from('content_items').update({ holder: withEditor ? 'me' : 'editor', holder_since: new Date().toISOString() }).eq('id', c.id); if (error) { fail(error); return; } refresh(); },
    }, withEditor ? '→ me' : '→ editor'),
  );
}

function facetGroup(label, action, ...children) { return el('div', { class: 'facet-group' }, el('div', { class: 'facet-group-head' }, el('span', { class: 'eyebrow' }, label), action ? el('div', {}, action) : null), ...children); }
function facetRow({ on, color, name, count, onClick }) { return el('button', { class: `facet-row ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, color ? el('span', { class: 'facet-swatch', style: `background:${color}` }) : null, el('span', { class: 'facet-row-name' }, name), count != null ? el('span', { class: 'facet-row-count' }, String(count)) : null); }
function facetTag({ on, name, count, onClick }) { return el('button', { class: `facet-tag ${on ? 'on' : ''}`, type: 'button', onclick: onClick }, name, count != null ? ` ${count}` : ''); }
function clearBtn(label, onClick) { return el('button', { class: 'linkish', type: 'button', style: 'font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.09em; text-decoration:none', onclick }, label); }

// ─── Type-conditional field config (content-form.tsx's TYPE_FIELDS) ───────

const TYPE_FIELDS = {
  video: { producedLabel: 'Filmed on', videoUrl: true, articleUrl: true, canonicalUrl: false, targetDate: true, platforms: false },
  course: { producedLabel: 'Started', videoUrl: true, articleUrl: false, canonicalUrl: 'Course home URL', targetDate: true, platforms: false },
  article: { producedLabel: 'Written on', videoUrl: false, articleUrl: false, canonicalUrl: 'Canonical URL', targetDate: true, platforms: false },
  short_clip: { producedLabel: 'Produced on', videoUrl: false, articleUrl: false, canonicalUrl: false, targetDate: false, platforms: true },
  podcast_episode: { producedLabel: 'Recorded on', videoUrl: false, articleUrl: false, canonicalUrl: 'Episode URL', targetDate: false, platforms: false },
  newsletter: { producedLabel: 'Written on', videoUrl: false, articleUrl: false, canonicalUrl: 'Post URL', targetDate: false, platforms: false },
};
const TYPE_OPTIONS = [['video', 'Video'], ['course', 'Course'], ['article', 'Article'], ['short_clip', 'Short clip'], ['podcast_episode', 'Podcast'], ['newsletter', 'Newsletter']];
const STATUS_OPTIONS = [['idea', 'Idea'], ['outline', 'Outline'], ['filming', 'Filming'], ['editing', 'Editing'], ['published', 'Published'], ['derivatives_pending', 'Derivatives pending'], ['done', 'Done']];
const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'x'];

function contentForm(row) {
  const isNew = !row;
  const v = {
    title: row?.title ?? '', type: row?.type ?? 'video', status: row?.status ?? 'idea',
    domain_id: row?.domain_id ?? '', video_url: row?.video_url ?? '', article_url: row?.article_url ?? '',
    canonical_url: row?.canonical_url ?? '', produced_on: row?.produced_on ?? '', target_publish_date: row?.target_publish_date ?? '',
    published_at: row?.published_at ? row.published_at.slice(0, 10) : '', outline_md: row?.outline_md ?? '',
    platforms: row?.platforms ?? [],
  };

  const title = el('input', { type: 'text', oninput: (e) => { v.title = e.target.value; } }); title.value = v.title;
  const typeSel = el('select', { onchange: (e) => { v.type = e.target.value; paint(); } });
  for (const [val, label] of TYPE_OPTIONS) typeSel.append(el('option', { value: val }, label));
  typeSel.value = v.type;
  const statusSel = el('select', { onchange: (e) => { v.status = e.target.value; } });
  for (const [val, label] of STATUS_OPTIONS) statusSel.append(el('option', { value: val }, label));
  statusSel.value = v.status;
  const domainSel = el('select', { onchange: (e) => { v.domain_id = e.target.value; } });
  domainSel.append(el('option', { value: '' }, '(none)'));
  for (const d of ref.domains) domainSel.append(el('option', { value: d.id }, d.name));
  domainSel.value = v.domain_id;

  const videoUrl = el('input', { type: 'url', placeholder: 'https://youtube.com/watch?v=...', oninput: (e) => { v.video_url = e.target.value; } }); videoUrl.value = v.video_url;
  const articleUrl = el('input', { type: 'url', placeholder: 'https://...', oninput: (e) => { v.article_url = e.target.value; } }); articleUrl.value = v.article_url;
  const canonicalUrl = el('input', { type: 'url', placeholder: 'https://...', oninput: (e) => { v.canonical_url = e.target.value; } }); canonicalUrl.value = v.canonical_url;
  const producedOn = el('input', { type: 'date', oninput: (e) => { v.produced_on = e.target.value; } }); producedOn.value = v.produced_on;
  const targetDate = el('input', { type: 'date', oninput: (e) => { v.target_publish_date = e.target.value; } }); targetDate.value = v.target_publish_date;
  const publishedAt = el('input', { type: 'date', oninput: (e) => { v.published_at = e.target.value; } }); publishedAt.value = v.published_at;
  const outline = el('textarea', { rows: 5, placeholder: '## Hook\n\n## Main point\n\n## CTA', oninput: (e) => { v.outline_md = e.target.value; } }); outline.value = v.outline_md;

  const platformsBox = el('div', { style: 'display:flex; flex-wrap:wrap; gap:10px' },
    ...PLATFORMS.map((p) => {
      const cb = el('input', { type: 'checkbox', checked: v.platforms.includes(p), onchange: (e) => { v.platforms = e.target.checked ? [...v.platforms, p] : v.platforms.filter((x) => x !== p); } });
      return el('label', { class: 'check' }, cb, humanise(p));
    }));

  const slots = { videoUrl: el('div'), articleUrl: el('div'), canonicalUrl: el('div'), targetDate: el('div'), platforms: el('div'), outline: el('div') };

  function paint() {
    const cfg = TYPE_FIELDS[v.type];
    slots.videoUrl.replaceChildren(cfg.videoUrl ? el('div', { class: 'field' }, el('label', {}, 'Video URL'), videoUrl) : null);
    slots.articleUrl.replaceChildren(cfg.articleUrl ? el('div', { class: 'field' }, el('label', {}, 'Companion link'), articleUrl) : null);
    slots.canonicalUrl.replaceChildren(cfg.canonicalUrl !== false ? el('div', { class: 'field' }, el('label', {}, cfg.canonicalUrl), canonicalUrl) : null);
    slots.targetDate.replaceChildren(cfg.targetDate ? el('div', { class: 'field' }, el('label', {}, 'Target publish date'), targetDate) : null);
    slots.platforms.replaceChildren(cfg.platforms ? el('div', { class: 'field' }, el('label', {}, 'Platforms'), platformsBox) : null);
    slots.outline.replaceChildren((v.type === 'video' || v.type === 'course' || v.type === 'podcast_episode') ? el('div', { class: 'field' }, el('label', {}, 'Outline / notes (markdown)'), outline) : null);
  }
  paint();

  const save = el('button', { class: 'primary', onclick: onSave }, isNew ? 'Add' : 'Save');
  const wrap = el('div', {},
    el('div', { class: 'panel', style: 'margin:0' },
      el('div', { class: 'field' }, el('label', {}, 'Title (required)'), title),
      el('div', { class: 'row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Type'), typeSel), el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Status'), statusSel)),
      el('div', { class: 'field' }, el('label', {}, 'Channel / domain'), domainSel),
      slots.videoUrl, slots.articleUrl, slots.canonicalUrl, slots.platforms,
      el('div', { class: 'row' },
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, TYPE_FIELDS[v.type].producedLabel), producedOn),
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Published date'), publishedAt),
      ),
      slots.targetDate, slots.outline,
    ),
    el('div', { class: 'form-actions' },
      save,
      isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete item…'),
    ),
  );

  async function onSave() {
    if (!v.title.trim()) { toast('Type something first.', 'err'); return; }
    save.disabled = true;
    const payload = {
      title: v.title.trim(), type: v.type, status: v.status, domain_id: v.domain_id || null,
      video_url: v.video_url || null, article_url: v.article_url || null, canonical_url: v.canonical_url || null,
      produced_on: v.produced_on || null, target_publish_date: v.target_publish_date || null,
      published_at: v.published_at ? new Date(v.published_at).toISOString() : null,
      outline_md: v.outline_md || null, platforms: v.platforms.length ? v.platforms : null,
    };
    const res = isNew ? await sb.from('content_items').insert(payload).select('id').single() : await sb.from('content_items').update(payload).eq('id', row.id);
    save.disabled = false;
    if (res.error) { fail(res.error); return; }
    toast(isNew ? 'Added' : 'Saved');
    go(isNew ? `#/c/content/${res.data.id}` : `#/c/content/${row.id}`);
  }
  async function onDelete() {
    if (!confirmDelete('this content item')) return;
    const { error } = await sb.from('content_items').delete().eq('id', row.id);
    if (error) { fail(error); return; }
    toast('Deleted');
    go('#/c/content');
  }

  return wrap;
}

export async function contentNew(mount) {
  mount.replaceChildren(
    el('header', { class: 'screen-head' }, el('div', { class: 'eyebrow' }, 'Capture'), el('h1', {}, 'New content')),
    contentForm(null),
  );
}

// ─── Detail ─────────────────────────────────────────────────────────────

const PIPE = ['idea', 'outline', 'filming', 'editing', 'derivatives_pending'];
const PIPE_LABEL = { idea: 'Idea', outline: 'Outline', filming: 'Filming', editing: 'Editing', derivatives_pending: 'Derivatives' };
const NEXT = { idea: 'outline', outline: 'filming', filming: 'editing', editing: 'published', published: null, derivatives_pending: 'done', done: null };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const CHECKLIST_TEMPLATES = {
  video: ['Outline', 'Film', 'Rough cut', 'Final edit', 'Thumbnail', 'Title + description', 'Publish', 'Promote (Shorts, socials)'],
  article: ['Outline', 'First draft', 'Edit', 'Header image', 'Publish', 'Share / promote'],
  short_clip: ['Identify clip from long-form', 'Edit', 'Caption / hook', 'Publish'],
  podcast_episode: ['Outline / questions', 'Record', 'Edit', 'Show notes', 'Publish', 'Promote'],
  newsletter: ['Draft', 'Edit', 'Header image', 'Send'],
  course: ['Outline', 'Film', 'Edit', 'Companion post', 'Publish'],
};

export async function contentDetail(mount, { id }) {
  mount.replaceChildren(spinner());

  const [itemRes, checklistRes, tasksRes, allRes] = await Promise.all([
    sb.from('content_items').select('*').eq('id', id).single(),
    sb.from('content_checklist_items').select('*').eq('content_item_id', id).order('position'),
    sb.from('tasks').select('id, title, status, due_date').eq('content_item_id', id),
    sb.from('content_items').select('id, title, type, status, parent_id').is('archived_at', null),
  ]);
  if (itemRes.error) { mount.lastChild.replaceWith(hint(itemRes.error.message)); return; }

  const item = itemRes.data;
  const checklist = checklistRes.data ?? [];
  const linkedTasks = tasksRes.data ?? [];
  const allItems = allRes.data ?? [];
  const t = today();

  const holder = item.holder === 'editor' ? 'editor' : 'me';
  const isDone = item.status === 'published' || item.status === 'done';
  const daysInStatus = item.holder_since ? Math.max(0, daysBetween(item.holder_since.slice(0, 10), t)) : null;
  const target = item.target_publish_date ?? null;
  const targetPassed = !isDone && target != null && target < t;
  const ckDone = checklist.filter((c) => c.done).length;
  const openTasks = linkedTasks.filter((x) => x.status === 'open').length;
  const children = allItems.filter((c) => c.parent_id === item.id);
  const plus7 = (() => { const d = new Date(t); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const myMoveDue = !isDone && holder === 'me' && target != null && target <= plus7;
  const urg = isDone ? 'quiet' : contentUrgency({ holder, target, myMoveDue, days: daysInStatus, today: t });

  const chipLabel = isDone ? cap(item.status)
    : targetPassed ? 'Target passed'
    : holder === 'editor' ? `With editor${daysInStatus != null ? ` · ${daysInStatus}d` : ''}`
    : myMoveDue ? 'My move' : 'On track';

  const channelName = refName('domain', item.domain_id);

  function refresh() { contentDetail(mount, { id }); }

  const primary = holder === 'editor'
    ? actionButton({ variant: 'accent', onClick: async () => { const { error } = await sb.from('content_items').update({ holder: 'me', holder_since: new Date().toISOString() }).eq('id', item.id); if (error) { fail(error); return; } refresh(); } }, 'Rough cut is back')
    : (() => {
        const verb = moveVerb(item.status, item.type, 0) ?? (item.status === 'idea' ? 'outline it' : null);
        const next = NEXT[item.status];
        if (!verb || !next) return null;
        return actionButton({ variant: 'accent', onClick: async () => { const { error } = await sb.from('content_items').update({ status: next }).eq('id', item.id); if (error) { fail(error); return; } refresh(); } }, `${cap(verb)} →`);
      })();

  const header = detailHeader({
    titleClass: '',
    crumb: [
      el('button', { class: 'linkish', type: 'button', onclick: () => go('#/c/content') }, 'Content'),
      crumbDot(), el('span', {}, item.type.replace('_', ' ')),
      channelName ? crumbDot() : null, channelName ? el('span', {}, channelName) : null,
    ].filter(Boolean),
    name: item.title,
    state: pill(urg, chipLabel),
    actions: [primary, actionButton({ onClick: () => go(`#/tasks/new`) }, '+ Task'), editDrawer('Edit content', contentForm(item))].filter(Boolean),
    below: pipeline(item.status, holder, daysInStatus),
  });

  const strip = statStrip(
    stat({ label: 'Days in status', value: daysInStatus ?? '—', unit: daysInStatus != null ? (daysInStatus === 1 ? 'day' : 'days') : undefined, sub: holder === 'editor' ? 'with editor' : 'with me' }),
    target ? stat({ label: 'Target publish', value: target.slice(5), tone: targetPassed ? 'accent' : undefined, sub: targetPassed ? 'passed' : 'set' }) : stat({ label: 'Target publish', value: '—', sub: 'no target set' }),
    stat({ label: item.type === 'course' ? 'Curriculum' : 'Checklist', value: checklist.length ? `${ckDone}/${checklist.length}` : '—', sub: checklist.length ? (ckDone === checklist.length ? 'complete' : 'in progress') : 'none yet' }),
    stat({ label: 'Linked tasks', value: openTasks, unit: 'open', sub: `${linkedTasks.length} linked` }),
  );

  const embed = item.video_url && youtubeEmbedUrl(item.video_url)
    ? el('div', { style: 'margin-bottom:16px; aspect-ratio:16/9; background:var(--surface-2); border:1px solid var(--line); border-radius:5px; overflow:hidden' },
        el('iframe', { src: youtubeEmbedUrl(item.video_url), style: 'width:100%; height:100%; border:none', allowfullscreen: true }))
    : null;

  const main = [
    embed,
    checklistSection(item, checklist, refresh),
    detailSection({ label: 'Linked tasks', count: linkedTasks.length > 0 ? `${openTasks} open` : undefined },
      linkedTasks.length === 0
        ? el('p', { class: 'briefing-empty' }, 'No tasks linked to this content.')
        : el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...linkedTasks.map((tk) =>
            el('li', { style: 'display:flex; align-items:baseline; gap:10px; padding:7px 0; border-bottom:1px solid var(--line)' },
              el('span', { class: 'item-meta', style: tk.status === 'done' ? 'color:var(--ink-4)' : (tk.due_date && tk.due_date < t ? 'color:var(--accent)' : '') }, tk.status === 'done' ? '✓ done' : 'open'),
              el('button', { class: 'linkish', type: 'button', style: `flex:1; text-align:left; text-decoration:none; ${tk.status === 'done' ? 'color:var(--ink-3); text-decoration:line-through' : ''}`, onclick: () => go(`#/tasks/${tk.id}`) }, tk.title),
              tk.due_date ? el('span', { class: 'item-meta' }, tk.due_date) : null,
            ))),
    ),
    children.length ? detailSection({ label: 'Derivatives', count: children.length },
      el('ul', { style: 'list-style:none; padding:0; margin:0' }, ...children.map((c) =>
        el('li', { style: 'display:flex; align-items:baseline; gap:10px; padding:7px 0; border-bottom:1px solid var(--line)' },
          el('span', { class: 'item-meta' }, c.type.replace('_', ' ')),
          el('button', { class: 'linkish', type: 'button', style: 'flex:1; text-align:left; text-decoration:none', onclick: () => go(`#/c/content/${c.id}`) }, c.title),
          el('span', { class: 'item-meta' }, c.status.replace('_', ' ')),
        )))) : null,
  ].filter(Boolean);

  const rail = [
    railBlock('Dates',
      item.produced_on ? kv(item.type === 'course' ? 'Started' : 'Produced', item.produced_on) : null,
      kv('Target', target ?? '—', targetPassed),
      kv('Published', item.published_at ? item.published_at.slice(0, 10) : '—'),
    ),
    railBlock('Holder',
      el('div', { style: 'display:flex; align-items:center; justify-content:space-between; gap:10px' },
        el('span', { style: 'font-family:var(--sans); font-size:13.5px; color:var(--ink)' }, `${holder === 'me' ? 'With me' : 'With editor'}${daysInStatus != null ? ` · ${daysInStatus}d` : ''}`),
        el('button', {
          class: 'ghost small', type: 'button',
          onclick: async () => { const { error } = await sb.from('content_items').update({ holder: holder === 'me' ? 'editor' : 'me', holder_since: new Date().toISOString() }).eq('id', item.id); if (error) { fail(error); return; } refresh(); },
        }, holder === 'me' ? 'Hand to editor' : 'Take it back'),
      ),
    ),
    item.canonical_url ? railBlock('Links', el('a', { href: item.canonical_url, target: '_blank', rel: 'noopener noreferrer', style: 'font-family:var(--sans); font-size:13.5px; color:var(--ink); word-break:break-all' }, item.type === 'course' ? 'Course home ↗' : 'Canonical ↗')) : null,
  ].filter(Boolean);

  mount.replaceChildren(header, strip, detailBody(main, rail));
}

function checklistSection(item, checklist, refresh) {
  const doneCount = checklist.filter((c) => c.done).length;
  return detailSection({
    label: 'Checklist', count: checklist.length ? `· ${doneCount}/${checklist.length}` : undefined,
    action: checklist.length === 0 ? el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async () => {
      const defaults = CHECKLIST_TEMPLATES[item.type] ?? CHECKLIST_TEMPLATES.video;
      const rows = defaults.map((title, idx) => ({ content_item_id: item.id, position: idx, title }));
      await sb.from('content_checklist_items').insert(rows);
      refresh();
    } }, '+ Add default items') : null,
  },
    checklist.length === 0
      ? el('p', { class: 'briefing-empty' }, 'No checklist yet. Add default items, or add your own below.')
      : el('ul', { style: 'list-style:none; padding:0; margin:0 0 10px' }, ...checklist.map((c) =>
          el('li', { class: 'item row-item', style: 'padding:6px 0' },
            el('button', {
              type: 'button', style: `width:18px; height:18px; border:2px solid ${c.done ? 'var(--ink)' : 'var(--line-strong)'}; background:${c.done ? 'var(--ink)' : 'none'}; color:var(--bg); cursor:pointer`,
              onclick: async () => { await sb.from('content_checklist_items').update({ done: !c.done, done_at: c.done ? null : new Date().toISOString() }).eq('id', c.id); refresh(); },
            }, c.done ? '✓' : ''),
            el('span', { style: `flex:1; font-family:var(--sans); font-size:14px; ${c.done ? 'color:var(--ink-3); text-decoration:line-through' : 'color:var(--ink)'}` }, c.title),
            el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: async () => { await sb.from('content_checklist_items').delete().eq('id', c.id); refresh(); } }, '✕'),
          ))),
    (() => {
      const input = el('input', { type: 'text', placeholder: 'Add a checklist item…' });
      return el('div', { style: 'display:flex; align-items:center; gap:8px' },
        el('span', { style: 'color:var(--ink-3)' }, '+'),
        input,
        el('button', {
          class: 'ghost small', type: 'button', onclick: async () => {
            if (!input.value.trim()) return;
            await sb.from('content_checklist_items').insert({ content_item_id: item.id, position: checklist.length, title: input.value.trim() });
            refresh();
          },
        }, 'Add'),
      );
    })(),
  );
}

function pipeline(status, holder, days) {
  const isPost = status === 'published' || status === 'done';
  const curIdx = PIPE.indexOf(status);
  const nodes = [];
  PIPE.forEach((s, i) => {
    const st = isPost || (curIdx >= 0 && i < curIdx) ? 'done' : i === curIdx ? 'cur' : 'future';
    if (i > 0) nodes.push(el('span', { style: 'width:18px; height:1px; background:var(--line-strong); margin:0 6px' }));
    nodes.push(el('span', { style: 'display:inline-flex; align-items:center; gap:5px' },
      el('span', { style: `width:8px; height:8px; border-radius:999px; background:${st === 'cur' ? 'var(--accent)' : st === 'done' ? 'var(--ink-3)' : 'var(--line-strong)'}` }),
      el('span', { style: `font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:0.05em; color:${st === 'cur' ? 'var(--accent)' : st === 'done' ? 'var(--ink-3)' : 'var(--ink-4)'}` }, PIPE_LABEL[s]),
    ));
  });
  if (isPost) nodes.push(el('span', { style: 'margin-left:12px; font-family:var(--mono); font-size:9px; text-transform:uppercase; color:var(--good)' }, `✓ ${status}`));
  return el('div', {},
    el('div', { style: 'display:flex; align-items:center; flex-wrap:wrap; gap:6px 0' }, ...nodes),
    !isPost ? el('div', { class: 'item-meta plain', style: 'margin-top:8px' }, `${cap(status.replace('_', ' '))} · ${holder === 'editor' ? 'with editor' : 'with me'}${days != null ? ` · ${days}d` : ''}`) : null,
  );
}
