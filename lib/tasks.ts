// Adit's daily operating loop — Founder's Office.
//
// One array drives everything: the checklist, the score, the month grid, the
// nightly report, and the SOP tab. Add a task here and every surface follows.
//
// Scoring: a row counts as done when
//   · pills   → every pill is on
//   · counter → the count has reached its target
//   · slots   → every slot has a timestamp
//   · plain   → the box is ticked
// A section marked "not applicable today" (onboarding) counts as fully done.

import type { Coverage } from "./checkin";

/* ------------------------------- SOP blocks ------------------------------- */

export type SopBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "script"; title: string; body: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "creds"; label: string; user: string; pass: string }
  | { kind: "warn"; text: string }
  | { kind: "pending"; text: string };

/* --------------------------------- tasks ---------------------------------- */

export type Pill = { id: string; label: string };

export type Counter = { target: number; noun: string };

export type Slot = {
  id: string;
  label: string;
  /** Store under this key instead of the derived one — lets a row share
   *  stamps with the clock panel rather than duplicating them. */
  key?: string;
};

export type Task = {
  id: string;
  label: string;
  detail?: string;
  pills?: Pill[];
  counter?: Counter;
  slots?: Slot[];
  /**
   * Driven by the check-in tab rather than a tick: done only when every active
   * student has been ticked off today. Cannot be checked by hand — the roster
   * is the only thing that can close it.
   */
  coverage?: boolean;
  sop?: SopBlock[];
};

export type Section = {
  id: string;
  title: string;
  /** When set, a switch in the section head marks the whole section N/A today. */
  skip?: { id: string; label: string };
  tasks: Task[];
};

const IG_PILLS: Pill[] = [
  { id: "primary", label: "Primary DMs" },
  { id: "general", label: "General" },
  { id: "requests", label: "Requests" },
  { id: "hidden", label: "Hidden requests" },
];

const SOCIAL_PILLS: Pill[] = [
  { id: "requests", label: "Requests" },
  { id: "dms", label: "DMs" },
  { id: "comments", label: "Comments" },
];

/* ------------------------------ shared scripts ---------------------------- */

export const CALENDLY = "https://calendly.com/marish-usmlevault/30min";
export const GUIDES = "https://vault-guides.vercel.app/";
export const ONBOARDING_FORM = "https://usmlevault.com/onboarding";
export const POST_BOOKING = "https://usmlevault.com/post-booking";
export const ADMIN = "https://usmlevault.com/admin";
export const BLOG = "https://usmlevault.com/blog";
export const RESOURCES_DOC =
  "https://docs.google.com/document/d/17bYw5JHLfjn5Uqfu48rEe1sq4HRoLFktsn2UDRh6nxg/edit";
export const YEAR_1 = "https://vault-guides.vercel.app/year-1.html";
export const YEAR_2 = "https://vault-guides.vercel.app/year-2.html";
export const YEAR_3 = "https://vault-guides.vercel.app/year-3.html";
export const YEAR_FINAL = "https://vault-guides.vercel.app/final-year-mbbs.html";
export const WELCOME_VIDEO = "https://youtu.be/zAD_HYW5sqY";
export const REGISTRATION_REEL =
  "https://www.instagram.com/p/DbGHW3pjCBE/?igsh=MW5md2xlc3IxemF4eQ==";

const INTRO_MESSAGE = `Hey,

My name is Adit, and I'll be your accountability partner through your USMLE journey.

You'll be hearing from me regularly to make sure your prep is structured, on track, and working for you. I'm just as invested in your success as Dr. Marish, and between the two of us, you'll have everything you need to get there!`;

const REGISTRATION_MESSAGE = `If you have not already started working on your Step 1 registration, here's how you can do it —

${REGISTRATION_REEL}`;

const ONBOARDING_LINK_MESSAGE = `Here's your onboarding link — everything you need to get started is right here:

${ONBOARDING_FORM}

Let me know once you're done with the questionnaire.`;

const QUALIFIER = `If you don't mind — before I share the details of the mentorship program, I just have a couple of questions.

→ Since when have you been preparing for Step 1?
→ How much UWorld have you gotten through?
→ How many hours a day can you study?
→ Average UWorld % score
→ What would be your ideal date to sit Step 1?`;

const TIMEZONE_ASK = `And what's your timezone?`;

const CALL_INVITE = `Let's hop onto a quick meet to figure out how we can help you ace your Step 1 exam.

${CALENDLY}`;

const VAULT_PITCH = `That's absolutely great. For this exact purpose, Dr. Asudani built a web app — usmlevault.com.

In two minutes it builds you an entire schedule: a day-by-day checklist of exactly how and from where you have to study. It takes the whole planning load off you.

You can try the first three days completely free.`;

const GUIDES_MESSAGE = `And here's exactly how to use the Vault to ace your Step 1 —

${GUIDES}`;

const STEP_2_3_REPLY = `We don't have any places in our [Step 2 / Step 3] program at the moment — all of our spots are at peak capacity right now.

What I can give you is this, and it's genuinely detailed. Dr. Asudani has written a full breakdown of how to approach it:

${BLOG}

Work through that, and if a place opens up I'll let you know.`;

const OPENING_ASK = `Happy to help.

Two quick things so I point you at the right thing —

→ What year of med school are you in right now?
→ And are you after advice, or someone to work with you one-on-one?`;

const YEAR_1_MESSAGE = `This is the best article to go through if you're in first year. It'll make sure you're positioning yourself in the best way possible for your Step 1.

${YEAR_1}`;

const YEAR_2_MESSAGE = `This is the best article to go through if you're in second year. It'll make sure you're positioning yourself in the best way possible for your Step 1.

${YEAR_2}`;

const YEAR_3_MESSAGE = `This is the best article to go through if you're in third year. It'll make sure you're positioning yourself in the best way possible for your Step 1.

${YEAR_3}`;

const YEAR_FINAL_MESSAGE = `This is the best article to go through if you're in your final year. It'll make sure you're positioning yourself in the best way possible for your Step 1.

${YEAR_FINAL}`;

const UWORLD_REPLY = `We don't sell UWorld, and we won't — passing it on would be plagiarism, and that's not something we'll put our name to.

What the Vault gives you is everything around it: which order to do it in, how to actually review a block, and how to turn what you get wrong into something you retain.`;

const RESOURCES_MESSAGE = `And this one you'll keep coming back to — it's the resources doc.

Every NBME across Step 1, 2 and 3, plus Sketchy. Bookmark it now rather than asking me for it later.

${RESOURCES_DOC}`;

const MEETING_CONFIRM = `Please make sure to go through this link before your meeting with Dr. Asudani —

${POST_BOOKING}`;

const PAYMENT_DM = `Hi [Name], hope prep is going well.

Quick check on the payment side — going by your agreement, [instalment / amount] is due on [date]. Could you confirm where that currently stands, and that the schedule in your contract still works for you?

If anything about the dates needs adjusting, tell me and I'll take it to Dr. Asudani.

Adit`;

/* -------------------------------- sections -------------------------------- */

export const SECTIONS: Section[] = [
  {
    id: "morning",
    title: "Morning shift · 10:00–12:00 IST",
    tasks: [
      {
        id: "am-whatsapp",
        label: "Overnight replies read — every student you texted",
        detail: "10:00–10:30. Replies to your messages, and anything that came in overnight.",
        sop: [
          {
            kind: "p",
            text: "First thing, before Instagram, before anything else. Every student you texted may have answered while you were asleep, and some of those answers need Dr. Marish inside the next half hour.",
          },
          {
            kind: "steps",
            items: [
              "Go through the replies to every message you sent — student by student, nobody skipped.",
              "Read anything else that landed overnight on WhatsApp.",
              "Note as you go: who needs Dr. Marish, and who needs him urgently. That note becomes the 10:30 brief.",
              "Anything you can answer yourself, answer now rather than carrying it into the brief.",
            ],
          },
        ],
      },
      {
        id: "am-brief",
        label: "First brief to Dr. Marish — sent before 10:30",
        detail:
          "Everything the students said overnight, and who he has to reach by 10:30.",
        sop: [
          {
            kind: "p",
            text: "Dr. Marish needs this before 10:30, not at 10:30. It is the difference between him answering a student that morning and him finding out at ten that night.",
          },
          {
            kind: "steps",
            items: [
              "Summarise what came in overnight — every student who messaged, one line each.",
              "Then the part that matters most: name the students he personally has to get back to by 10:30, and say why in a few words.",
              "If nobody needs him, say that explicitly. 'Nothing needs you this morning' is a complete brief and saves him reading.",
            ],
          },
          {
            kind: "warn",
            text: "Sent before 10:30. A brief at 11:00 has already missed the window it exists for.",
          },
        ],
      },
      {
        id: "am-instagram",
        label: "Instagram DMs cleared and meetings set",
        detail:
          "10:30–12:00. All three accounts. Anyone who needs a call gets one booked before you clock out.",
        sop: [
          {
            kind: "p",
            text: "The rest of the morning shift, from 10:30 to 12:00. Everything else on this page belongs to the evening — don't start it now and don't half-do it.",
          },
          {
            kind: "steps",
            items: [
              "Go through the DMs on all three Instagram accounts — primary, general, requests, hidden requests.",
              "Answer everything that came in overnight. That backlog is the reason this shift exists: an enquiry that landed at 1am has already been sitting for nine hours.",
              "Anyone who needs a meeting, book it now. Don't leave it for the evening — send the times and get the slot confirmed inside this shift.",
            ],
          },
          {
            kind: "p",
            text: "Route every enquiry the same way as always: the two opening questions first, then advice or one-on-one.",
          },
        ],
      },
    ],
  },
  {
    id: "students",
    title: "Students · from 17:30",
    tasks: [
      {
        id: "student-sweep",
        label: "Every active student ticked off on the check-in",
        detail:
          "One tick per student on the Check-in tab. This row closes itself — it cannot be ticked by hand.",
        coverage: true,
        sop: [
          {
            kind: "p",
            text: "The check-in list is the register for the day. Every active student on the roster has a line on it. When you have taken an update from a student, tick their line and write what came out of it — not 'done', but what they actually said.",
          },
          {
            kind: "steps",
            items: [
              "Open the Check-in tab. It lists every active student.",
              "Work down it. Tick a student only after the update is genuinely taken — not when you have sent a message and are waiting.",
              "Put the substance in the note beside the tick. That note is what Dr. Marish reads.",
              "Use the 'not yet done' filter to see who is left as the evening goes on.",
              "Anyone still unticked at report time goes into the nightly report by name. Do not tick a student to clear the list.",
            ],
          },
          {
            kind: "warn",
            text: "A tick means an update was taken from that student today. Ticking a student you did not reach makes the whole register worthless, and it is the one thing here that cannot be checked from the outside.",
          },
        ],
      },
      {
        id: "student-updates",
        label: "Take updates from every student, in every group",
        detail:
          "From 17:30. Every group. No group skipped, no student skipped.",
        sop: [
          {
            kind: "p",
            text: "An update is not 'how's it going'. You open the student's plan first, work out what today was supposed to be, then ask about that specific thing.",
          },
          {
            kind: "steps",
            items: [
              "Open the student's WhatsApp group and scroll to the plan. Dr. Marish posts and updates every plan in the group itself — that group is the source of truth, nowhere else.",
              "Find the day the student is on. Match the calendar date to the day number in the plan.",
              "Read back through your last few exchanges with them. What did they say they'd do? What were they stuck on?",
              "Ask about that. Reference the specific system, resource, or block they were meant to be on today.",
              "If they're behind, find out why before you push. Log it for the nightly report.",
            ],
          },
          {
            kind: "p",
            text: "If the student has no plan in the group yet:",
          },
          {
            kind: "steps",
            items: [
              "Tag Dr. Marish in the group and ask for a plan for that student.",
              "In the same message, ask the student what they're studying in the meantime so they aren't left idle.",
            ],
          },
          {
            kind: "warn",
            text: "Never invent a plan or improvise a schedule to fill the gap. Tag Dr. Marish and wait.",
          },
        ],
      },
      {
        id: "new-students",
        label: "Every student who joined in the last two weeks given special attention",
        detail:
          "Anyone onboarded in the past 14 days, any day of it. Check the enrolment tracker if you're unsure who's in the window.",
        sop: [
          {
            kind: "p",
            text: "The first two weeks decide the whole engagement. A student who feels looked after in that window stays looked after for the rest of it; a student who feels dropped in that window never quite comes back. So new joiners are not treated like everyone else — they get more of you, deliberately, until the fortnight is up.",
          },
          {
            kind: "p",
            text: "Work out who is in the window before you start. Anyone onboarded on any day in the past fourteen days qualifies — not just this week's intake.",
          },
          {
            kind: "steps",
            items: [
              "Pump them up. Every exchange should leave them more confident than it found them. Name what they've actually done — the block they finished, the score that moved — not generic encouragement.",
              "Keep Dr. Marish accountable in those chats. If he's been tagged and hasn't answered, chase him. That is your job, not an overstep.",
              "Make sure Dr. Marish has got back to every new student within 24 hours. Check each new joiner's group daily. If his last reply is more than a day old, go to him directly and tell him which student is waiting.",
            ],
          },
          {
            kind: "warn",
            text: "The 24-hour rule is on Dr. Marish, and keeping it is on you. A new student sitting two days on an unanswered message is the single fastest way to lose them — flag it the moment the clock runs out, every time, even if you've already flagged it yesterday.",
          },
        ],
      },
      {
        id: "payments",
        label: "Check payments — who is due, pending, overdue",
        detail:
          'Work it off the Students tab, filtered. "Nothing due today" is still a report.',
        sop: [
          {
            kind: "p",
            text: "This used to mean reading every contract, every day. It doesn't any more. The tracker holds the payment state, so you filter down to the people it applies to and work only them.",
          },
          {
            kind: "steps",
            items: [
              "Open the Students tab and set the payment filter to 'Owing — anyone not paid'. That is your working list for the day. The line under the table tells you how much is outstanding across it.",
              "Narrow further when you want a specific job: 'Partial' for people mid-instalment, 'Overdue' for the ones whose date has already gone, 'Pending' for money not yet started.",
              "For each student on that list, put the real number in the Remaining column and the specifics in Notes — the exact amount due and the exact deadline, in that order. 'Next instalment $1,200 due 4 Sept' is a note. '$1200' is not.",
              "Where you don't yet know the figure, open that student's contract once, read the schedule, and write it into Notes. You do that once per student, not once per day.",
              "DM anyone whose date is close or gone. Personally, one to one — never in the group.",
              "Update the row the same day they reply. A tracker that lags a day is a tracker nobody trusts.",
            ],
          },
          {
            kind: "p",
            text: "Moving someone to Paid clears their Remaining automatically, so a paid student can never sit there still showing a balance.",
          },
          {
            kind: "script",
            title: "Payment DM — draft, pending Dr. Marish's approval",
            body: PAYMENT_DM,
          },
          {
            kind: "p",
            text: "Precise and polite. Name the exact instalment and the exact date — no vague 'just checking on payment'. Ask them to confirm the status and confirm the contract schedule still works. Curious, never accusing.",
          },
          {
            kind: "warn",
            text: "Anything overdue, disputed, or where the student pushes back on the contract terms goes to Dr. Marish the same day. Don't negotiate dates yourself.",
          },
        ],
      },
    ],
  },

  {
    id: "onboarding",
    title: "Onboarding",
    skip: { id: "no-onboarding", label: "No students onboarded today" },
    tasks: [
      {
        id: "ob-group",
        label: "New WhatsApp group created for the student",
        sop: [
          {
            kind: "p",
            text: "One group per student. This is where their plan lives, where updates happen, and where Dr. Marish gets tagged. It gets made before anything else is sent.",
          },
        ],
      },
      {
        id: "ob-community",
        label: "Student added to the Step 1 community",
        sop: [
          {
            kind: "p",
            text: "The Step 1 WhatsApp community. Add them the same day they're onboarded — it's the room they learn the culture in.",
          },
        ],
      },
      {
        id: "ob-messages",
        label: "Onboarding message set sent",
        detail: "All of it, in order. Sending it is what starts the clock.",
        sop: [
          {
            kind: "p",
            text: "Send these in order, in the student's new group. The moment the set is out, onboarding is live and the follow-up timers below start.",
          },
          { kind: "link", label: "1 · Welcome video", href: WELCOME_VIDEO },
          { kind: "script", title: "2 · Who you are", body: INTRO_MESSAGE },
          {
            kind: "script",
            title: "3 · Step 1 registration",
            body: REGISTRATION_MESSAGE,
          },
          {
            kind: "pending",
            text: "Dr. Marish is still writing the detail under this one — FSMB, the portal, and the rest of the registration steps. Until it lands, send the reel and tell the student the written breakdown is coming.",
          },
          {
            kind: "script",
            title: "4 · Onboarding form",
            body: ONBOARDING_LINK_MESSAGE,
          },
          {
            kind: "script",
            title: "5 · Resources doc",
            body: RESOURCES_MESSAGE,
          },
          {
            kind: "p",
            text: "The resources doc goes to every student, no exceptions — it holds every NBME for all three Steps, plus Sketchy. Sending it during onboarding saves you answering the same question on day three.",
          },
          { kind: "link", label: "Resources doc — every NBME", href: RESOURCES_DOC },
        ],
      },
      {
        id: "ob-contract",
        label: "Contract sent",
        sop: [
          {
            kind: "p",
            text: "Personalised to the student — their name, their dates, their payment schedule. Clone the sample and change every field. A contract with someone else's dates in it is worse than no contract.",
          },
          {
            kind: "warn",
            text: "Read the payment terms before you send. You are the one who has to chase them later.",
          },
        ],
      },
      {
        id: "ob-meeting",
        label: "Onboarding meeting with Dr. Marish scheduled",
        detail:
          "Booked within 60 minutes of onboarding. The meeting itself sits 24–36 hours after they join.",
        sop: [
          {
            kind: "p",
            text: "Every onboarded student meets Dr. Marish. That meeting is part of onboarding, not an optional extra — it is where the student stops being a signup and starts being someone's student.",
          },
          {
            kind: "steps",
            items: [
              "Within 60 minutes of onboarding, get a slot set. Not proposed — set. A time on the calendar with the student's confirmation against it.",
              "The slot itself must land 24 to 36 hours after they joined. Not the same evening, not four days later. That window is the whole point: long enough for them to fill the form and watch the videos, short enough that the momentum from signing up is still there.",
              "Check Dr. Marish's calendar for the window and offer specific times. Never ask the student when they're free — give them two or three slots and let them pick one.",
              "Once it's booked, send the confirmation and the post-booking link straight away.",
            ],
          },
          { kind: "script", title: "Meeting confirmation", body: MEETING_CONFIRM },
          { kind: "link", label: "Post-booking page", href: POST_BOOKING },
          { kind: "link", label: "Calendly — 30 min with Dr. Asudani", href: CALENDLY },
          {
            kind: "warn",
            text: "If the 24–36 hour window can't be met — Dr. Marish is travelling, the student is mid-exam — book the nearest slot you can and tell him the same day which student is outside the window and why. Never let it quietly slip.",
          },
        ],
      },
      {
        id: "ob-followups",
        label: "Onboarding form chased until it's filled",
        detail: "60 minutes, 120 minutes, 6 hours. Tap each as you send it.",
        slots: [
          { id: "60", label: "60 min" },
          { id: "120", label: "120 min" },
          { id: "360", label: "6 hr" },
        ],
        sop: [
          {
            kind: "p",
            text: "Three chases, timed from when the message set went out. Tap each slot as you send it — the app stamps the time, so the gaps are on record.",
          },
          {
            kind: "steps",
            items: [
              "60 minutes — light nudge. 'Did the link open alright?'",
              "120 minutes — ask directly whether they've filled it, and whether anything's unclear.",
              "6 hours — if it's still not in, call them.",
            ],
          },
          {
            kind: "p",
            text: "Once the form is in, tick all three and move on. If it's filled at minute ten, tick all three and note it — the point is the form, not the ritual.",
          },
        ],
      },
      {
        id: "ob-vault",
        label: "Full Vault access granted",
        sop: [
          {
            kind: "steps",
            items: [
              "Tell the student to sign up at usmlevault.com with an email.",
              "Ask them to send you that exact email address.",
              "Open the admin panel and grant that email complete, full access.",
              "Confirm back to the student that it's live, and ask them to log in and check.",
            ],
          },
          { kind: "link", label: "Admin panel", href: ADMIN },
          {
            kind: "creds",
            label: "Admin login",
            user: "official.p2a.consultancy@gmail.com",
            pass: "Mulimuli",
          },
        ],
      },
      {
        id: "ob-tracker",
        label: "Monthly enrolment tracker updated",
        sop: [
          {
            kind: "p",
            text: "The moment a student is onboarded, they go in the tracker. Not at the end of the week — the same day, while the details are in front of you.",
          },
        ],
      },
    ],
  },

  {
    id: "twitter",
    title: "Twitter · cleared by 17:30",
    tasks: [
      {
        id: "tw",
        label: "Twitter cleared",
        pills: SOCIAL_PILLS,
        sop: [
          {
            kind: "p",
            text: "Requests, DMs, comments. All three folders empty by end of day.",
          },
          {
            kind: "p",
            text: "Anything that reads like a mentorship enquiry goes down the enquiry workflow in the SOP tab — same script as Instagram. If you're unsure what to send, ask Dr. Marish rather than improvising.",
          },
        ],
      },
    ],
  },

  {
    id: "linkedin",
    title: "LinkedIn · cleared by 17:30",
    tasks: [
      {
        id: "li",
        label: "LinkedIn cleared",
        detail: "Connections accepted, DMs answered, every comment replied to.",
        pills: [
          { id: "connections", label: "Connections" },
          { id: "dms", label: "DMs" },
          { id: "comments", label: "Comments" },
        ],
        sop: [
          {
            kind: "steps",
            items: [
              "Accept every pending connection request. All of them — we don't filter who gets to follow the work.",
              "Clear the DMs. Anything that reads like a mentorship enquiry goes down the enquiry workflow, same script as Instagram.",
              "Go through every comment and reply to each one appropriately — read what they actually said and answer that. A blanket 'thank you' under twenty different comments is worse than not replying.",
            ],
          },
          {
            kind: "p",
            text: "Replies are public and they're under Dr. Marish's name. Warm, precise, never argumentative. If a comment is clinical, contentious, or asks something you're not certain of, don't answer it — bring it to him.",
          },
          {
            kind: "p",
            text: "Flag anyone who needs Dr. Marish directly rather than answering on his behalf.",
          },
        ],
      },
    ],
  },

  {
    id: "instagram",
    title: "Instagram · 16:00–16:30, then again from 17:30",
    tasks: [
      {
        id: "ig-sweeps",
        label: "Sweep all three accounts through the day",
        detail:
          "First sweep 16:00–16:30, then every 60 to 120 minutes. Tap once per sweep.",
        counter: { target: 6, noun: "sweeps" },
        sop: [
          {
            kind: "p",
            text: "Open Instagram every hour to two hours and go through it. Enquiries come in cold and go quiet fast — the faster you get to them, the better the conversation goes. Response speed is looked at directly.",
          },
          {
            kind: "p",
            text: "Six sweeps clears the row. If you do more, keep tapping — the count is the record.",
          },
        ],
      },
      {
        id: "ig-vault",
        label: "USMLE Vault",
        pills: IG_PILLS,
        sop: [
          {
            kind: "p",
            text: "All four buckets: primary DMs, general, requests, hidden requests. Hidden requests is the one everybody forgets — real enquiries sit in there for days.",
          },
        ],
      },
      {
        id: "ig-mentorship",
        label: "USMLE Mentorships",
        pills: IG_PILLS,
        sop: [
          {
            kind: "p",
            text: "Highest-intent account. Someone messaging here has usually already decided they want help — run the mentorship workflow.",
          },
        ],
      },
      {
        id: "ig-marish",
        label: "Marish Asudani",
        pills: IG_PILLS,
        sop: [
          {
            kind: "p",
            text: "Dr. Marish's personal account. Be careful about what you answer as him — anything personal or clinical goes to him, not you.",
          },
        ],
      },
    ],
  },

  {
    id: "content",
    title: "Content · posted by 17:15",
    tasks: [
      {
        id: "content-post",
        label: "Today's post checked against the Instagram content calendar",
        detail:
          "Checked by 17:00, posted by 17:15 at the latest. If nothing is queued, say so in the report.",
        sop: [
          {
            kind: "p",
            text: "Open the Instagram content calendar and find today's date. Post, reel, carousel, story — whatever's queued goes out today, not tomorrow.",
          },
          {
            kind: "pending",
            text: "Dr. Marish is confirming which calendar file is the live one. Until then, check with him before publishing.",
          },
        ],
      },
    ],
  },

  {
    id: "feedback",
    title: "Feedback",
    tasks: [
      {
        id: "feedback-check",
        label: "Every piece of feedback read and passed on",
        sop: [
          {
            kind: "p",
            text: "Two places. Feedback that arrives through any of the DMs, and the feedback section inside the Vault admin panel.",
          },
          {
            kind: "steps",
            items: [
              "Log into the admin panel and open the feedback section.",
              "Read all of it — not just the new-looking ones.",
              "Send Dr. Marish everything that needs him, with your own one-line read on each.",
            ],
          },
          { kind: "link", label: "Admin panel", href: ADMIN },
          {
            kind: "creds",
            label: "Admin login",
            user: "official.p2a.consultancy@gmail.com",
            pass: "Mulimuli",
          },
        ],
      },
      {
        id: "feedback-highlights",
        label: "Vault appreciation from WhatsApp added to the highlights",
        detail:
          "Any student praising the Vault — capture it the day you see it, not later.",
        sop: [
          {
            kind: "p",
            text: "Praise turns up in the middle of an ordinary conversation and is buried by the next scroll. The moment a student says the Vault worked for them — a score that jumped, a concept that finally landed, a plain thank-you — it goes into the highlights. This is not a weekly sweep. Same day, every time.",
          },
          {
            kind: "steps",
            items: [
              "Screenshot the message with the student's name and the date visible.",
              "Crop out anything private that isn't the point — payment talk, personal circumstances — unless the praise itself is about the score.",
              "Add it to the highlights with one line of context: who, which exam, and what they were reacting to.",
              "Anything exceptional goes to Dr. Marish the same day. Those are the ones that become posts.",
            ],
          },
          {
            kind: "warn",
            text: "Capturing is yours. Publishing is his. A student's words or name never leave the highlights without Dr. Marish clearing it first.",
          },
          {
            kind: "pending",
            text: "Dr. Marish is confirming where the highlights live, and whether it's the same source the Instagram story highlights are built from.",
          },
        ],
      },
    ],
  },

  {
    id: "meetings",
    title: "Meetings",
    tasks: [
      {
        id: "meet-calendar",
        label: "Dr. Marish's calendar opened and today's meetings pulled",
        sop: [
          {
            kind: "p",
            text: "Open his Google Calendar directly and read today. Every student with a slot needs a confirmation from you before they turn up.",
          },
        ],
      },
      {
        id: "meet-confirm",
        label: "Every student with a meeting today confirmed",
        detail:
          "Videos watched, post-booking page gone through. Call them if they don't reply.",
        sop: [
          {
            kind: "steps",
            items: [
              "Message every student who has a meeting with Dr. Marish today.",
              "Confirm they've watched the videos and gone through the post-booking page in full.",
              "No reply? Call them. Then text again. Do not let a student walk into that call cold.",
            ],
          },
          {
            kind: "script",
            title: "Meeting confirmation",
            body: MEETING_CONFIRM,
          },
          { kind: "link", label: "Post-booking page", href: POST_BOOKING },
        ],
      },
    ],
  },

  {
    id: "close",
    title: "Close-out",
    tasks: [
      {
        id: "transcripts",
        label: "Meeting transcripts synced",
        detail: "Dr. Marish's meetings from today, into the brain.",
        sop: [
          {
            kind: "pending",
            text: "This step is being rebuilt around the Obsidian brain. For now: make sure every meeting Dr. Marish had today has its transcript captured. The full procedure lands here once the brain is wired up.",
          },
        ],
      },
      {
        id: "pm-brief",
        label: "Evening brief to Dr. Marish — 20:00 to 21:00",
        detail: "Which students he personally has to get back to tonight.",
        sop: [
          {
            kind: "p",
            text: "The second brief of the day, and it works the same way as the morning one. Everything the students have said since you clocked in at 16:00, and the short list of people who need Dr. Marish himself.",
          },
          {
            kind: "steps",
            items: [
              "Go back through the day's messages across every group.",
              "One line per student who said something that matters.",
              "Then name the ones he has to answer tonight, and why. Keep that list short and real — if everything is urgent, nothing is.",
            ],
          },
          {
            kind: "p",
            text: "This is not the close-out report. This one is about students needing him; the close-out is about whether the day's work got done.",
          },
        ],
      },
      {
        id: "shift-clock",
        label: "Both shifts clocked in and out",
        detail:
          "Morning 10:00–12:00 IST, evening 16:00–22:00 IST. Same stamps as the clock at the top of the page.",
        slots: [
          { id: "am-in", label: "AM in", key: "shift:morning:in" },
          { id: "am-out", label: "AM out", key: "shift:morning:out" },
          { id: "pm-in", label: "PM in", key: "shift:evening:in" },
          { id: "pm-out", label: "PM out", key: "shift:evening:out" },
        ],
        sop: [
          {
            kind: "p",
            text: "Clock in when you start and out when you stop — both shifts, every day. Tapping here and tapping the clock at the top of the page are the same action; they write the same stamp.",
          },
          {
            kind: "p",
            text: "The times are recorded as they actually happen, not as they were scheduled. Clocking in late is fine and gets logged as late. Not clocking in at all is what isn't fine — it leaves no record that the shift happened, and the day's report will say so.",
          },
          {
            kind: "warn",
            text: "Don't stamp them all at the end of the day to tidy the row up. The point is the real times.",
          },
        ],
      },
      {
        id: "nightly",
        label: "Daily report sent to Dr. Marish",
        detail: "The last thing you do. It closes the day.",
        sop: [
          {
            kind: "p",
            text: "Generate the report at the bottom of this page, copy it, send it to Dr. Marish. Then tick this row.",
          },
          {
            kind: "p",
            text: "Add anything the checklist can't see in the notes box — a student who sounded off, a payment that's wobbling, something that needs him tomorrow.",
          },
        ],
      },
    ],
  },
];

/* ------------------------------- playbooks -------------------------------- */
// Reference material for the SOP tab. Not scored — read cold on day one, then
// reached for mid-conversation.

export type Playbook = {
  id: string;
  title: string;
  blurb: string;
  blocks: SopBlock[];
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "shape-of-day",
    title: "The shape of the day",
    blurb: "Two shifts, and what belongs in each hour of them.",
    blocks: [
      {
        kind: "p",
        text: "The order matters as much as the work. The morning exists to get Dr. Marish what he needs before 10:30; the evening front-loads the things that go stale — meetings, posts, inboxes — and leaves the long student work for the back half.",
      },
      {
        kind: "steps",
        items: [
          "10:00–10:30 — Read every reply and everything that came in overnight.",
          "Before 10:30 — First brief to Dr. Marish: what the students said, and who he must reach by 10:30.",
          "10:30–12:00 — Instagram DMs on all three accounts, and every meeting booked.",
          "16:00–16:30 — Back on: set meetings and clear the DMs again.",
          "By 17:15 — Today's Instagram post out, if the calendar has one queued.",
          "By 17:30 — LinkedIn and Twitter fully cleared: connections, DMs, comments.",
          "17:30 onward — Student updates across every group, replies sent, more Instagram meetings set.",
          "20:00–21:00 — Second brief to Dr. Marish: who he has to get back to tonight.",
          "Before 22:00 — Close-out report, and clock out.",
        ],
      },
      {
        kind: "warn",
        text: "The two briefs are the parts with hard deadlines. Everything else can slide by half an hour on a bad day; those cannot, because Dr. Marish is waiting on them to do his own work.",
      },
    ],
  },
  {
    id: "enquiry",
    title: "Clearing an enquiry",
    blurb:
      "Every DM splits three ways. Work out which one you're in before you type.",
    blocks: [
      {
        kind: "p",
        text: "Someone asking about a specific video or leaving a comment wants a resource. Someone who DMs 'USMLE', or asks about mentorship outright, wants the programme. Someone asking about Step 2 or Step 3 wants something we are not currently selling. Three different conversations, and they must not be mixed.",
      },
      {
        kind: "p",
        text: "Route A — asking about a video or a comment: send them the guides app. That's the whole interaction.",
      },
      { kind: "link", label: "Guides app", href: GUIDES },
      {
        kind: "p",
        text: "Route B — says 'USMLE', or asks about mentorship: do not pitch and do not qualify yet. Open with the two questions in 'What year, and what do they want' below. Their answers decide everything after.",
      },
      {
        kind: "p",
        text: "Route C — asking about Step 2 or Step 3: we are at peak capacity and have no places. Tell them so plainly, and send them the blog. There is a very detailed article there for both Step 2 and Step 3, and that article is the whole answer — do not qualify them, do not send the Calendly, do not put them into the mentorship workflow.",
      },
      { kind: "link", label: "Resources doc — every NBME", href: RESOURCES_DOC },
      { kind: "link", label: "Guide — USMLE in first year", href: YEAR_1 },
      { kind: "link", label: "Guide — USMLE in second year", href: YEAR_2 },
      { kind: "link", label: "Guide — Step 1 in third year", href: YEAR_3 },
      { kind: "link", label: "Guide — Step 1 in final year", href: YEAR_FINAL },
      { kind: "link", label: "The blog — Step 2 and Step 3 articles", href: BLOG },
      { kind: "script", title: "Route C — Step 2 or Step 3", body: STEP_2_3_REPLY },
      {
        kind: "p",
        text: "Say 'at the moment' and mean it. We are full, not closed — if a place opens, that student is worth coming back to. Take their name to Dr. Marish rather than losing them.",
      },
      {
        kind: "warn",
        text: "Any confusion about what to send — ask Dr. Marish. Don't improvise a new answer into a live enquiry.",
      },
    ],
  },
  {
    id: "year-routing",
    title: "What year, and what do they want",
    blurb:
      "The two questions that open every USMLE enquiry. Ask them before anything else.",
    blocks: [
      {
        kind: "p",
        text: "Someone says 'USMLE'. Before you pitch anything, before you qualify anyone, you ask two things: what year of med school they're in, and whether they want advice or someone to work with them one-on-one. The year tells you which article to send. The second answer tells you whether this is a resource conversation or a mentorship conversation — and that is the fork the whole enquiry turns on.",
      },
      { kind: "script", title: "Open with this", body: OPENING_ASK },
      {
        kind: "p",
        text: "They say ADVICE — send them the article for their year. That is the whole interaction. Send it warmly, don't follow it with a pitch.",
      },
      { kind: "script", title: "First year", body: YEAR_1_MESSAGE },
      { kind: "script", title: "Second year", body: YEAR_2_MESSAGE },
      { kind: "script", title: "Third year", body: YEAR_3_MESSAGE },
      { kind: "script", title: "Final year", body: YEAR_FINAL_MESSAGE },
      {
        kind: "p",
        text: "They say ONE-ON-ONE — that is a mentorship enquiry. Send their year's article anyway, then run the mentorship workflow below: the five questions, the timezone, and the call or the Vault depending on where they are.",
      },
      {
        kind: "p",
        text: "They say both, or they don't answer the second question — treat it as one-on-one. Someone who wanted only an article will say so; someone who wanted help and got handed a link quietly leaves.",
      },
      { kind: "link", label: "All the guides", href: GUIDES },
      {
        kind: "warn",
        text: "Send the article that matches the year they gave you. A second-year handed the third-year article knows immediately that nobody read their message.",
      },
    ],
  },
  {
    id: "mentorship",
    title: "Mentorship enquiry workflow",
    blurb:
      "Step 1 only, and only once they've said they want one-on-one help. Qualify first, never lead with the pitch.",
    blocks: [
      {
        kind: "p",
        text: "You do not open with the programme. You ask five questions first — it tells you what they need, and it makes the conversation theirs instead of a sales pitch.",
      },
      { kind: "script", title: "1 · The five questions", body: QUALIFIER },
      { kind: "script", title: "2 · Then ask", body: TIMEZONE_ASK },
      {
        kind: "p",
        text: "The timezone decides the path. USA or India → the call. Pakistan → the Vault.",
      },
      {
        kind: "script",
        title: "3a · USA and India — book the call",
        body: CALL_INVITE,
      },
      {
        kind: "script",
        title: "3b · Pakistan — pitch the Vault",
        body: VAULT_PITCH,
      },
      { kind: "script", title: "3b continued — send the guides", body: GUIDES_MESSAGE },
      {
        kind: "p",
        text: "The Vault is the low-ticket product. Pakistan students go there, not to the calendar — three days free, then the guides app to show them how to actually use it.",
      },
    ],
  },
  {
    id: "uworld",
    title: "Asking for UWorld",
    blurb: "The answer is no, and the answer doesn't soften.",
    blocks: [
      {
        kind: "p",
        text: "Students ask whether the app comes with UWorld, or whether we can get them a subscription, or whether we'll share one. We don't sell UWorld and we don't pass it around. Handing it on is plagiarism, and we say that plainly rather than dressing it up as a policy.",
      },
      { kind: "script", title: "The reply", body: UWORLD_REPLY },
      {
        kind: "p",
        text: "Then move them onto what we do have. The value was never the question bank — it's knowing what to do with it. Point them at the Vault and the guides.",
      },
      {
        kind: "warn",
        text: "No exceptions, no hedging, no 'let me ask Dr. Asudani'. Asking him implies it might be negotiable. It isn't.",
      },
    ],
  },
  {
    id: "links",
    title: "Every link and login",
    blurb: "The whole surface area, in one place.",
    blocks: [
      { kind: "link", label: "Onboarding form", href: ONBOARDING_FORM },
      { kind: "link", label: "Post-booking page", href: POST_BOOKING },
      { kind: "link", label: "Calendly — 30 min with Dr. Asudani", href: CALENDLY },
      { kind: "link", label: "Guides app", href: GUIDES },
      { kind: "link", label: "The blog — Step 2 and Step 3 articles", href: BLOG },
      { kind: "link", label: "Welcome video", href: WELCOME_VIDEO },
      { kind: "link", label: "Step 1 registration reel", href: REGISTRATION_REEL },
      { kind: "link", label: "Vault admin panel", href: ADMIN },
      {
        kind: "creds",
        label: "Admin login",
        user: "official.p2a.consultancy@gmail.com",
        pass: "Mulimuli",
      },
      {
        kind: "warn",
        text: "This page has no lock on it. Don't forward the URL to anyone outside the Founder's Office.",
      },
    ],
  },
];

/* -------------------------------- scoring --------------------------------- */

export const ALL_TASKS: Task[] = SECTIONS.flatMap((s) => s.tasks);
export const TOTAL_TASKS = ALL_TASKS.length;

export const STANDING_NOTE =
  "Every item here is done by hand, on purpose. Automation reads fast and skims — it will clear forty-seven messages and quietly miss the one student who needed us that day. Then it gets redone manually anyway, which defeats the point. Your eyes on every inbox is the work.";

/** Ticks hold booleans (boxes, pills), numbers (counters) and ISO strings (slots). */
export type Ticks = Record<string, boolean | number | string>;

export const pillKey = (task: Task, pill: Pill) => `${task.id}:${pill.id}`;
export const slotKey = (task: Task, slot: Slot) =>
  slot.key ?? `${task.id}@${slot.id}`;
export const counterKey = (task: Task) => `${task.id}#count`;

export function counterValue(task: Task, ticks: Ticks): number {
  const raw = ticks[counterKey(task)];
  return typeof raw === "number" ? raw : 0;
}

/** A section is skipped when its N/A switch is on. */
export function isSectionSkipped(section: Section, ticks: Ticks): boolean {
  return Boolean(section.skip && ticks[section.skip.id]);
}

const SKIPPED_TASK_IDS = (ticks: Ticks): Set<string> => {
  const out = new Set<string>();
  for (const section of SECTIONS) {
    if (isSectionSkipped(section, ticks)) {
      for (const t of section.tasks) out.add(t.id);
    }
  }
  return out;
};

export function isTaskDone(
  task: Task,
  ticks: Ticks,
  coverage?: Coverage
): boolean {
  if (SKIPPED_TASK_IDS(ticks).has(task.id)) return true;
  // The roster closes this one, never a tap.
  if (task.coverage) return Boolean(coverage?.complete);
  if (task.pills?.length) {
    return task.pills.every((p) => ticks[pillKey(task, p)]);
  }
  if (task.slots?.length) {
    return task.slots.every((s) => Boolean(ticks[slotKey(task, s)]));
  }
  if (task.counter) {
    return counterValue(task, ticks) >= task.counter.target;
  }
  return Boolean(ticks[task.id]);
}

export function countDone(ticks: Ticks, coverage?: Coverage): number {
  return ALL_TASKS.filter((t) => isTaskDone(t, ticks, coverage)).length;
}

export function percent(ticks: Ticks, coverage?: Coverage): number {
  return Math.round((countDone(ticks, coverage) / TOTAL_TASKS) * 100);
}

export type Grade = "A+" | "C-";

/** 75% or better is an A+ day. Anything below is a C- day. Two bands, nothing else. */
export function grade(ticks: Ticks, coverage?: Coverage): Grade {
  return percent(ticks, coverage) >= 75 ? "A+" : "C-";
}

/** Human-readable list of what is still open, for the nightly report. */
export function outstanding(ticks: Ticks, coverage?: Coverage): string[] {
  const skipped = SKIPPED_TASK_IDS(ticks);
  const open: string[] = [];
  for (const section of SECTIONS) {
    for (const task of section.tasks) {
      if (skipped.has(task.id) || isTaskDone(task, ticks, coverage)) continue;
      if (task.coverage) {
        open.push(
          `${section.title} · ${task.label} (${coverage?.taken ?? 0}/${coverage?.total ?? 0} students ticked)`
        );
      } else if (task.pills?.length) {
        const missing = task.pills
          .filter((p) => !ticks[pillKey(task, p)])
          .map((p) => p.label);
        open.push(`${section.title} · ${task.label} (${missing.join(", ")})`);
      } else if (task.slots?.length) {
        const missing = task.slots
          .filter((s) => !ticks[slotKey(task, s)])
          .map((s) => s.label);
        open.push(`${section.title} · ${task.label} (${missing.join(", ")})`);
      } else if (task.counter) {
        open.push(
          `${section.title} · ${task.label} (${counterValue(task, ticks)}/${task.counter.target} ${task.counter.noun})`
        );
      } else {
        open.push(`${section.title} · ${task.label}`);
      }
    }
  }
  return open;
}

/** Lines noting anything marked not-applicable, so the report is honest. */
export function skippedNotes(ticks: Ticks): string[] {
  return SECTIONS.filter((s) => isSectionSkipped(s, ticks)).map(
    (s) => `${s.title} — ${s.skip!.label.toLowerCase()}`
  );
}
