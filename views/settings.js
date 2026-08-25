// Settings — Appearance and Notifications are phone-native (the dashboard has
// no equivalent; a static PWA needs its own theme toggle and push opt-in).
// Timezone, Modules, and Email capture are direct ports of
// apps/web/.../settings/{page.tsx,timezone-form.tsx,modules-form.tsx,
// integrations/email-capture/page.tsx} — plain CRUD against tables no secret
// gates, written straight to Supabase.
//
// Two sections are explicit gaps, not silently dropped:
//   - Integration status (env-var "configured/missing" inventory) reads
//     process.env on the API server; a static client has no server env to
//     read, so it isn't portable at all.
//   - Google Calendar connect/sync/disconnect need the API's OAuth flow and
//     client secret. This shows read-only status (safe columns only — never
//     the token columns) and points to the dashboard for the actions.

import { sb } from '../lib/db.js';
import { appSettings, loadAppSettings } from '../lib/settings.js';
import {
  el, hint, spinner, toast, fail, screenHead, sectionLabel,
  currentTheme, setTheme, niceStamp,
} from '../lib/ui.js';
import { enablePush, pushStatus } from './push.js';

const COMMON_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'Australia/Sydney', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London',
  'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Athens',
  'Asia/Tokyo', 'Asia/Singapore', 'Asia/Dubai', 'UTC',
];

export async function settingsView(mount) {
  mount.replaceChildren(screenHead('Setup', 'Settings'), spinner());
  await loadAppSettings();

  const body = el('div', {},
    appearanceSection(),
    notificationsSection(),
    timezoneSection(),
    modulesSection(),
    googleSection(),
  );
  mount.replaceChildren(screenHead('Setup', 'Settings'), body);

  // Email capture's data isn't loaded yet by the time the shell paints —
  // it's its own section rendered async so a slow query can't hold up
  // everything above it.
  const capSlot = el('div');
  body.append(capSlot);
  renderEmailCapture(capSlot);
}

function section(title, ...children) {
  return el('section', { class: 'settings-section', style: 'margin-top:22px' },
    sectionLabel(title),
    el('div', { style: 'padding-top:12px' }, ...children),
  );
}

// ─── Appearance ─────────────────────────────────────────────────────────

function appearanceSection() {
  const btn = el('button', { class: 'ghost', onclick: toggle },
    currentTheme() === 'dark' ? 'Switch to light' : 'Switch to dark');
  function toggle() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    btn.textContent = next === 'dark' ? 'Switch to light' : 'Switch to dark';
  }
  return section('Appearance', btn);
}

// ─── Notifications ──────────────────────────────────────────────────────

function notificationsSection() {
  const status = hint('');
  const btn = el('button', { class: 'ghost', onclick: async () => { await enablePush(); status.textContent = await pushStatus(); } }, 'Enable notifications');
  pushStatus().then((s) => { status.textContent = s; });
  return section('Notifications', btn, status, hint('Reminders only fire for tasks that have a due time and at least one reminder set.'));
}

// ─── Timezone ───────────────────────────────────────────────────────────

function timezoneSection() {
  const current = appSettings.timezone;
  const presetMatch = COMMON_TIMEZONES.includes(current) ? current : '';
  let preset = presetMatch;
  let custom = presetMatch ? '' : current;

  const presetSel = el('select', { onchange: (e) => { preset = e.target.value; if (preset) { custom = ''; customInput.value = ''; } paint(); } });
  presetSel.append(el('option', { value: '' }, '— pick one —'));
  for (const tz of COMMON_TIMEZONES) presetSel.append(el('option', { value: tz }, tz));
  presetSel.value = preset;
  const customInput = el('input', { type: 'text', placeholder: 'e.g. America/Boise', oninput: (e) => { custom = e.target.value; if (custom) { preset = ''; presetSel.value = ''; } paint(); } });
  customInput.value = custom;

  const currentLabel = el('span', { style: 'font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' });
  const saveBtn = el('button', { class: 'ghost small', style: 'width:auto', type: 'button', onclick: onSave }, 'Save');
  const msg = el('div', { style: 'margin-top:8px' });

  function effective() { return (custom || '').trim() || preset; }
  function paint() {
    currentLabel.textContent = `Current: ${appSettings.timezone}`;
    const dirty = effective() && effective() !== appSettings.timezone;
    saveBtn.disabled = !dirty;
    saveBtn.textContent = dirty ? 'Save' : 'Saved';
  }
  paint();

  async function onSave() {
    const tz = effective();
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); }
    catch { msg.replaceChildren(hint(`"${tz}" isn't a valid IANA timezone.`)); return; }
    saveBtn.disabled = true;
    const { error } = await sb.from('app_settings').update({ timezone: tz }).eq('id', true);
    saveBtn.disabled = false;
    if (error) { fail(error); return; }
    appSettings.timezone = tz;
    toast(`Timezone set to ${tz}.`);
    paint();
  }

  return section('Timezone',
    el('p', { style: 'font-family:var(--sans); font-size:13px; color:var(--ink-2); line-height:1.5; margin-bottom:12px' },
      'Used everywhere the app needs to know "what day is it" — task due dates, routine completions, journal dates.'),
    el('div', { class: 'row' },
      el('div', { class: 'field', style: 'flex:1; margin:0' }, el('label', {}, 'Common timezones'), presetSel),
      el('div', { class: 'field', style: 'flex:1; margin:0' }, el('label', {}, 'Or custom IANA name'), customInput),
    ),
    el('div', { style: 'display:flex; align-items:center; gap:12px; margin-top:12px' }, currentLabel, saveBtn),
    msg,
  );
}

// ─── Modules ────────────────────────────────────────────────────────────
// Daily Rule is deliberately left off this list — that whole module (evening
// shutdown flow, five-check scoring, recap/hedge) was never built on the
// phone, so its toggle would flip a flag with no observable effect here.

function moduleRow(name, description, flagKey, refresh) {
  const enabled = !!appSettings[flagKey];
  const btn = el('button', {
    class: enabled ? 'ghost small' : 'primary', style: enabled ? 'width:auto' : 'width:auto; margin:0',
    type: 'button',
    onclick: async () => {
      btn.disabled = true;
      const { error } = await sb.from('app_settings').update({ [flagKey]: !enabled }).eq('id', true);
      btn.disabled = false;
      if (error) { fail(error); return; }
      appSettings[flagKey] = !enabled;
      toast(!enabled ? `${name} module enabled.` : `${name} module hidden.`);
      refresh();
    },
  }, enabled ? 'Disable' : 'Enable');
  return el('div', { style: 'display:flex; align-items:flex-start; justify-content:space-between; gap:14px; padding:10px 0; border-bottom:1px solid var(--line)' },
    el('div', { style: 'min-width:0' },
      el('div', { style: 'font-family:var(--sans); font-size:14px; color:var(--ink)' }, name),
      el('p', { style: 'margin-top:3px; font-family:var(--sans); font-size:12px; color:var(--ink-3); line-height:1.5' }, description),
      el('div', { style: 'margin-top:4px; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' }, `Status · ${enabled ? 'enabled' : 'hidden'}`),
    ),
    btn,
  );
}

function modulesSection() {
  const slot = el('div', {});
  function render() {
    slot.replaceChildren(
      moduleRow('Health', 'Personal health record — visits, labs, metrics, medications. Data is retained either way; this only hides the nav entry.', 'health_module_enabled', render),
      moduleRow('Routines', 'Daily habit check-off with streaks. Data is retained — turn it back on anytime.', 'routines_module_enabled', render),
    );
  }
  render();
  return section('Modules', slot);
}

// ─── Google Calendar (read-only — connect/sync need the API's OAuth flow) ─

function googleSection() {
  const slot = el('div', {}, spinner());
  sb.from('google_oauth_tokens').select('scope, last_synced_at, expires_at').maybeSingle().then(({ data }) => {
    if (!data) {
      slot.replaceChildren(hint('Not connected. Connect Google Calendar from the dashboard — the OAuth flow needs a server-side client secret this phone app doesn’t have.'));
      return;
    }
    slot.replaceChildren(
      el('div', { style: 'font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3)' },
        `Status · connected · last synced ${data.last_synced_at ? niceStamp(data.last_synced_at) : 'never'}`),
      el('p', { style: 'margin-top:8px; font-family:var(--sans); font-size:11px; color:var(--ink-3); line-height:1.5' }, `Scopes: ${data.scope ?? '—'}`),
      hint('Sync and disconnect live on the dashboard.'),
    );
  });
  return section('Google Calendar', slot);
}

// ─── Email capture ──────────────────────────────────────────────────────
// Rotating/generating a new capture address needs CAPTURE_DOMAIN, an API-only
// env var — left off deliberately (rotate from the dashboard). Everything
// else here — the allow-list, rate limit, and log — is plain table CRUD.

async function renderEmailCapture(slot) {
  slot.replaceChildren(section('Email capture', spinner()));

  const [addrRes, allowRes, logRes] = await Promise.all([
    sb.from('capture_email_addresses').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('capture_sender_allowlist').select('*').eq('active', true).order('created_at', { ascending: true }),
    sb.from('email_capture_log').select('*').order('received_at', { ascending: false }).limit(20),
  ]);

  const addr = addrRes.data;
  const allowlist = allowRes.data ?? [];
  const log = logRes.data ?? [];

  function refresh() { renderEmailCapture(slot); }

  const addressBlock = addr
    ? el('div', {},
        el('div', { style: 'display:flex; flex-wrap:wrap; gap:8px; align-items:center' },
          el('code', { style: 'flex:1; min-width:220px; background:var(--surface-2); padding:8px 10px; font-family:var(--mono); font-size:12.5px; color:var(--ink); word-break:break-all' }, addr.address),
          el('button', {
            class: 'ghost small', style: 'width:auto', type: 'button',
            onclick: async () => { try { await navigator.clipboard.writeText(addr.address); toast('Copied'); } catch { toast('Copy failed', 'err'); } },
          }, 'Copy'),
        ),
        el('p', { style: 'margin-top:8px; font-family:var(--sans); font-size:12px; color:var(--ink-3); line-height:1.5' },
          'Forward any email to this address. Emails from allow-listed senders get parsed into tasks, notes, or CRM interactions.'),
      )
    : hint('No active capture address. Generate one from the dashboard.');

  const allowRows = allowlist.length === 0
    ? el('p', { style: 'font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent)' }, 'Empty — no email will be processed until you add a sender.')
    : el('div', {}, ...allowlist.map((s) => el('div', { style: 'display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line)' },
        el('span', { style: 'flex:1; min-width:180px; font-family:var(--mono); font-size:12.5px; color:var(--ink); word-break:break-all' }, s.email_address),
        s.label ? el('span', { style: 'font-family:var(--sans); font-size:11.5px; color:var(--ink-3)' }, s.label) : null,
        el('button', {
          class: 'linkish', type: 'button', style: 'text-decoration:none',
          onclick: async () => {
            if (allowlist.length <= 1) { toast('At least one sender must remain.', 'err'); return; }
            const { error } = await sb.from('capture_sender_allowlist').delete().eq('id', s.id);
            if (error) { fail(error); return; }
            toast('Removed');
            refresh();
          },
        }, 'Remove'),
      )));

  const emailInput = el('input', { type: 'email', placeholder: 'you@example.com' });
  const labelInput = el('input', { type: 'text', placeholder: 'e.g. iCloud email' });
  const addMsg = el('div', {});
  const addBtn = el('button', {
    class: 'primary', style: 'width:auto; margin:0', type: 'button',
    onclick: async () => {
      const email = emailInput.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { addMsg.replaceChildren(hint('Please enter a valid email address.')); return; }
      addBtn.disabled = true;
      const { error } = await sb.from('capture_sender_allowlist').insert({ email_address: email, label: labelInput.value.trim() || null });
      addBtn.disabled = false;
      if (error) { fail(error); return; }
      toast('Sender added');
      refresh();
    },
  }, 'Add sender');
  const addForm = el('div', {},
    el('div', { class: 'row' },
      el('div', { class: 'field', style: 'flex:1; margin:0' }, el('label', {}, 'Email address'), emailInput),
      el('div', { class: 'field', style: 'flex:1; margin:0' }, el('label', {}, 'Label (optional)'), labelInput),
    ),
    el('div', { style: 'margin-top:10px' }, addBtn),
    addMsg,
  );

  const rateInput = el('input', { type: 'number', min: '1', max: '10000', style: 'width:110px' });
  const rateBlock = addr ? (() => {
    rateInput.value = addr.rate_limit_per_hour;
    const rateMsg = el('div', {});
    const rateBtn = el('button', {
      class: 'ghost small', style: 'width:auto', type: 'button',
      onclick: async () => {
        const n = Number(rateInput.value);
        if (!Number.isInteger(n) || n < 1 || n > 10000) { rateMsg.replaceChildren(hint('Rate limit must be a positive integer.')); return; }
        rateBtn.disabled = true;
        const { error } = await sb.from('capture_email_addresses').update({ rate_limit_per_hour: n }).eq('id', addr.id);
        rateBtn.disabled = false;
        if (error) { fail(error); return; }
        toast('Saved');
      },
    }, 'Save');
    return el('div', {},
      el('p', { style: 'font-family:var(--sans); font-size:12px; color:var(--ink-3); line-height:1.5; margin-bottom:8px' }, 'Max processed emails per hour before the endpoint starts rejecting. Default 100.'),
      el('div', { style: 'display:flex; align-items:center; gap:10px' },
        el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Emails per hour'), rateInput), rateBtn),
      rateMsg,
    );
  })() : null;

  const logRows = log.length === 0
    ? el('p', { style: 'font-family:var(--sans); font-size:13px; color:var(--ink-3)' }, 'No inbound emails logged yet.')
    : el('div', {}, ...log.map((entry) => {
        const color = entry.status === 'processed' ? 'var(--ink)' : (entry.status === 'rate_limited' || entry.status.startsWith('rejected')) ? 'var(--ink-3)' : 'var(--accent)';
        const n = (entry.actions_created ?? []).length;
        return el('div', { style: 'padding:8px 0; border-bottom:1px solid var(--line)' },
          el('div', { style: 'display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; font-family:var(--mono); font-size:10.5px; text-transform:uppercase; letter-spacing:0.05em' },
            el('span', { style: 'color:var(--ink-3)' }, niceStamp(entry.received_at)),
            el('span', { style: `color:${color}` }, entry.status.replace(/_/g, ' ')),
            n > 0 ? el('span', { style: 'color:var(--ink-3)' }, `${n} action${n === 1 ? '' : 's'}`) : null,
          ),
          el('div', { style: 'margin-top:3px; font-family:var(--sans); font-size:12.5px; color:var(--ink-2)' },
            `${entry.from_address ?? '(unknown)'} — ${entry.subject ?? '(no subject)'}`),
          entry.error_message ? el('div', { style: 'margin-top:2px; font-family:var(--mono); font-size:10.5px; color:var(--accent)' }, entry.error_message) : null,
        );
      }));

  slot.replaceChildren(
    section('Email capture — your address', addressBlock),
    section('Email capture — allowed senders', allowRows, el('div', { style: 'margin-top:14px; padding-top:14px; border-top:1px solid var(--line)' }, addForm)),
    rateBlock ? section('Email capture — rate limit', rateBlock) : null,
    section('Email capture — recent log', logRows),
  );
}
