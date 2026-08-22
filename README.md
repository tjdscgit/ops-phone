# Roseberry Ops — phone app

A small static PWA: quick task capture, today's list, and Web Push
notifications. Built to the "cheap Android app" pattern — no server, no
hosting bill, no Play Store.

It talks straight to Supabase using the **publishable** key plus a normal
sign-in. Every table has RLS requiring an authenticated user and public
signups are disabled, so the key in `config.js` grants nothing on its own and
is safe to publish.

This is separate from the Next.js dashboard in `apps/web`, which stays as the
full desktop tool. This app is deliberately just the phone surface.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app — sign-in, quick add, today's list, push toggle |
| `sw.js` | Service worker. Its only job is receiving push while the app is closed |
| `config.js` | Supabase URL + publishable key + VAPID **public** key |
| `manifest.json` | Makes it installable, and is what Bubblewrap reads to build the APK |

## Setup

### 1. Generate VAPID keys

These sign your push messages. One pair, generated once:

```bash
npx web-push generate-vapid-keys
```

- **Public key** → paste into `vapidPublicKey` in `config.js` (safe to commit)
- **Private key** → GitHub repo secret only. Never commit it, never put it in
  `config.js`

### 2. Add GitHub repo secrets

Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://dcauvbdjizhyrdpiaeus.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase → Project Settings → API |
| `VAPID_PUBLIC_KEY` | Public half from step 1 |
| `VAPID_PRIVATE_KEY` | Private half from step 1 |
| `VAPID_SUBJECT` | `mailto:gday@roseberrygrowers.com.au` |

### 3. Host it

Needs HTTPS — service workers and push refuse to run over plain HTTP, and a
phone can't use `localhost`.

Because this repo is **private**, GitHub Pages isn't available on a free plan.
Use one of these instead, all free and all able to deploy from a private repo:

- **Cloudflare Pages** — connect the repo, set the build output directory to
  `apps/phone`, no build command
- **Netlify** — same, publish directory `apps/phone`
- **Vercel** — same, root directory `apps/phone`

The alternative is a separate public repo, but there's no need — nothing here
is secret, yet there's also no reason to publish it.

### 4. Enable notifications on the phone

1. Open the hosted URL in Chrome on Android
2. Sign in
3. **Add to Home screen** when prompted (push is more reliable installed)
4. Tap **Enable notifications** and accept the permission prompt

That registers the device in `push_subscriptions`. The scheduled job takes it
from there.

## How reminders fire

`.github/workflows/send-reminders.yml` runs `scripts/send-reminders.mjs` every
15 minutes on GitHub Actions — free, and nothing needs to be left running.

A task produces a reminder when it is open, due today, **has a due time**, and
has at least one entry in `reminder_offsets` (minutes before the due time; `0`
means at the time). Tasks with only a date and no time never fire — that's
deliberate, not a bug.

Duplicate sends are prevented by the task's existing `reminders_sent` map, so
the every-15-minutes schedule can't notify you twice for the same thing.

Dead subscriptions (uninstalled app, revoked permission) return 404/410 from
the push service and are deleted automatically.

## Testing without waiting

Trigger a run by hand from the repo's **Actions** tab → *Send task reminders* →
*Run workflow*. To give it something to find, create a task due today with a
time a few minutes in the past and a reminder of "At time".
