// The corners — one personal daily page each for Adit, Shreeman and Sanskar.
//
// Each corner works like Today in miniature: its own checklist, its own
// morning and evening clock, its own grade and month calendar, and its own
// close-out report (Done · Outstanding · Notes). Days are stored per person,
// so ticking Shreeman's list never moves Adit's score or anyone else's.
//
// Rows use the same Task / Section shapes as lib/tasks.ts, so the same pills,
// slots and SOP blocks work here. Edit the CORNERS array to change a list.

import {
  CALENDLY,
  counterValue,
  pillKey,
  SECTIONS,
  slotKey,
  type Section,
  type SopBlock,
  type Task,
  type Ticks,
} from "./tasks";
import { duration, istTime, stampAt } from "./shifts";
import type { Coverage } from "./checkin";

export type CornerId = "adit" | "shreeman" | "sanskar";

export type Corner = {
  id: CornerId;
  name: string;
  /** Shown under the heading. */
  blurb: string;
  /** Where the close-out report goes once it is copied. */
  sendTo: string;
  sections: Section[];
  /** Shown when the checklist has not been written yet. */
  pending?: string;
};

/* --------------------------------- clock ---------------------------------- */
// No fixed hours here — the corner just records when each half of the day
// actually started and ended. The keys are the same shape as Today's clock, but
// they live in the corner's own day document, so they never collide.

export const CORNER_SHIFTS = [
  { id: "morning", label: "Morning" },
  { id: "evening", label: "Evening" },
] as const;

export type CornerShift = (typeof CORNER_SHIFTS)[number];

export const clockKey = (shift: CornerShift["id"], edge: "in" | "out") =>
  `shift:${shift}:${edge}`;

export type CornerShiftState = {
  shift: CornerShift;
  in: Date | null;
  out: Date | null;
  open: boolean;
  workedMin: number | null;
};

export function cornerShiftStates(ticks: Ticks): CornerShiftState[] {
  return CORNER_SHIFTS.map((shift) => {
    const start = stampAt(ticks, clockKey(shift.id, "in"));
    const end = stampAt(ticks, clockKey(shift.id, "out"));
    return {
      shift,
      in: start,
      out: end,
      open: Boolean(start && !end),
      workedMin:
        start && end
          ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
          : null,
    };
  });
}

export function cornerClockLines(ticks: Ticks): string[] {
  return cornerShiftStates(ticks).map((s) => {
    if (!s.in) return `  · ${s.shift.label} — not clocked in`;
    if (!s.out) return `  · ${s.shift.label} — in ${istTime(s.in)}, still open`;
    return `  · ${s.shift.label} — in ${istTime(s.in)}, out ${istTime(s.out)} · ${duration(s.workedMin ?? 0)}`;
  });
}

/* -------------------------------- the lists ------------------------------- */

/** The SOP under one of Today's rows — the scripts and links live there once,
 *  and a corner row borrows them rather than keeping a second copy. */
function todaySop(id: string): SopBlock[] {
  return SECTIONS.flatMap((s) => s.tasks).find((t) => t.id === id)?.sop ?? [];
}

/** Today's onboarding message set, with a note under the intro: it is written
 *  in Adit's name. */
function onboardingMessages(): SopBlock[] {
  return todaySop("ob-messages").flatMap((b): SopBlock[] =>
    b.kind === "script" && b.title === "2 · Who you are"
      ? [
          b,
          {
            kind: "pending",
            text: "This intro is written in Adit's name. If you send it yourself, the wording for your own intro needs Dr. Marish's OK.",
          },
        ]
      : [b]
  );
}

const CLOCK_IN_ROW: Task = {
  id: "clock-in",
  label: "Clock in",
  detail: "Tap the morning clock-in above, or here — they are the same stamp.",
  slots: [{ id: "in", label: "Clock in", key: clockKey("morning", "in") }],
};

export const CORNERS: Corner[] = [
  {
    id: "adit",
    name: "Adit",
    blurb: "Adit's own day — clock, checklist and close-out.",
    sendTo: "Dr. Marish",
    pending:
      "Adit's checklist is still being written. The clock, grade and close-out work today; the rows land here once the list is settled.",
    sections: [],
  },
  {
    id: "shreeman",
    name: "Shreeman",
    blurb: "Client fulfilment — check-ins, onboarding, feedback.",
    sendTo: "the Operations group",
    sections: [
      {
        id: "sh-checkin",
        title: "Check-in",
        tasks: [
          CLOCK_IN_ROW,
          {
            id: "sh-due-payments",
            label: "Due payments checked and messages sent",
            detail:
              "Check due payments, if any, and send out a message. Mention them at the standup.",
          },
          {
            id: "sh-outstanding",
            label: "Every outstanding student message checked and written up",
            detail:
              "Write down what came out of each check-in in clear words. If it needs Dr. Marish, write clearly where and why. A general check-in — tick and move on.",
          },
          {
            id: "sh-adit-review-am",
            label: "Adit asked to review the client chats and Dr. Marish points",
            detail:
              "Every chat you went through, plus every place Dr. Marish is needed. Ask Adit to resolve anything outstanding he can close on his end.",
          },
          {
            id: "sh-standup-am",
            label: "11 AM standup — Dr. Marish cleared the enquiries on the call",
            detail:
              "Close the loop on the meeting itself. No \"I'll do this\" or \"don't worry\". Be assertive.",
          },
          {
            id: "sh-checkins-noon",
            label: "All client check-ins done by noon",
            detail:
              "Same loop as the morning: check chat → write down what came out → get it reviewed by Adit at once → make sure Adit closes the loop wherever he can. Closes itself once every active student is ticked on the Check-in tab.",
            coverage: true,
          },
          {
            id: "sh-p1-p3",
            label: "P1 and P3 clients given special attention",
            detail:
              "P1 — joined in the past 2 weeks. P3 — giving NBMEs, exam coming up.",
          },
          {
            id: "sh-payment-made",
            label: "Payments checked — update ready for the evening standup",
            detail: "Check whether the payment was made, and update on the evening standup.",
          },
          {
            id: "sh-phase-status",
            label: "Every client's phase and payment status updated",
            detail: "On the Students tab.",
          },
          {
            id: "sh-testimonials",
            label: "Testimonials chased",
            detail:
              "In the notes below: if there are none, say so explicitly. If there are, write each client's name and whether the testimonial is received or not.",
          },
          {
            id: "sh-standup-pm",
            label: "7 PM standup — loop closed on every client interaction",
            detail:
              "Once Adit has reviewed, ask Dr. Marish to close the loop right there on the meet. Any action or intervention needed is done then and there — message, review, meet, anything.",
          },
        ],
      },
      {
        id: "sh-onboarding",
        title: "Onboarding",
        skip: { id: "no-onboarding", label: "No students onboarded today" },
        tasks: [
          {
            id: "sh-ob-group",
            label: "WhatsApp group created",
            detail: "Add Dr. Marish, the student and Adit's business number.",
            sop: todaySop("ob-group"),
          },
          {
            id: "sh-ob-messages",
            label: "Onboarding messages sent along with the resource link",
            detail:
              "Welcome video, intro, Step 1 registration, onboarding form, resources doc — in that order. Every message is under \"How to do this\", with a Copy button.",
            sop: onboardingMessages(),
          },
          {
            id: "sh-ob-contract",
            label: "Payment details confirmed, contract sent and signed",
            detail: "Make sure they sign it.",
            sop: todaySop("ob-contract"),
          },
          {
            id: "sh-ob-meeting",
            label: "Onboarding meeting with Dr. Marish scheduled",
            detail:
              "ASAP. Chase the client and Dr. Marish for a meeting within the next 24 hours — ideally within the next 4.",
            // Today's confirmation message and links; the timing is this row's own.
            sop: [
              { kind: "link", label: "Calendly — 30 min with Dr. Asudani", href: CALENDLY },
              ...todaySop("ob-meeting").filter(
                (b) => b.kind === "script" || (b.kind === "link" && b.href !== CALENDLY)
              ),
            ],
          },
          {
            id: "sh-ob-vault",
            label: "Full Vault access granted on their email ID",
            sop: todaySop("ob-vault"),
          },
          {
            id: "sh-ob-tracker",
            label: "Monthly enrolment tracker updated with all the details",
            sop: todaySop("ob-tracker"),
          },
          {
            id: "sh-ob-tasklist",
            label: "First tasklist sent once the onboarding call wrapped up",
            detail: "As soon as the call is over.",
          },
        ],
      },
      {
        id: "sh-tasklist",
        title: "Creating a Task List",
        skip: { id: "no-tasklist", label: "No task lists made today" },
        tasks: [
          {
            id: "sh-tl-cli",
            label: "Claude CLI opened",
          },
          {
            id: "sh-tl-repo",
            label: "GitHub repo put in",
          },
          {
            id: "sh-tl-checklist",
            label: "/checklist run with the student's name and Dr. Marish's instructions",
            detail:
              "Use the /checklist skill, enter the person's name, and add the instructions given by Dr. Marish in the group chat.",
          },
          {
            id: "sh-tl-link",
            label: "Link copied, reviewed and pasted into the WhatsApp chat",
            detail:
              "The CLI will generate a link. Copy that link, review it, and then paste it into the WhatsApp chat.",
          },
        ],
      },
      {
        id: "sh-scores",
        title: "Updating Scores or Blocks in the Tracker",
        skip: { id: "no-scores", label: "No scores to update today" },
        tasks: [
          {
            id: "sh-sc-spot",
            label: "Every finished UWorld block or system noted, with its score",
            detail:
              "Go through each student's group. Whenever someone finishes a UWorld block, or a whole system, note the system (Respi, GI…) and the score.",
          },
          {
            id: "sh-sc-blocks",
            label: "Block scores entered in the student's tracker",
            detail:
              "Open their tracker from the dot beside their name on Check-in. On that system's UWorld task, tick the block and type its %.",
          },
          {
            id: "sh-sc-pill",
            label: "System average checked beside the student's name on Check-in",
            detail:
              "The tracker fills that system's pill (Respi, GI…) by itself with the average across all its blocks. Check it against what the student sent. If it's empty or wrong, or the system wasn't on a tracker, tap the pill and type the average yourself.",
          },
        ],
      },
      {
        id: "sh-feedback",
        title: "Feedback",
        tasks: [
          {
            id: "sh-fb-forward",
            label: "Student feedback forwarded to the \"Vault Feedback\" group",
            detail:
              "Check every group for feedback. Forward or screenshot it then and there and send it to \"Vault Feedback\" instantly.",
          },
          {
            id: "sh-fb-praise",
            label: "Praise screenshotted to \"Vault and mentorship content\", Sanskar tagged",
            detail:
              "Any student praising Dr. Marish, the Vault or the mentorship. Make sure it goes up as a usmle.vault Instagram story, with any decent music added.",
          },
        ],
      },
      {
        id: "sh-reviews",
        title: "Asking for Written Reviews",
        skip: { id: "no-reviews", label: "No written reviews due today" },
        tasks: [
          {
            id: "sh-rv-status",
            label: "Exam over — student shows Awaiting results on the Students tab",
            detail:
              "The day after the exam the dashboard moves an Active student there by itself. Check it did; if not, change the status by hand. The exam date must be filled in, or no review reminder comes up.",
          },
          {
            id: "sh-rv-ask",
            label: "Written review asked for, and \"Review asked\" tapped on Check-in",
            detail:
              "Day 1 — Check-in shows \"Ask <name> for a written review\" under Written reviews. Ask on WhatsApp, then tap Review asked. Not tapped by day 2, it moves to a rust Missed alert at the top of Check-in.",
          },
          {
            id: "sh-rv-followup",
            label: "Everyone asked followed up — \"Have you gotten the review?\"",
            detail:
              "Once asked, the row only asks \"Have you gotten the review?\". No warning, no deadline — follow up until it comes in.",
          },
          {
            id: "sh-rv-received",
            label: "Reviews that came in marked \"Yes, got it\"",
            detail:
              "Tap Yes, got it, paste the review in if you have the text, and save. The student leaves the list.",
            sop: [
              {
                kind: "p",
                text: "The full step-by-step is in the SOP tab: \"Written reviews — after the exam\".",
              },
            ],
          },
        ],
      },
      {
        id: "sh-close",
        title: "Daily close-out",
        tasks: [
          {
            id: "sh-closeout",
            label: "Close-out copied and sent to the Operations group",
            detail: "Generate the report at the bottom of this page, copy it, send it.",
          },
        ],
      },
    ],
  },
  {
    id: "sanskar",
    name: "Sanskar",
    blurb: "Sanskar's own day — clock, checklist and close-out.",
    sendTo: "the Operations group",
    pending:
      "Sanskar's checklist is still being written. The clock, grade and close-out work today; the rows land here once the list is settled.",
    sections: [],
  },
];

export const CORNER_IDS = CORNERS.map((c) => c.id);

export function cornerById(id: string): Corner | undefined {
  return CORNERS.find((c) => c.id === id);
}

/* --------------------------------- scoring -------------------------------- */
// Same rules as Today: a row is done when every pill/slot is set, the counter
// reached, or the box ticked; a section switched to N/A counts as done.

export const cornerTasks = (c: Corner): Task[] => c.sections.flatMap((s) => s.tasks);

export function isCornerSectionSkipped(section: Section, ticks: Ticks): boolean {
  return Boolean(section.skip && ticks[section.skip.id]);
}

export function isCornerTaskDone(
  c: Corner,
  task: Task,
  ticks: Ticks,
  coverage?: Coverage
): boolean {
  const section = c.sections.find((s) => s.tasks.includes(task));
  if (section && isCornerSectionSkipped(section, ticks)) return true;
  // Read off the Check-in tab, same as Today's sweep — never a tap.
  if (task.coverage) return Boolean(coverage?.complete);
  if (task.pills?.length) return task.pills.every((p) => ticks[pillKey(task, p)]);
  if (task.slots?.length) return task.slots.every((s) => Boolean(ticks[slotKey(task, s)]));
  if (task.counter) return counterValue(task, ticks) >= task.counter.target;
  return Boolean(ticks[task.id]);
}

export type CornerScore = {
  done: number;
  total: number;
  percent: number;
  /** null when the corner has no rows yet — nothing to grade. */
  grade: "A+" | "C-" | null;
};

export function cornerScore(c: Corner, ticks: Ticks, coverage?: Coverage): CornerScore {
  const tasks = cornerTasks(c);
  const total = tasks.length;
  const done = tasks.filter((t) => isCornerTaskDone(c, t, ticks, coverage)).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return { done, total, percent, grade: total ? (percent >= 75 ? "A+" : "C-") : null };
}

/** One line per row, split into done and still open, for the close-out. */
export function cornerSplit(
  c: Corner,
  ticks: Ticks,
  coverage?: Coverage
): { done: string[]; open: string[] } {
  const done: string[] = [];
  const open: string[] = [];
  for (const section of c.sections) {
    if (isCornerSectionSkipped(section, ticks)) {
      done.push(`${section.title} — not applicable: ${section.skip!.label.toLowerCase()}`);
      continue;
    }
    for (const task of section.tasks) {
      const line = `${section.title} · ${task.label}`;
      if (isCornerTaskDone(c, task, ticks, coverage)) {
        done.push(line);
        continue;
      }
      if (task.coverage) {
        open.push(`${line} (${coverage?.taken ?? 0}/${coverage?.total ?? 0} students ticked)`);
      } else if (task.pills?.length) {
        const missing = task.pills.filter((p) => !ticks[pillKey(task, p)]).map((p) => p.label);
        open.push(`${line} (${missing.join(", ")})`);
      } else if (task.slots?.length) {
        const missing = task.slots.filter((s) => !ticks[slotKey(task, s)]).map((s) => s.label);
        open.push(`${line} (${missing.join(", ")})`);
      } else if (task.counter) {
        open.push(`${line} (${counterValue(task, ticks)}/${task.counter.target} ${task.counter.noun})`);
      } else {
        open.push(line);
      }
    }
  }
  return { done, open };
}
