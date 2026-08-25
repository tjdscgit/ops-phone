// Conversation timeline + log form — a port of
// components/conversations/ConversationTimeline.tsx + LogConversationForm.tsx.
// Reused on Company and Person detail (Project detail isn't ported here).

import { sb } from './db.js';
import { el, hint, toast, fail } from './ui.js';
import { go } from './router.js';

const TYPE_LABELS = {
  email: 'Email', call: 'Call', text_message: 'Text', social_dm: 'DM',
  in_person: 'In person', meeting: 'Meeting', video_call: 'Video', other: 'Other',
};
const DIRECTION_MARK = { inbound: '↓ in', outbound: '↑ out', internal: '· internal' };

function fmt(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function conversationTimeline(conversations, { scope, refresh }) {
  if (!conversations.length) {
    return el('p', { class: 'briefing-empty' }, 'No conversations logged yet. Add one below.');
  }
  return el('ul', { class: 'conv-list' }, ...conversations.map((c) => {
    const chips = [];
    if (scope !== 'company' && c.company) chips.push(el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/companies/${c.company.id}`) }, c.company.name));
    if (scope !== 'person' && c.person) chips.push(el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => go(`#/c/people/${c.person.id}`) }, c.person.name));

    return el('li', { class: 'conv-row' },
      el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between; gap:10px' },
        el('div', { class: 'item-meta' },
          el('span', {}, fmt(c.occurred_at)),
          el('span', {}, `· ${TYPE_LABELS[c.interaction_type] ?? c.interaction_type}`),
          el('span', {}, `· ${DIRECTION_MARK[c.direction] ?? c.direction}`),
          c.requires_followup ? el('span', { class: 'over' }, `· follow up${c.followup_by ? ` by ${c.followup_by}` : ''}`) : null,
        ),
        el('button', {
          class: 'linkish', type: 'button', 'aria-label': 'Delete conversation', style: 'text-decoration:none',
          onclick: async () => {
            const { error } = await sb.from('conversations').delete().eq('id', c.id);
            if (error) { fail(error); return; }
            toast('Deleted');
            refresh();
          },
        }, '✕'),
      ),
      c.subject ? el('div', { style: 'margin-top:4px; font-family:var(--sans); font-size:14px; color:var(--ink); font-weight:500' }, c.subject) : null,
      el('p', { style: 'margin:2px 0 0; font-family:var(--sans); font-size:14px; color:var(--ink-2); line-height:1.5; white-space:pre-wrap' }, c.summary),
      chips.length ? el('div', { class: 'item-meta', style: 'margin-top:4px' }, ...chips) : null,
    );
  }));
}

const CONV_TYPES = [
  { value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' },
  { value: 'in_person', label: 'In person' }, { value: 'video_call', label: 'Video call' },
  { value: 'text_message', label: 'Text' }, { value: 'social_dm', label: 'Social DM' },
  { value: 'email', label: 'Email' }, { value: 'other', label: 'Other' },
];
const CONV_DIRECTIONS = [
  { value: 'outbound', label: 'Outbound (I reached out)' },
  { value: 'inbound', label: 'Inbound (they reached me)' },
  { value: 'internal', label: 'Internal / note' },
];

// Scope carries exactly one association id (company_id | person_id).
export function logConversationForm(scope, refresh) {
  let open = false;
  const wrap = el('div', { style: 'margin-top:10px' });

  function draw() {
    if (!open) {
      wrap.replaceChildren(el('button', {
        class: 'linkish', type: 'button', style: 'text-decoration:none',
        onclick: () => { open = true; draw(); },
      }, '+ Log conversation'));
      return;
    }

    const typeSel = el('select', {});
    for (const t of CONV_TYPES) typeSel.append(el('option', { value: t.value }, t.label));
    const dirSel = el('select', {});
    for (const d of CONV_DIRECTIONS) dirSel.append(el('option', { value: d.value }, d.label));
    const summary = el('textarea', { rows: 3, placeholder: 'What was discussed…' });
    const occurredAt = el('input', { type: 'date' });
    const followupBy = el('input', { type: 'date' });
    const err = el('div', { class: 'hint' }, '');

    const submit = async () => {
      if (!summary.value.trim()) { toast('Summary is required.', 'err'); return; }
      const payload = {
        ...scope,
        interaction_type: typeSel.value,
        direction: dirSel.value,
        summary: summary.value.trim(),
        occurred_at: occurredAt.value ? new Date(occurredAt.value).toISOString() : new Date().toISOString(),
        followup_by: followupBy.value || null,
        requires_followup: !!followupBy.value,
      };
      const { error } = await sb.from('conversations').insert(payload);
      if (error) { fail(error); return; }
      toast('Logged');
      open = false;
      refresh();
    };

    wrap.replaceChildren(el('div', { class: 'panel', style: 'margin:0' },
      el('div', { class: 'row' },
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Type'), typeSel),
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Direction'), dirSel),
      ),
      el('div', { class: 'field' }, el('label', {}, 'Summary'), summary),
      el('div', { class: 'row' },
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'When'), occurredAt),
        el('div', { class: 'field', style: 'flex:1' }, el('label', {}, 'Follow up by'), followupBy),
      ),
      el('div', { class: 'form-actions', style: 'display:flex; gap:10px; align-items:center' },
        el('button', { class: 'primary', style: 'width:auto', onclick: submit }, 'Log conversation'),
        el('button', { class: 'linkish', type: 'button', style: 'text-decoration:none', onclick: () => { open = false; draw(); } }, 'Cancel'),
      ),
    ));
  }

  draw();
  return wrap;
}
