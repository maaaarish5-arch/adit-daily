# adit-daily — Founder's Office daily tracker

This repo is the app Adit works from every day: **https://usmlevault-daily.vercel.app**

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

**Adding instalments / a payment plan to a student is a data change, not a code
change.** Use the `/instalments` skill (`.claude/skills/instalments/SKILL.md`),
which backs up, edits one student, and verifies. Never hand-POST the roster.

```bash
npm install          # first time only
npm run dev          # http://localhost:3000
npx next build       # must pass before deploying
```

Then commit and push. **Pushing to `main` deploys the live site automatically**
— there is no separate deploy step, and there is no staging. Treat a push as
publishing.

**Previews:** any other branch gets a Vercel preview URL. A preview reads a copy
of the live data (students, check-ins, days, corners, to-dos) from the live
site's GET routes and keeps every edit in memory. It never writes to the live
store (`previewSandbox` in `lib/store.ts`), and a rust banner says so. Use a
branch + pull request when the person wants to check a change before it goes
live.

```bash
git add -A && git commit -m "describe the change" && git push
```

Verify it actually shipped — the page is client-rendered, so `curl` on the HTML
will not show your text. Check the built bundle instead:

```bash
for f in $(curl -s https://usmlevault-daily.vercel.app/ | grep -o '/_next/static/chunks/app/page[a-zA-Z0-9._-]*\.js' | sort -u); do
  curl -s "https://usmlevault-daily.vercel.app$f" | grep -q "some exact text you added" && echo "LIVE"
done
```

## How the app is built

Next.js 15 App Router, React 19, TypeScript. No component library, no state
library. Styling is plain CSS in `app/globals.css` using the variables at the
top — ink background, bone text, one lime signal colour. Match what is there.

| Path | What it is |
|---|---|
| `lib/tasks.ts` | **The daily checklist and the whole SOP.** Start here. |
| `lib/roster.ts` | Student records, instalments, derived payment status. `currentPhase()` derives P1→P2 after 14 days and P3→P4 from 7 days before `examDate` (P3 may carry an exam date). |
| `lib/roster-order.ts` | Students tab sort options. Left always sinks to the bottom. The order is held between sorts so rows don't jump mid-edit. |
| `lib/checkin.ts` | Daily "did we take an update" check-ins. Match students are owed one **every other day** from 11 Oct 2026 (or the day after moving to Match): see `checkinDue()` in `lib/roster.ts`. Off days drop them from the list and the count. |
| `lib/shifts.ts` | Clock in/out, the two IST shift windows |
| `lib/activity.ts` | Append-only time log and presence buckets |
| `lib/store.ts` | All Redis reads and writes. Change storage only here. |
| `app/page.tsx` | Tabs, checklist, clock, close-out report |
| `app/roster-view.tsx` | Students tab |
| `app/checkin-view.tsx` | Check-in tab |
| `lib/corners.ts` | **The three Corners** (Adit, Shreeman, Sanskar): each person's checklist, clock, grade and close-out. Edit the `CORNERS` array to change a person's list. |
| `app/corner-view.tsx` | One corner page. Days stored per person in Redis as `adit:corner:<person>:<date>` (`/api/corner`, `/api/corner/month`). |
| `app/todos-view.tsx` | To-do tab. The old Checklist tab was retired into it on 5 Oct 2026 — its tasks were merged in once (as Adit's items, with priority) by `/api/todos`. `adit:dump` is kept untouched as a backup. |
| `app/date-field.tsx` | Day/month/year dropdowns — read the comment before editing |
| `lib/memo.ts`, `app/memo-box.tsx` | The **Notes** box on Check-in (per student, red dot after 3 days unopened). Written only by `/api/memo`. |
| `lib/trackers.ts` | **Student trackers**: the study plans sent to students. A plan (written by the `/checklist` skill through `/api/trackers`) plus ticks (written by the student through `/api/t/<token>`). |
| `app/t/[token]/` | The student's tracker page — the link sent on WhatsApp. Light "paper" look in `app/t/tracker.css`, scoped under `.trk`. No passcode: the link is the key. |
| `app/trackers-view.tsx` | Trackers tab: every tracker by student, progress, archive. On Check-in, a small ring beside a student's name opens their newest live one in a new tab, and it fills as they tick tasks. |

Data lives in Upstash Redis, keyed `adit:*`. Credentials are environment
variables on Vercel; they are deliberately **not** in this repo and you do not
need them. Running locally with no credentials falls back to JSON files under
`.data/`, so local work never touches live student data.

## Student trackers

New trackers are made with the **`/checklist` skill** (a personal Claude Code
skill in `~/.claude/skills/checklist/`, not in this repo). It writes the plan as
JSON and POSTs it to `/api/trackers` — never HTML. A score typed on a task tagged
`score: {kind, key}` fills that progress pill: a system's pill holds its **UWorld
average**, an NBME pill that form's score. There is deliberately **no reset**
anywhere — progress is shared, so one tap would wipe it for everyone.

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
curl -s https://usmlevault-daily.vercel.app/api/roster > roster-backup.json
```

That is the roster. For everything, ask Dr. Marish — he has the Redis keys.

## What needs Dr. Marish, not you

- Any new student-facing script, price, payment term, or policy
- Deleting students or historical data
- Anything touching a different Vercel project or a different site
- Sending any message to a student on his behalf
