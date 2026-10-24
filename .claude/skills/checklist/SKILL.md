---
name: checklist
description: Turn a student study plan (spoken or written, usually Dr. Marish's) into a live USMLE Vault student tracker on usmlevault-daily.vercel.app and return its link. Use when the user runs /checklist <student> <plan>, or asks to make, build, publish, update or fix a checklist, tracker, study plan or sprint for a student.
argument-hint: <student name> <pasted plan>
---

# /checklist: publish a student tracker

You turn a study plan into a **live tracker** at
`https://usmlevault-daily.vercel.app/t/<token>`.
- The student ticks tasks and types scores there.
- Anyone with the link sees the same progress.
- The site's **Trackers** tab lists every tracker.
- On Check-in, a small ring beside the student's name opens their newest tracker.
- A score typed on a tagged task fills that student's progress pill on Check-in.

These rules come from the original "USMLE Vault Checklist Generator" project (kept
in `project-instructions.md` next to this file). One thing changed: **you no longer
write HTML.** You write the plan as JSON (schema below), and the site draws it in the
same template, with ticks saved for everyone. No STORAGE_KEY, and **no "Reset all"
anywhere**.

The user sends the link on WhatsApp themselves. **Never send a message and never
offer a wa.me / WhatsApp link.**

`SITE=https://usmlevault-daily.vercel.app`

## Input

A plan, often transcribed speech, describing:
- a student
- one or more systems (Renal, MSK, Cardio, Psych, Biochem…)
- a sequence of activities
- time budgets or day assignments

Common resources: First Aid Guide, Sketchy, Sketchy Micro, Marrow, Mehlman Medical
videos, General Series Anki, FA Foundation Anki, UWorld, Amboss blocks, Randy Neil
PDF, NBME Booster, formal assessments.

## Steps

1. **Split the input.** The student's name comes first, then the plan. If you
   can't tell where the name ends, or there's no plan, ask.

2. **Find the student** (read-only): `curl -s $SITE/api/roster`.
   Match the name case-insensitively. Ignore "Dr." and match on first name or part
   of the name. Roster names can be messy, e.g. `"mahek nichlnai"` or `"Manaal "`.
   - **Phase 5 students never get a tracker.** Trackers are only for Phases 1–4
     (Dr. Marish, 17 Oct 2026). Drop any Phase 5 or "Mac" roster entry from the
     matches before deciding. If the name only matches a Phase 5 entry, say so and
     stop. Never publish for it.
   - Exactly one match → use its `id`. If its status isn't `Active`, say so and
     ask whether to go ahead.
   - Several matches or none → list the closest names and ask. **Never create a
     student.**

3. **Check existing trackers** (read-only): `curl -s $SITE/api/trackers`, and keep
   this student's entries.
   - **If the student already has a tracker, update it** (standing instruction,
     user, 21 Oct 2026). Re-publish the newest live one with its `token`. Do not
     ask first and do not create a second tracker. Never archive or delete the
     old one unless the user asks.
   - Only create a **new** tracker when the student has none, or when the user
     explicitly asks for a separate one.
   - **Ticks carry over by `id`.** Keep the `id` of a task that is unchanged.
     Give any new or changed task a **new** `id`, so an old tick never lands on a
     different task. Remove the `id`s of tasks that were dropped.
   - Tell the user in the reply: "updated the existing tracker, ticks kept for
     unchanged tasks".

4. **Pin the dates.** Get today's date with `date +%F` and the weekday with
   `date +%a`. Turn "starts today", "tomorrow", "Fri", "next Thu" and so on into
   `YYYY-MM-DD` on every dated day. Phase-anchored plans have no day dates (see
   Structure).

5. **Write the plan** to a JSON file in the scratchpad (or the system temp folder),
   named `tracker-<student>-<date>.json`. Follow the structure, conventions and
   score rules below. `example-renal.json` next to this file is a real one.
   - **Write the file with the Write tool (UTF-8).** Do not build it with a shell
     heredoc, and do not load and re-save it with a script: on Windows that
     garbles `→ · – —` into junk like `â†’` and `Â·`. The file you post must be the
     file you wrote, byte for byte.

5a. **QC the local file**: `python "<skill folder>/qc-tracker.py" <file>`. It
    checks the text is clean UTF-8 and the JSON parses. If it fails, rewrite the
    file (step 5) and run it again. Never skip it.
    Run it as: `python "<skill folder>/qc-tracker.py" <file>`. `<skill folder>` is the
    "Base directory for this skill" shown at the top of this skill.

6. **Check it** without saving anything: add `"dryRun": true` to the body, then
   `curl -s -X POST $SITE/api/trackers -H "Content-Type: application/json" --data-binary @<file>`.
   If it returns an `error`, fix the plan and check again.

7. **Publish straight away. Don't ask first.** The user said on 10 Oct 2026:
   "never ask again". Once the dry run comes back with no `error`, remove
   `dryRun` and POST again; that writes to the live site. If the response is
   `401`, ask for the app passcode and resend with `-H "x-passcode: <code>"`.
   Still ask (and don't publish) when the student can't be identified, isn't
   `Active`, or no reading of the plan is consistent (see Ambiguity).
   - Post the file itself with `--data-binary @<file>`, not a re-saved copy.
   - For a **re-publish**, the body must carry the same `token`; remove `dryRun`
     from the copy you post, and keep the file's text unchanged.

7a. **QC the live tracker before giving the link.** Run
    `python "<skill folder>/qc-tracker.py" <file> <token>`. It fetches the stored
    tracker and checks that: no garbled characters, the title, subtitle and every
    task, label and meta match the plan exactly, and the task count matches. If it
    fails, re-publish the corrected file with the same `token` (keeps the ticks),
    then run QC again. **Do not send the link until QC passes.**

8. **Reply with the link first**: `https://usmlevault-daily.vercel.app/t/<token>`,
   and say the QC passed. Then, in the project's output style:
   - **One short paragraph**: day count, systems covered, deadline, task count,
     and which tasks carry a score box (`scoreTasks` in the response).
   - Then, only if you had to resolve any, **one line per ambiguity** saying what
     you assumed.
   - No preamble, no restating the plan.

9. **Corrections**: if the user then corrects something, re-publish the same
   tracker with its `token` (keeps the ticks; keep unchanged task `id`s), again
   without asking, and reply with the link and "ticks kept".

## Schema

```jsonc
{
  "action": "publish",
  "studentId": "<roster id>",
  "token": "<only when re-publishing an existing tracker>",
  "plan": {
    "title": "MSK → Psychiatry Sprint",
    "subtitle": "Dr. Shalvin · starts tomorrow · MSK by next Thu, Psych by the Tue after",
    "start": "2026-10-11",           // optional; only used when no day has dates (phase plans)
    "end": "2026-10-22",             // optional; the final deadline for phase plans
    "cards": [                       // the reference card's sub-sections, 0–8
      { "title": "Timeline", "rows": [ { "label": "Day 1–2 · Fri – Sat", "value": "First Aid Guide" } ] },
      { "title": "Hard cutoffs", "rows": [ { "label": "FA Guide (max)", "value": "Sat 12 pm" } ] }
    ],
    "sections": [                    // one per system in a multi-system plan
      {
        "title": "Psychiatry",       // the section divider; "" for a single-system plan
        "sub": "Fri 16 – Wed 21 Oct",
        "days": [
          {
            "label": "Day 1",        // dated: "Day 1" / "Day 1–2". Undated: "Phase 1 · MSK"
            "from": "2026-10-16",    // YYYY-MM-DD, or "" for an undated phase
            "to": "2026-10-16",      // same as from for one day; "" when undated
            "topic": "Psych",        // right-hand topic
            "blocks": [
              {
                "label": "Morning · 8am–12pm",     // or "Step 1 · 36 hrs"; "" if none
                "tasks": [
                  { "id": "psy-1", "text": "First Aid Guide · Psychiatry", "meta": "It'll just take you 2 days" },
                  { "id": "psy-5", "text": "UWorld · Psychiatry", "meta": "No slippage",
                    "split": "uworld", "score": { "kind": "sys", "key": "psych" } }
                ]
              }
            ],
            "callout": "Psychiatry closes out by **Wednesday 21 Oct** — FA Guide, Randy Neil PDF, Anki, UWorld all done."
          }
        ]
      }
    ]
  }
}
```

The page prints the dates itself. A dated day shows as **"Day 1 · Fri 16 Oct"** or
**"Day 1–2 · Fri 16 – Sat 17 Oct"**, so put **no weekday or date in `label`** when
`from` is set. An undated day shows its `label` alone ("Phase 1 · MSK").

## Structure (from the project rules)

- **Day-anchored plans** (e.g. "Thu–Sun sprint", specific dates):
  - Day entries `Day 1`, `Day 2`, each with `from`/`to`.
  - Block labels such as `Morning · 8am–12pm`, `Evening · after 8pm`, `By 5pm`,
    `After First Aid`.
- **Day ranges** (e.g. "Fri–Sat for FA Guide"): one entry, `label: "Day 1–2"`,
  with `from` Fri and `to` Sat.
- **Phase-anchored plans** (e.g. "36 hrs for FA Guide, 12–16 hrs for Mehlman"):
  - Entries labelled `Phase 1 · MSK`, with `from`/`to` set to `""`.
  - Step block labels: `Step 1 · 36 hrs`, `Step 2 · 12–16 hrs`.
  - Set plan `start` to the start date and `end` to the final deadline if the
    plan gives one, so the Trackers tab can show a duration.
- **Multi-system plans** (e.g. "MSK then Psych"): one `section` per system,
  `title` = the system, `sub` = its dates or budget.
- **Single-system plans**: one section with `title: ""`.
- **NBME forms are named by number, never by date** (user, 19 Oct 2026). An NBME
  form's day is undated: `label: "NBME 32"`, `from` and `to` `""`, so the page
  shows just the label. Its section `title` is `NBME 32` and its `sub` says
  where it sits (e.g. "After NBME Booster Anki"), not a date. Timeline and
  cutoff rows name the form, e.g. `label: "NBME 32"`. Dates stay only on the
  study days around it.
- **Tracker start date**: when the user gives a start date, it is the first
  dated day, and every later day is set from it. Re-check weekdays after any
  shift (`date +%a`).
- **Reference card** (always): whatever gives quick-reference value, as separate
  `cards`:
  - **Time budgets** (X hrs, Y days)
  - **Deadlines / Hard cutoffs**
  - **Student snapshot**: NBME scores, UWorld %, weak systems. **Only if
    provided.**
  - **Timeline**: day → activity.
- **Callouts**: one at the end of each system (on its last day) reinforcing the
  deadline. Put the critical part in `**bold**`. Examples:
  - "System closes out by **Saturday next week** — FA Guide, Sketchy, Marrow,
    Mehlman, Anki, UWorld all done."
  - "Non-negotiable: **First Aid Guide + Mehlman videos both done by Fri night,
    max.**"

## Task conventions

- **Text**: short, imperative, no fluff: "First Aid Guide · 10 pages", "Mehlman
  Medical videos · Renal", "Revise Sketchy Micro".
- **`meta`**: time budgets, quantities, urgency notes, cross-references ("Chunk 1
  of 3", "Hard stop Saturday 12 pm — not later"). **Only add a `meta` when it adds
  something the task and its day don't already say.**
  - **Never** repeat the day or the date: no "Today", "Start today", "Finish
    today", "Wrap up today", "Begin today", "Tomorrow", or a weekday that the day
    label already shows. The day column already shows it.
  - **Never** restate the task in the meta ("Start of MCQs" on "MCQs · Immunology").
  - **Never** add meetings, appointments, check-ins or any other operational
    statement ("We meet again on Tuesday") unless Dr. Marish said it in the plan,
    and then quote his words exactly. If unsure, leave it out and ask.
  - Leave `meta` empty when there is nothing extra to say. An empty field is
    correct.
  - `qc-tracker.py` fails any `meta` that is only a date echo.
- **Preserve directive phrasing from the input**: "It's doable", "no slippage", "as
  we always do", "same protocol we use every system". Don't sanitize or tidy
  Dr. Marish's voice.
- **Standardize resource names**:
  - **Mehlman Medical** (never Mahelman / Melan)
  - **Randy Neil PDF** (never Neil Randy)
  - **USMLEVault**, **Amboss**, **Marrow**, **Sketchy**, **Sketchy Micro**,
    **General Series Anki**
  - Speech-to-text slips are common; fix them to these names.
- **Work spread over several days** (UWorld, wrap-up) becomes one task per day when
  the plan gives a daily split. Otherwise it stays one task.
- **Breaks** are tasks: "1-day break", meta "Full rest".
- **IDs**: unique, short, stable — `d1-1`, `d2-3`, `msk-1`, `psy-2`, `p-1` for a
  prerequisite. Letters, digits, `-` and `_` only.
- **Title**: short system or theme: "Renal System", "MSK → Psychiatry Sprint",
  "Thu – Fri Sprint".
- **Subtitle**: who + when: "Dr. Shalvin · starts tomorrow · MSK by next Thu, Psych by
  the Tue after".
  - **Every student is "Dr. <name>"**, always, even when the plan leaves it out
    (user, 11 Oct 2026): "Dr. Shalvin", "Dr. Farah", "Dr. Srivalli". Use the
    name cleanly (no roster tags like "( Match )"), and never write "Dr. Dr.".
- **Never invent** a task, resource, quantity, time or deadline that isn't in the
  plan.

## Ambiguity (from the project rules)

If timing is ambiguous or contradictory (e.g. "next Tuesday for psych and
next-next Tuesday for psychiatry"):
- pick the reading that's internally consistent with the time budgets
- build it
- flag it in one line in the reply (step 8) so the user can correct it

Ask instead of building only when no reading is consistent, or the student can't be
identified.

## Splits: the student sizes open-ended work themselves

Dr. Marish's plans rarely say how many questions, pages, cards or videos a task is.
**The student decides.** Tag those open-ended tasks with a `split` kind, and the
tracker asks the student:

Once a split is entered, its form has **Reset** (clears the split, and its blocks,
ticks and scores after a confirm) and **Done**. After a reset the boxes are empty
again, showing "—". Never tell the student to type 0 to clear a split: 0 is not a
valid count.

| `split` | Use on | The student is asked | What happens |
|---|---|---|---|
| `uworld` | UWorld | Total questions, questions per block | Splits live into Block 1 · 20 Qs, Block 2 · 20, Block 3 · 10, each with its own tick and score box |
| `nbme` | NBME forms and other NBME-style blocks | Number of blocks, questions per block | Splits into Block 1 · 50 Qs …, each with its own tick and score box |
| `pages` | First Aid Guide, Randy Neil PDF, other reading | How many pages | **Reference only.** The number shows next to the task; it stays **one tick** |
| `cards` | Any Anki / flashcards (FA Foundation, General Series, Zanki, NBME Booster, Mehlman Anki) | How many cards | **Reference only**, one tick |
| `videos` | Mehlman Medical videos, and other video series (Sketchy, Marrow, Boards & Beyond) | How many videos | **Reference only**, one tick |

Only UWorld and NBME are split into tickable parts. Reading, flashcards and videos
are never tracked page by page, card by card or video by video. The amount is
just for general knowledge, and **optional**: the student can close the question
with × and tick the task without giving a number.

- **Don't split a task whose amount Dr. Marish already fixed.** "First Aid Guide ·
  10 pages, chunk 1 of 3" stays a plain tick.
- **Don't ask the user for these numbers.** The student enters them on the tracker.
- **Leave untagged** anything that isn't one of these (micro revision, breaks,
  "wrap up", Key of Psychiatry, Amboss).
- A UWorld stretch split by day ("UWorld GIT · Mon 12", "…· Tue 13") gets
  `split: "uworld"` on **every** day's task. Each day the student sizes that day's
  blocks.

### UWorld screenshot subtask (every UWorld task, no exceptions)

Every task with `split: "uworld"` is followed immediately by one plain subtask
asking the student to send the block screenshots. This is what Dr. Marish checks
the UWorld scores against, so it is required on every UWorld task.

- Text, exactly: `Send all the screenshots of the blocks in the group`
- `id`: the UWorld task's `id` plus `-ss` (e.g. `d4-1` → `d4-1-ss`).
- No `split`, no `score`, `meta` empty. It is a tick, not a score box.
- Put it directly after its UWorld task, in the same block. A UWorld task that has
  its own day or block gets its own subtask.
- Never put it on NBME, Anki, videos, pages or Amboss tasks.
- The `qc-tracker.py` check counts it: every UWorld task must be followed by its
  `-ss` subtask, or QC fails.

## Score rules (they fill the progress pills on Check-in)

Block scores feed the pills **live**. After every block score, the server sets the
pill to the student's running average across all scored blocks linked to it,
weighted by questions, the way UWorld calculates it.

- **System pill = that system's UWorld average.** Every `split: "uworld"` task
  carries `"score": {"kind":"sys","key":"<id>"}` for its system. Put it on **all**
  that system's UWorld tasks, not only the last one.
  - Never on Anki, Amboss, Marrow, FA Guide or video tasks.
- **NBME pill = that form's score.** An NBME form task (26–34) carries
  `"split": "nbme"` and `"score": {"kind":"nbme","key":"31"}`.
  - Exception: **Manthan** (id `csv045`) also has an NBME 13 pill, so his NBME 13
    task gets `"score": {"kind":"nbme","key":"13"}`. For anyone else NBME 13 is
    an older form: no `score`. (Extra forms per student: `EXTRA_NBMES` in
    `lib/progress.ts`.)
  - NBME 20–25, Free 120, UWSA and other formal assessments get `split: "nbme"`
    with **no** `score`. The student still gets blocks and score boxes, but no pill
    is touched.
- System `key`s:

  | key | system | key | system |
  |---|---|---|---|
  | `biochem` | Biochem, incl. cellular / molecular, nutrition | `endo` | Endocrine |
  | `immuno` | Immunology | `gi` | GIT |
  | `micro` | Microbiology (standalone) | `heme` | Heme/Onc, Hemostasis |
  | `path` | General Pathology | `msk` | MSK, Dermatology |
  | `pharm` | General Pharmacology | `neuro` | Neurology, CNS |
  | `biostats` | Biostats, Ethics, Public health | `psych` | Psychiatry |
  | `cvs` | Cardio | `renal` | Renal |
  | | | `repro` | Reproductive |
  | | | `respi` | Respiratory |

- In the reply (step 8), list the tagged tasks by kind, e.g.
  "Blocks: 3 UWorld (GIT), 1 NBME 30 · Amount asked: 2 reading, 1 Anki, 1 Mehlman".
