# adit-daily — Founder's Office daily tracker

This repo is the app Adit works from every day: **https://adit-daily.vercel.app**

Adit is not a developer. He will describe what he wants in plain language — a
new task on the checklist, a change to a script, a new link. Your job is to make
that change correctly, deploy it, and tell him in plain language what happened.

## Golden rules

1. **Almost everything Adit asks for lives in one file: `lib/tasks.ts`.**
   The checklist, the score, the month grid, the daily report and the SOP tab
   are all generated from the `SECTIONS` and `PLAYBOOKS` arrays in that file.
   Add a task there and every surface follows automatically. Do not build new
   UI for something that is really just a new row.

2. **Never invent operational content.** Message scripts, links, payment terms,
   student procedure — these come from Dr. Marish. If Adit asks for a script and
   has not given you the wording, write a clear placeholder and tell him it
   needs Dr. Marish's approval. Do not draft policy and present it as settled.

3. **Deploy after every accepted change**, then verify it is actually live.
   Compiling is not shipping.

4. **Never touch the live data casually.** The roster holds 100+ real students.
   If a change could rewrite stored data, back it up first (see below).

5. **Ask before deleting anything** — a student, a section, a stored day.

## Making a change

```bash
npm install          # first time only
npm run dev          # http://localhost:3000
npx next build       # must pass before deploying
```

Then commit and push. **Pushing to `main` deploys the live site automatically**
— there is no separate deploy step, and there is no staging. Treat a push as
publishing.

```bash
git add -A && git commit -m "describe the change" && git push
```

Verify it actually shipped — the page is client-rendered, so `curl` on the HTML
will not show your text. Check the built bundle instead:

```bash
for f in $(curl -s https://adit-daily.vercel.app/ | grep -o '/_next/static/chunks/app/page[a-zA-Z0-9._-]*\.js' | sort -u); do
  curl -s "https://adit-daily.vercel.app$f" | grep -q "some exact text you added" && echo "LIVE"
done
```

## How the app is built

Next.js 15 App Router, React 19, TypeScript. No component library, no state
library. Styling is plain CSS in `app/globals.css` using the variables at the
top — ink background, bone text, one lime signal colour. Match what is there.

| Path | What it is |
|---|---|
| `lib/tasks.ts` | **The daily checklist and the whole SOP.** Start here. |
| `lib/roster.ts` | Student records, instalments, derived payment status |
| `lib/checkin.ts` | Daily "did we take an update" check-ins |
| `lib/shifts.ts` | Clock in/out, the two IST shift windows |
| `lib/activity.ts` | Append-only time log and presence buckets |
| `lib/store.ts` | All Redis reads and writes. Change storage only here. |
| `app/page.tsx` | Tabs, checklist, clock, close-out report |
| `app/roster-view.tsx` | Students tab |
| `app/checkin-view.tsx` | Check-in tab |
| `app/dump-view.tsx` | Checklist tab � the free-form brain-dump task list (`lib/dump.ts`, `/api/dump`, Redis key `adit:dump`). Separate from the scored daily checklist in `lib/tasks.ts`. |
| `app/date-field.tsx` | Day/month/year dropdowns — read the comment before editing |

Data lives in Upstash Redis, keyed `adit:*`. Credentials are environment
variables on Vercel; they are deliberately **not** in this repo and you do not
need them. Running locally with no credentials falls back to JSON files under
`.data/`, so local work never touches live student data.

## Things that will bite you

- **Never store a raw `<input type="date">` value in state as you type.** A
  native date input reports `""` until all three parts are filled, so a
  controlled field erases what is being typed. This is why `date-field.tsx`
  exists. Use that component; do not reintroduce a plain date input.
- **The daily report is generated in `app/page.tsx` (`buildReport`)**. If you
  add something Dr. Marish should see nightly, add it there too, or it exists
  on screen and nowhere else.
- **Adding a task changes the score.** A+ is 75% of the total row count, so
  every new row makes the day slightly harder. Say so when you add one.
- **Payment status is derived, never typed.** `summarise()` in `lib/roster.ts`
  computes it from the instalments. Do not add a way to set it by hand — that
  was the bug the rebuild removed.
- **The activity log is append-only on purpose.** Never add an edit or delete
  path to `/api/log`.

## Backing up before risky work

```bash
curl -s https://adit-daily.vercel.app/api/roster > roster-backup.json
```

That is the roster. For everything, ask Dr. Marish — he has the Redis keys.

## What needs Dr. Marish, not you

- Any new student-facing script, price, payment term, or policy
- Deleting students or historical data
- Anything touching a different Vercel project or a different site
- Sending any message to a student on his behalf
