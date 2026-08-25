// App-wide settings cache — the phone counterpart of apps/web's
// lib/app-settings.ts. `app_settings` is a singleton row (id is a boolean
// primary key, always `true`). Loaded once at boot alongside the reference
// lists in lib/db.js, and re-read after any edit on the Settings screen so
// nav visibility (Health) updates without a full reload.

import { sb } from './db.js';

export const appSettings = {
  timezone: 'UTC',
  health_module_enabled: false,
  routines_module_enabled: true,
  loaded: false,
};

export async function loadAppSettings() {
  const { data } = await sb.from('app_settings').select('*').eq('id', true).maybeSingle();
  if (data) Object.assign(appSettings, data);
  appSettings.loaded = true;
}
