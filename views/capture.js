// Capture — the fastest path from a thought to a stored row.
//
// This is the screen the widget and the Quick Settings tile mirror, and the
// one that has to work with one hand while walking. Everything on it is
// optional except the text: pick a kind, type, save.

import { sb, ref } from '../lib/db.js';
import {
  el, panel, hint, chips, toast, fail, screenHead, today, ymd, addDays,
} from '../lib/ui.js';
import { go } from '../lib/router.js';

const KINDS = [
  { value: 'task', label: 'Task' },
  { value: 'note', label: 'Note' },
  { value: 'quote', label: 'Quote' },
  { value: 'journal', label: 'Journal' },
  { value: 'inbox', label: 'Inbox' },
];

export async function captureView(mount) {
  const v = { kind: 'task', text: '', domain_id: null, due_date: '', due_time: '', priority: 4 };

  const text = el('textarea', {
    rows: 4, placeholder: 'What is it?', autocapitalize: 'sentences',
    oninput: (e) => { v.text = e.target.value; },
  });

  const dateInput = el('input', { type: 'date', oninput: (e) => { v.due_date = e.target.value; paint(); } });
  const timeInput = el('input', { type: 'time', oninput: (e) => { v.due_time = e.target.value; } });

  const slots = {
    kind: el('div', {}),
    when: el('div', { class: 'field' }),
    folder: el('div', { class: 'field' }),
    prio: el('div', { class: 'field' }),
  };

  function paint() {
    slots.kind.replaceChildren(chips(KINDS, v.kind, (k) => { v.kind = k; paint(); }));

    // Only tasks have a due date, a folder or a priority. Showing those
    // controls for a quote would be noise on the one screen that must stay
    // uncluttered.
    const isTask = v.kind === 'task';
    slots.when.classList.toggle('hidden', !isTask);
    slots.folder.classList.toggle('hidden', !isTask);
    slots.prio.classList.toggle('hidden', !isTask);
    if (!isTask) return;

    const now = new Date();
    slots.when.replaceChildren(
      el('label', {}, 'When'),
      chips([
        { value: '', label: 'None' },
        { value: today(), label: 'Today' },
        { value: ymd(addDays(now, 1)), label: 'Tomorrow' },
        { value: ymd(addDays(now, (6 - now.getDay() + 7) % 7 || 7)), label: 'Weekend' },
      ], v.due_date, (d) => {
        v.due_date = d;
        dateInput.value = d;
        if (!d) { v.due_time = ''; timeInput.value = ''; }
        paint();
      }),
      el('div', { class: 'row', style: 'margin-top:8px' }, dateInput, timeInput),
    );

    slots.folder.replaceChildren(
      el('label', {}, 'Folder'),
      chips([
        { value: null, label: 'Inbox' },
        ...ref.domains.map((d) => ({ value: d.id, label: d.name })),
      ], v.domain_id, (d) => { v.domain_id = d; paint(); }),
    );

    slots.prio.replaceChildren(
      el('label', {}, 'Priority'),
      chips([1, 2, 3, 4].map((p) => ({ value: p, label: `P${p}` })), v.priority,
        (p) => { v.priority = p; paint(); }),
    );
  }

  paint();

  const save = el('button', { class: 'primary', onclick: onSave }, 'Save');

  mount.replaceChildren(
    screenHead('Quick', 'Capture', {
      actions: [el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Back',
        onclick: () => history.back(),
      }, '‹')],
    }),
    panel(
      el('div', { class: 'field' }, el('label', {}, 'Kind'), slots.kind),
      el('div', { class: 'field' }, text),
      slots.when,
      slots.prio,
      slots.folder,
    ),
    el('div', { style: 'padding: 0 20px' }, save),
    hint('Longer forms with every field live under each section.'),
  );

  async function onSave() {
    const body = v.text.trim();
    if (!body) { toast('Type something first.', 'err'); return; }
    save.disabled = true;

    const res = await write(v, body);
    save.disabled = false;
    if (res?.error) { fail(res.error); return; }

    toast('Saved');
    v.text = ''; text.value = '';
    v.due_date = ''; v.due_time = ''; dateInput.value = ''; timeInput.value = '';
    paint();
    text.focus();
  }
}

// Each kind lands in its own table. The defaults here mirror schema.js so a
// row captured quickly is indistinguishable from one entered through the full
// form — same source values, same required columns filled.
function write(v, body) {
  switch (v.kind) {
    case 'task':
      return sb.from('tasks').insert({
        title: body,
        // domain_id is NOT NULL; no folder chosen means Inbox.
        domain_id: v.domain_id || ref.inbox?.id || ref.domains[0]?.id || null,
        due_date: v.due_date || null,
        due_time: v.due_time || null,
        priority: v.priority,
        source: 'manual',
      });

    case 'note':
      return sb.from('notes').insert({ body, source_type: 'own_thought' });

    case 'quote':
      return sb.from('quotes').insert({ text: body, added_via: 'manual' });

    case 'journal':
      return sb.from('journal_entries').insert({
        transcription_text: body, entry_date: today(), source: 'typed',
      });

    default:
      return sb.from('captured_data').insert({
        source: 'manual', type: 'note',
        payload: { text: body }, processed_status: 'raw',
      });
  }
}
