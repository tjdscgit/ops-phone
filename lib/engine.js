// Generic list / form rendering, driven by the descriptors in schema.js.
//
// This is the part that keeps the app small. Fifteen areas share one list
// view and one form view; adding an area is a descriptor, and deleting one is
// deleting a descriptor. Only the screens with real behaviour — Today, Tasks,
// Routines — are written by hand.

import { sb, refOptions, loadRef, isRefTable } from './db.js';
import {
  el, panel, hint, chips, toast, fail, confirmDelete, spinner, svg,
  screenHead, sectionLabel, humanise, today, toLocalInput, fromLocalInput,
} from './ui.js';
import { go } from './router.js';
import { groupOf } from '../schema.js';

const PAGE = 50;

// ─── Field widgets ───────────────────────────────────────────────────────
// Each returns a node and writes straight into `values` on change, so the
// form has no separate read step and no chance of the two drifting apart.

function widget(f, values) {
  const set = (v) => { values[f.name] = v; };
  const cur = values[f.name];

  switch (f.type) {
    case 'textarea':
    case 'json': {
      const t = el('textarea', {
        rows: f.rows || 4,
        placeholder: f.label,
        autocapitalize: 'sentences',
        oninput: (e) => set(e.target.value),
      });
      t.value = cur ?? '';
      return t;
    }

    case 'bool': {
      const box = el('input', { type: 'checkbox', onchange: (e) => set(e.target.checked) });
      box.checked = !!cur;
      return el('label', { class: 'check' }, box, el('span', {}, f.label));
    }

    case 'chips': {
      const wrap = el('div', {});
      const paint = () => {
        wrap.replaceChildren(chips(
          f.options.map((o) => ({ value: o, label: typeof o === 'number' ? String(o) : humanise(o) })),
          values[f.name],
          (v) => {
            // Tapping the selected chip clears it. Most of these columns are
            // nullable and there's otherwise no way to unset a wrong tap.
            set(values[f.name] === v ? null : v);
            paint();
          },
        ));
      };
      paint();
      return wrap;
    }

    case 'ref': {
      const sel = el('select', { onchange: (e) => set(e.target.value || null) });
      sel.append(el('option', { value: '' }, '—'));
      for (const o of refOptions[f.ref]()) {
        sel.append(el('option', { value: o.value }, o.label));
      }
      sel.value = cur ?? '';
      return sel;
    }

    case 'tags': {
      const i = el('input', {
        type: 'text', placeholder: 'comma, separated',
        autocapitalize: 'none',
        oninput: (e) => set(
          e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
        ),
      });
      i.value = Array.isArray(cur) ? cur.join(', ') : (cur ?? '');
      return i;
    }

    case 'datetime': {
      const i = el('input', { type: 'datetime-local', oninput: (e) => set(e.target.value || null) });
      // Stored as a zoned timestamp, edited as local wall-clock time.
      i.value = toLocalInput(cur);
      return i;
    }

    default: {
      const i = el('input', {
        type: f.type === 'number' ? 'number' : f.type,
        placeholder: f.label,
        min: f.min,
        max: f.max,
        step: f.type === 'number' ? 'any' : null,
        // Emails, URLs and phone numbers get mangled by autocapitalise.
        autocapitalize: ['email', 'url', 'tel'].includes(f.type) ? 'none' : 'sentences',
        autocorrect: 'off',
        oninput: (e) => set(e.target.value === '' ? null : e.target.value),
      });
      i.value = cur ?? '';
      return i;
    }
  }
}

// Fields whose widget carries its own label (checkboxes) shouldn't get a
// second one above it.
const SELF_LABELLING = new Set(['bool']);

function fieldRow(f, values) {
  const w = widget(f, values);
  return el('div', { class: 'field' },
    SELF_LABELLING.has(f.type) ? null : el('label', {}, f.label),
    w,
    f.help ? hint(f.help) : null);
}

// ─── Value preparation ───────────────────────────────────────────────────

function seedValues(desc, row) {
  const v = { ...(desc.defaults || {}), ...(row || {}) };
  if (!row) {
    for (const f of desc.fields) {
      if (f.default === 'today') v[f.name] = today();
      else if (f.default === 'now') v[f.name] = new Date().toISOString();
      else if (f.default !== undefined) v[f.name] = f.default;
    }
  }
  return v;
}

// Turn the live `values` object into something Postgres will accept.
function toRow(desc, values) {
  const out = { ...(desc.defaults || {}) };

  for (const f of desc.fields) {
    let v = values[f.name];

    if (v === '' || v === undefined) v = null;

    if (f.type === 'number' && v !== null) {
      const n = Number(v);
      v = Number.isFinite(n) ? n : null;
    }

    if (f.type === 'datetime' && v) {
      // Untouched fields still hold the ISO string they were seeded with;
      // only the datetime-local format needs converting.
      v = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? fromLocalInput(v) : v;
    }

    if (f.type === 'tags' && v !== null && !Array.isArray(v)) {
      v = String(v).split(',').map((s) => s.trim()).filter(Boolean);
    }

    if (f.type === 'json' && typeof v === 'string') {
      // captured_data.payload is jsonb. Typed text isn't JSON, so wrap it —
      // storing `{"text": "..."}` keeps the column's shape honest and matches
      // what the other capture sources write.
      const s = v.trim();
      if (s.startsWith('{') || s.startsWith('[')) {
        try { v = JSON.parse(s); } catch { v = { text: v }; }
      } else {
        v = { text: v };
      }
    }

    out[f.name] = v;
  }
  return out;
}

function missingRequired(desc, values) {
  return desc.fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = values[f.name];
      return v === null || v === undefined || v === '' ||
        (Array.isArray(v) && v.length === 0);
    })
    .map((f) => f.label);
}

const addButton = (href) =>
  el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Add', onclick: () => go(href) }, '+');

const backButton = (href) =>
  el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => go(href) }, '‹');

// ─── List ────────────────────────────────────────────────────────────────

export async function listView(mount, desc, opts = {}) {
  const { parentId = null, fk = null, backTo = null } = opts;

  const state = {
    filter: desc.filters ? 0 : null,
    q: '',
    limit: PAGE,
  };

  const head = screenHead(groupOf(desc.key) || 'Ops', desc.label, {
    actions: [
      backTo ? backButton(backTo) : null,
      addButton(newRoute(desc, parentId, opts)),
    ].filter(Boolean),
  });

  const body = el('div', { class: 'screen' });
  mount.replaceChildren(head, controls(), body);

  function controls() {
    const wrap = el('div', { class: 'controls' });
    if (desc.search) {
      let timer;
      wrap.append(el('input', {
        type: 'search', placeholder: `Search ${desc.label.toLowerCase()}`,
        autocapitalize: 'none', autocorrect: 'off',
        oninput: (e) => {
          // Debounced: every keystroke otherwise fires a round trip, which on
          // a paddock 4G connection makes the field feel laggy.
          clearTimeout(timer);
          const v = e.target.value.trim();
          timer = setTimeout(() => { state.q = v; state.limit = PAGE; load(); }, 250);
        },
      }));
    }
    if (desc.filters) wrap.append(filterChips());
    return wrap;
  }

  function filterChips() {
    return chips(
      desc.filters.map((f, i) => ({ value: i, label: f.label })),
      state.filter,
      (i) => {
        state.filter = i; state.limit = PAGE;
        const wrap = mount.querySelector('.controls');
        wrap.querySelector('.chips').replaceWith(filterChips());
        load();
      },
    );
  }

  async function load() {
    body.replaceChildren(spinner());

    let q = sb.from(desc.table).select('*');
    if (fk && parentId) q = q.eq(fk, parentId);
    if (state.filter !== null) q = desc.filters[state.filter].apply(q);
    if (state.q && desc.search) {
      // `or` takes a comma-joined filter string; commas and parens inside the
      // search term would break the expression, so they're stripped.
      const safe = state.q.replace(/[,()]/g, ' ');
      q = q.or(desc.search.map((c) => `${c}.ilike.%${safe}%`).join(','));
    }
    q = q.order(desc.order.col, { ascending: desc.order.asc, nullsFirst: false })
      .limit(state.limit);

    const { data, error } = await q;
    if (error) { body.replaceChildren(hint(error.message)); return; }
    if (!data.length) {
      body.replaceChildren(hint(`No ${desc.label.toLowerCase()} yet.`));
      return;
    }

    const list = el('div', { class: 'list' });
    for (const row of data) {
      list.append(rowNode(desc, row, () => go(editRoute(desc, row.id, parentId, opts))));
    }

    body.replaceChildren(
      list,
      data.length >= state.limit
        ? el('div', { class: 'controls more-row' },
            el('button', {
              class: 'ghost',
              onclick: () => { state.limit += PAGE; load(); },
            }, 'Load more'))
        : null,
    );
  }

  await load();
}

export function rowNode(desc, row, onClick) {
  const m = desc.meta?.(row) || '';
  return el('button', { class: 'item', type: 'button', onclick: onClick },
    el('div', { class: 'item-title serif' }, desc.title(row) || '(untitled)'),
    m ? el('div', { class: 'item-meta' }, m) : null,
  );
}

// ─── Form ────────────────────────────────────────────────────────────────

export async function formView(mount, desc, id, opts = {}) {
  const { parentId = null, fk = null, backTo } = opts;
  const isNew = !id || id === 'new';

  let row = null;
  if (!isNew) {
    mount.replaceChildren(spinner());
    const { data, error } = await sb.from(desc.table).select('*').eq('id', id).single();
    if (error) { mount.replaceChildren(hint(error.message)); return; }
    row = data;
  }

  const values = seedValues(desc, row);
  const form = panel(...desc.fields.map((f) => fieldRow(f, values)));

  const save = el('button', { class: 'primary', onclick: onSave },
    isNew ? `Add ${desc.singular}` : 'Save');

  mount.replaceChildren(
    screenHead(desc.label, isNew ? `New ${desc.singular}` : (desc.title(row) || desc.singular), {
      actions: [backButton(backTo)],
    }),
    form,
    el('div', { class: 'form-actions' },
      save,
      isNew ? null : el('button', { class: 'ghost danger', onclick: onDelete }, 'Delete'),
    ),
    // Children are only meaningful once the parent row exists, so they appear
    // after the first save rather than on the new-item form.
    !isNew && desc.children ? childSections(desc, id) : null,
  );

  async function onSave() {
    const missing = missingRequired(desc, values);
    if (missing.length) { toast(`${missing.join(' and ')} required`, 'err'); return; }

    save.disabled = true;
    const payload = toRow(desc, values);
    if (fk && parentId) payload[fk] = parentId;

    const res = isNew
      ? await sb.from(desc.table).insert(payload)
      : await sb.from(desc.table).update(payload).eq('id', id);

    save.disabled = false;
    if (res.error) { fail(res.error); return; }

    // Pickers elsewhere in the app cache these rows; refresh so a project
    // added here shows up in the next form's dropdown.
    if (isRefTable(desc.table)) await loadRef();

    toast(isNew ? `${desc.singular} added` : 'Saved');
    go(backTo);
  }

  async function onDelete() {
    if (!confirmDelete(`this ${desc.singular}`)) return;
    const { error } = await sb.from(desc.table).delete().eq('id', id);
    if (error) { fail(error); return; }
    if (isRefTable(desc.table)) await loadRef();
    toast('Deleted');
    go(backTo);
  }
}

// ─── Child collections, rendered inline on a parent's form ───────────────

function childSections(parentDesc, parentId) {
  const wrap = el('div', {});
  for (const child of parentDesc.children) {
    const body = el('div', {}, spinner());
    wrap.append(
      sectionLabel(child.label,
        addButton(`#/c/${parentDesc.key}/${parentId}/${child.key}/new`)),
      body,
    );
    loadChild(body, parentDesc, child, parentId);
  }
  return wrap;
}

async function loadChild(body, parentDesc, child, parentId) {
  const { data, error } = await sb.from(child.table).select('*')
    .eq(child.fk, parentId)
    .order(child.order.col, { ascending: child.order.asc, nullsFirst: false })
    .limit(100);

  body.replaceChildren(
    error
      ? hint(error.message)
      : !data.length
        ? hint(`No ${child.label.toLowerCase()} yet.`)
        : el('div', { class: 'list' }, ...data.map((r) =>
            rowNode(child, r, () =>
              go(`#/c/${parentDesc.key}/${parentId}/${child.key}/${r.id}`)))),
  );
}

// ─── Routes ──────────────────────────────────────────────────────────────

const newRoute = (desc, parentId, opts) =>
  opts.childOf ? `#/c/${opts.childOf}/${parentId}/${desc.key}/new` : `#/c/${desc.key}/new`;

const editRoute = (desc, id, parentId, opts) =>
  opts.childOf ? `#/c/${opts.childOf}/${parentId}/${desc.key}/${id}` : `#/c/${desc.key}/${id}`;
