# Roseberry Ops — phone app

A static PWA covering the whole Ops system: today's view, tasks, routines,
quick capture, notes, calendar, people, library, health and content. No build
step, no server, no hosting bill, no Play Store.

It talks straight to Supabase using the **publishable** key plus a normal
sign-in. Every table has RLS requiring an authenticated user and public signups
are disabled, so the key in `config.js` grants nothing on its own and is safe
to publish.

## Design

This app wears the dashboard's design system — v2 "high-contrast editorial".
The tokens in `index.html` are copied verbatim from
`apps/web/src/styles/globals.css` and `apps/web/tailwind.config.ts`, so the
phone and the dashboard are demonstrably the same product:

- **Type** — Newsreader (display), Geist (body), Geist Mono (eyebrows, meta,
  pills), loaded from Google Fonts with real fallback stacks.
- **Colour** — warm linen canvas and rust accent. Every screen is a mono
  eyebrow over a Newsreader title; lists are hairline-divided rows on the
  canvas, not boxes inside boxes.
- **Status** — the one place the palette leaves monochrome: pills in four
  states (overdue / due / on track / quiet), each a colour, soft fill and
  border with a leading dot.
- **Radius** — 5px throughout.

**The phone defaults to dark; the dashboard defaults to light.** That is
deliberate — this gets used outdoors and before dawn. Both palettes are the
same design, and the toggle is in More → Settings, remembered per device.

## One app, two shapes

There is no separate desktop build. The same files rearrange themselves at
**800px** — the gate the dashboard uses — so one URL serves both:

- **Narrow (phone).** Five tabs along the bottom (Today, Work, Content,
  People, Library) plus a More bottom sheet, with capture on a floating
  button because it's an action available anywhere rather than a destination.
- **Wide (desktop).** The bottom bar and floating button give way to a 64px
  icon rail down the left, expanding to 236px on hover to reveal labels. The
  rail has room for every destination, so the More sheet is not used. Content
  is capped at 1120px and centred, the display title grows to 40px, and search
  and filters sit side by side.

This is the pattern Roseberry Planner already uses — one responsive static
file, installed as an app on the phone and opened in a browser on a laptop.
It means the desktop needs no hosting, nothing to start, and works from any
machine, not just the one the repo is checked out on.

## How it's put together

Plain ES modules, loaded directly by the browser. Nothing is bundled,
transpiled or minified — the files served are the files in this folder, which
is what makes "edit, push, done" possible with no toolchain.

| File | Purpose |
|---|---|
| `index.html` | Shell and all styles. The app itself renders into `<main>` |
| `app.js` | Boot, sign-in, route table, tab bar, More sheet, settings |
| `config.js` | Supabase URL + publishable key + VAPID **public** key |
| `schema.js` | Descriptors for every browsable collection — see below |
| `lib/db.js` | Supabase client and the cached reference lists behind pickers |
| `lib/router.js` | Hash router |
| `lib/engine.js` | Generic list + form rendering, driven by `schema.js` |
| `lib/ui.js` | Element helpers, date formatting, chips, toasts |
| `views/today.js` | Home screen: focus, attention, events, due tasks, routines |
| `views/tasks.js` | Task list and editor |
| `views/routines.js` | Daily tick list and streaks |
| `views/capture.js` | One-screen quick capture |
| `views/group.js` | Area index behind the Work / People / Library tabs |
| `views/push.js` | Web Push registration for this device |
| `sw.js` | Service worker. Its only job is receiving push while closed |
| `manifest.json` | Makes it installable, and what Bubblewrap reads for the APK |

### The descriptor pattern

Most of this app is one shape repeated: list rows, edit a row, delete a row.
Rather than write that fifteen times, each area is *described* in `schema.js`
and rendered by `lib/engine.js`:

```js
notes: {
  key: 'notes', table: 'notes', label: 'Notes', singular: 'note',
  order: { col: 'created_at', asc: false },
  search: ['title', 'body'],
  fields: [ { name: 'body', label: 'Note', type: 'textarea', required: true } ],
  title: (r) => r.title || r.body.split('\n')[0],
  meta:  (r) => niceDate(r.created_at),
}
```

That gets you a searchable list, an add form, an edit form and a delete, routed
at `#/c/notes`. Adding an area is a descriptor plus a line in `views/more.js`.
**Removing one is deleting the descriptor** — which matters, because the plan
here is to build broadly, find what actually gets used, and cut the rest.

Only Today, Tasks and Routines are hand-written, because they act on rows
(ticking, snoozing) rather than just opening them.

Every `chips` field's options are copied from that column's CHECK constraint in
Postgres. Inventing a value that isn't in the constraint fails the insert, so
those lists must stay in step with the schema.

## Hosting

Needs HTTPS — service workers and push refuse to run over plain HTTP, and a
phone can't use `localhost`.

Live at **https://tjdscgit.github.io/ops-phone/**, served by GitHub Pages from
the **public** repo `tjdscgit/ops-phone`. This folder is the canonical source;
the public repo is a published copy, and exists only because Pages on a free
plan won't serve a private repo.

**Both have to be pushed, or the live site goes stale.**

Because the Android app is a thin wrapper around that URL, pushing the mirror
updates the app on the phone. A new APK is only needed when native pieces
change — the widget, the tile, or the manifest.

## Local development

```bash
python -m http.server 5177 --directory apps/phone
```

Then open `http://127.0.0.1:5177/`. Service worker registration fails over
plain HTTP on some setups; everything except push still works.

## Setup

### 1. Generate VAPID keys

These sign your push messages. One pair, generated once — the public and
private halves **must** come from the same run, or sends fail with a `403`
that sometimes disguises itself as a `410`:

```bash
npx web-push generate-vapid-keys
```

- **Public key** → `vapidPublicKey` in `config.js` (safe to commit)
- **Private key** → GitHub repo secret only. Never commit it

### 2. GitHub repo secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://dcauvbdjizhyrdpiaeus.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase → Project Settings → API |
| `VAPID_PUBLIC_KEY` | Public half from step 1 |
| `VAPID_PRIVATE_KEY` | Private half from step 1 |
| `VAPID_SUBJECT` | `mailto:gday@roseberrygrowers.com.au` |

### 3. Enable notifications on the phone

1. Open the hosted URL in Chrome on Android
2. Sign in
3. **Add to Home screen** when prompted (push is more reliable installed)
4. **More → Enable notifications**, and accept the permission prompt

That registers the device in `push_subscriptions`. The scheduled job takes it
from there.

## How reminders fire

`.github/workflows/send-reminders.yml` runs `scripts/send-reminders.mjs` every
15 minutes on GitHub Actions — free, and nothing needs to be left running.

A task produces a reminder when it is open, due today, **has a due time**, and
has at least one entry in `reminder_offsets` (minutes before the due time; `0`
means at the time). Tasks with only a date and no time never fire — that's
deliberate, not a bug.

Duplicate sends are prevented by the task's `reminders_sent` map, so the
every-15-minutes schedule can't notify you twice for the same thing. Editing a
task's due date or time clears that map, so a moved deadline reminds you again.

Push is sent at `urgency: 'high'`; the default gets held back indefinitely by
Android's battery saver.

Dead subscriptions (uninstalled app, revoked permission) return 404/410 from
the push service and are deleted automatically.

## Testing without waiting

Trigger a run by hand from the repo's **Actions** tab → *Send task reminders* →
*Run workflow*. To give it something to find, create a task due today with a
time a few minutes in the past and a reminder of "At time".
