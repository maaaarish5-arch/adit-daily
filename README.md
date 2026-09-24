# Founder's Office — Adit

One page, two tabs. **Today** is the checklist. **SOP** is the manual behind it.

**Local:** http://localhost:3111 (`npm run dev` for :3000)
No login. Open the link and tick. Dr. Marish opens the same URL and sees the same day.

If a lock is ever wanted, set an `APP_PASSCODE` env var and redeploy — the app gates saving on it automatically.

## How it works

- The page reads the device clock and opens on **today**. Every day of every month exists automatically. If the page is left open overnight it rolls to the new day on its own.
- Score = completed rows ÷ 21. **≥75% → A+ day. Below 75% → C- day.** Two bands, nothing else.
- Ticks save automatically, half a second after the last change. The dot in the header shows Saving / Saved / Not saved.
- The month grid shows every day: lime pip = A+, rust pip = C-, grey = no entry. Click any day to open it.
- **Daily close-out** generates the report with the real score and whatever is still open. Copy it, send it to Dr. Marish, then tick the last row.

## Row types

| Type | Behaviour | Used by |
|---|---|---|
| Box | Plain tick | Most rows |
| Pills | Counts only when every pill is on | Twitter, LinkedIn, the three Instagram accounts |
| Counter | Counts when it reaches its target | Instagram sweeps (6/day) |
| Slots | Each tap stamps the real time it was sent | Onboarding follow-ups (60 min / 120 min / 6 hr) |

**Onboarding** carries an N/A switch in its section head. Flip "No students onboarded today" and all seven of its rows count as done — and the daily report says so explicitly, so a skipped section is never mistaken for a finished one.

## The SOP layer

Every row with a procedure has a **How to do this** toggle that opens it inline. The same procedures, plus the enquiry playbooks and the full link/login list, live in the **SOP** tab for reading cold.

Scripts inside an SOP are copy-and-send — one button, straight to clipboard. Credentials are hidden behind a Reveal tap.

## Editing

Everything lives in `lib/tasks.ts` — one `SECTIONS` array plus a `PLAYBOOKS` array. Add or remove a task there and the score, the sections, the month grid, the nightly report and the SOP tab all follow automatically.

## Storage

Upstash Redis via the Vercel Marketplace. One key per day: `adit:day:YYYY-MM-DD`.

Env vars (injected by the integration): `KV_REST_API_URL`, `KV_REST_API_TOKEN`.
Env var (optional): `APP_PASSCODE`. Unset — saving is open to anyone with the link.

Tick values are of three kinds: `true` for boxes and pills, a number for the sweep counter, an ISO timestamp for follow-up slots. `/api/day` validates and clamps all three; anything cleared is dropped rather than stored.

If neither Redis var is present, local `npm run dev` falls back to a JSON file at `.data/days.json`. On Vercel it deliberately **errors instead of falling back**, because the serverless filesystem is per-instance and ephemeral — a silent fallback would lose ticks.

## Still to fill in

- **Step 1 registration** — the FSMB / portal detail under the registration reel.
- **Instagram content calendar** — which file is live.
- **Contract** — sample to clone; the old `contract-generator` path no longer exists.
- **Payment DM** — wording is a draft, pending approval.
- **Transcript sync** — procedure lands when the Obsidian brain is wired up.

## Deploy

```bash
vercel --prod --yes
```
