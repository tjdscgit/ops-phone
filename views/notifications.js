// Notifications — the audit feed of voice actions and autonomous moves. A
// port of apps/api/src/routes/notifications.ts's list: newest first, tap to
// mark read, dismiss to hide without deleting.

import { sb } from '../lib/db.js';
import { el, hint, spinner, screenHead, niceStamp, pill, humanise } from '../lib/ui.js';

export async function notificationsView(mount) {
  mount.replaceChildren(
    screenHead('Feed', 'Notifications', {
      actions: [el('button', { class: 'ghost small', type: 'button', onclick: markAllRead }, 'Mark all read')],
    }),
    spinner(),
  );

  const { data, error } = await sb.from('notifications').select('*')
    .order('created_at', { ascending: false }).limit(50);

  if (error) { mount.lastChild.replaceWith(hint(error.message)); return; }

  const rows = data ?? [];
  if (!rows.length) {
    mount.lastChild.replaceWith(hint('Nothing here yet.'));
    return;
  }

  mount.lastChild.replaceWith(el('div', { class: 'list' }, ...rows.map(row)));

  async function markAllRead() {
    await sb.from('notifications').update({ status: 'read' }).eq('status', 'unread');
    notificationsView(mount);
  }
}

function row(n) {
  const unread = n.status === 'unread';
  return el('button', {
    class: 'item row-item', type: 'button',
    onclick: async () => {
      if (unread) await sb.from('notifications').update({ status: 'read' }).eq('id', n.id);
      if (n.source_url) window.open(n.source_url, '_blank', 'noopener');
    },
  },
    el('div', { class: 'item-body static', style: 'flex:1' },
      el('div', { class: 'item-title' }, unread ? el('b', {}, n.title) : n.title),
      el('div', { class: 'item-meta plain' }, n.body ?? ''),
      el('div', { class: 'item-meta' }, humanise(n.type), niceStamp(n.created_at)),
    ),
    unread ? pill('solid', 'New', false) : null,
  );
}
