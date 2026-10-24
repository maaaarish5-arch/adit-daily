---
name: daily
description: Start a work session on the USMLE Vault "Founder's Office" dashboard (repo maaaarish5-arch/adit-daily, live at usmlevault-daily.vercel.app). Sets up a fresh branch, the house rules, local preview, and the push-and-verify routine. Use when the user runs /daily, or asks to change, fix or add something on the dashboard, Check-in, Students, Trackers, Notes, or the live site.
argument-hint: <what you want changed, optional>
---

# /daily: work on the dashboard

The user wants to change the live dashboard at **https://usmlevault-daily.vercel.app**
(Check-in, Students, Trackers, Notes, Sales Calendar, To-do, SOP…). If they gave a
request with the command, do it after setup. If not, finish setup and ask, in one
line, what they want changed.

## Setup (every time)

1. **Working copy**: the adit-daily repo you are in right now (it has `CLAUDE.md`
   and `app/` at its root). If you are somewhere else, ask the user to open Claude
   inside their adit-daily folder. If `node_modules` is missing, run `npm install`.
2. **Fresh branch from live code**: `git fetch -q origin`, check
   `git status --short` is clean (if not, look at what's there and ask before
   discarding anything), then `git switch -q -c <short-topic> origin/main`.
3. **Read `CLAUDE.md`** in the repo. It maps the files and holds the standing
   rules.
4. **Real data for previews**: the local copy reads `.data/*.json`. Refresh
   `.data/roster.json` from the live site with a read-only GET
   (`curl -s $SITE/api/roster`) when it matters for the change. **Previews must
   show real students, never made-up ones.**

## While working

- Match the code around you: comment density, naming, plain CSS, ink/bone/lime
  theme tokens.
- **Type-check** with `npx tsc --noEmit` and **build** with `npx next build`.
- **Preview locally**: `npx next start -p 3006` (background), and give the user
  `http://localhost:3006`. Test in headless Chrome
  (`C:/Program Files/Google/Chrome/Application/chrome.exe`, puppeteer-core in a
  scratch folder) before saying something works.
- **Test writes go to the local copy only.** Back up `.data/*.json` first and
  restore it afterwards.
- **Never write to live data** (`POST` to `$SITE/api/...`) without the user's
  explicit OK. The exception is `/checklist`, which publishes trackers directly.
- The machine runs low on memory. Stopping the background task can leave the
  Next.js server running. Free port 3006 by checking the process command line
  contains the clone's folder name and `next start -p 3006`, then stop that PID.
  Stop the preview when the work is done.

## Going live: only when the user says "push"

1. `git fetch -q origin` and check `origin/main` hasn't moved past your base. If
   it has, rebase onto it.
2. `npx tsc --noEmit`, then commit with
   the git name and email already set on this computer (`git config user.name`).
   Use a plain message ending with the Co-Authored-By line.
3. `git push origin HEAD:main`. Pushing to main **is** deploying.
4. **Verify**: poll `gh api repos/maaaarish5-arch/adit-daily/commits/<sha>/status`
   until it's `success` or `failure`. A failed Vercel build leaves the old site
   up silently. On failure, read the logs with `npx vercel inspect <dpl> --logs`,
   fix, and push again. On success, grep the live JS bundle for a string from the
   change.
5. Tell the user it's live only after that check.

## Reporting

- Plain language for a non-developer: what changed, where to see it, what was
  tested.
- Mention any trade-off or choice made, in one line.
- No code dumps.

## Standing rules (from the user)

- No WhatsApp sending and no wa.me links.
- No phone numbers.
- No "Reset all" anywhere.
- Don't invent operational content (scripts, policy). That needs Dr. Marish.
