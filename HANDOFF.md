# Read me first, Adit

This is the code behind your daily tracker: **https://adit-daily.vercel.app**

You do not need to understand it. You need to know three things: how to open it,
how to ask for a change, and what you must not do alone.

## One-time setup on your laptop

You need three things installed: **Node.js**, **Git**, and **Claude Code**.

Then, in Terminal:

```bash
git clone https://github.com/OWNER/adit-daily.git
cd adit-daily
npm install
claude
```

That last command opens Claude Code inside the project. It reads `CLAUDE.md`
automatically, so it already knows how the app is built and what the rules are.
You do not have to explain the project to it.

## How to ask for a change

Talk to it the way you would talk to a person. Plain sentences. For example:

- "Add a task to the morning shift: check the Step 1 community for new questions."
- "Change the payment DM script — here is the new wording: ..."
- "The resources link is wrong, it should be this one: ..."
- "Add a filter on the Students tab for students who joined this month."

Good habits:

- **Say exactly what you want in the words you want.** If it is a message
  students will read, paste the exact text. Claude should not be inventing
  wording that goes to a student.
- **Ask it to show you before it deploys** if you are unsure.
- **Tell it when something looks wrong.** "The date dropdown is not saving" is a
  perfectly good bug report. Say what you clicked and what you expected.

When it finishes, it will push the change and the live site updates by itself,
usually within a minute. Refresh the page — a hard refresh (Cmd+Shift+R) if it
looks unchanged.

## What you must not do without asking Dr. Marish

- **Never write a new student-facing script yourself.** Prices, payment terms,
  onboarding messages, anything a student reads — those are his words, not
  yours and not Claude's.
- **Never delete students or old records.** Removing a student from the tracker
  cannot be undone.
- **Never touch another website.** This repo is only the daily tracker. If
  Claude offers to change something else, stop and ask.
- **Never share the link to the tracker outside the Founder's Office.** It has
  no password on it, and the SOP tab contains the Vault admin login.

## If something breaks

Tell Dr. Marish immediately, with the exact words: what you did, what happened,
and what you expected. A broken deploy can be rolled back in seconds, but only
if someone knows it happened.

Do not try to fix a broken site by making more changes.

## What the app actually is

Five tabs:

- **Today** — the checklist, the clock in/out, and the nightly close-out report
- **Check-in** — who you took an update from today, and what came of it
- **Students** — the roster, payment plans, instalments, what is owed
- **Time logs** — an append-only record of your clock events and time on the page
- **SOP** — every procedure, every script, every link

The checklist, the report and the SOP all come from one file (`lib/tasks.ts`),
which is why a change to the SOP shows up on the checklist automatically.
