// Attention — every active attention item, not just Today's top 10.
// The rail's Attention destination (dashboard: /attention). Today still shows
// its own capped preview; this is the full list with the same actions.

import { sb } from '../lib/db.js';
import { el, hint, spinner, screenHead, toast, fail, pill, ymd, addDays } from '../lib/ui.js';

export async function attentionView(mount) {
  mount.replaceChildren(screenHead('Flagged', 'Attention'), spinner());

  const t = ymd();
  const { data, error } = await sb.from('attention_items').select('*')
    .eq('status', 'active')
    .or(`snoozed_until.is.null,snoozed_until.lte.${t}`)
    .order('score', { ascending: false, nullsFirst: false });

  if (error) { mount.lastChild.replaceWith(hint(error.message)); return; }

  const rows = data ?? [];
  if (!rows.length) {
    mount.lastChild.replaceWith(hint('Nothing needs attention.'));
    return;
  }

  mount.lastChild.replaceWith(
    el('div', { class: 'list' }, ...rows.map((a) => attentionRow(a, mount))),
  );
}

function attentionRow(a, mount) {
  const act = async (patch, msg) => {
    const { error } = await sb.from('attention_items').update(patch).eq('id', a.id);
    if (error) { fail(error); return; }
    toast(msg);
    attentionView(mount);
  };

  return el('div', { class: 'item', style: 'cursor:default' },
    el('div', { style: 'display:flex; align-items:flex-start; gap:8px' },
      el('div', { style: 'flex:1; min-width:0' },
        el('div', { class: 'item-title serif' }, a.title),
        a.detail ? el('div', { class: 'item-meta plain' }, a.detail) : null,
      ),
      a.urgency === 'high' ? pill('over', 'High') : null,
    ),
    a.suggested_action
      ? el('div', { class: 'item-meta plain', style: 'font-style:italic' }, a.suggested_action)
      : null,
    el('div', { class: 'actions' },
      el('button', {
        class: 'ghost small',
        onclick: () => act({ status: 'acted_on', acted_on_at: new Date().toISOString() }, 'Marked done'),
      }, 'Done'),
      el('button', {
        class: 'ghost small',
        onclick: () => act({ status: 'snoozed', snoozed_until: ymd(addDays(new Date(), 1)) }, 'Snoozed'),
      }, 'Snooze'),
      el('button', {
        class: 'ghost small',
        onclick: () => act({ status: 'dismissed', dismissed_at: new Date().toISOString() }, 'Dismissed'),
      }, 'Dismiss'),
    ),
  );
}
