"""QC for a checklist plan, before and after publishing.

Usage:
  python qc-tracker.py <plan.json>              check the local file only
  python qc-tracker.py <plan.json> <token>      also check the live tracker

Why this exists: a plan saved with the wrong text encoding goes live with
junk characters ("â†’", "Â·") in the title and tasks. This script catches that
before the link is sent. Stdlib only. Every file is read as UTF-8, explicitly.

Exit 0 = passed. Exit 1 = something is wrong; do NOT send the link.
"""
import datetime
import json
import re
import sys
import urllib.error
import urllib.request

SITE = "https://usmlevault-daily.vercel.app"

# Characters that only appear when UTF-8 text was read as Windows-1252 or Latin-1
# (mojibake), plus the Unicode replacement character.
MOJIBAKE = ["Â", "Ã", "â", "�", "â€", "Ã©"]

# Text the plan must keep exactly, as the stored tracker must hold it.
def plan_strings(plan):
    yield "title", plan.get("title", "")
    yield "subtitle", plan.get("subtitle", "")
    for c in plan.get("cards", []):
        yield "card", c.get("title", "")
        for r in c.get("rows", []):
            yield "card row", r.get("label", "")
            yield "card row", r.get("value", "")
    for sec in plan.get("sections", []):
        yield "section", sec.get("title", "")
        yield "section sub", sec.get("sub", "")
        for d in sec.get("days", []):
            yield "day", d.get("label", "")
            yield "topic", d.get("topic", "")
            yield "callout", d.get("callout", "")
            for b in d.get("blocks", []):
                yield "block", b.get("label", "")
                for t in b.get("tasks", []):
                    yield "task", t.get("text", "")
                    yield "meta", t.get("meta", "")


def mojibake_in(s):
    return [m for m in MOJIBAKE if m in s]


def check_local(path):
    problems = []
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    plan_doc = json.loads(raw)  # fails loudly on bad JSON
    for label, s in plan_strings(plan_doc.get("plan", {})):
        bad = mojibake_in(s)
        if bad:
            problems.append(f"local file: garbled {label} {s!r}")
    if mojibake_in(raw):
        problems.append("local file: garbled characters somewhere in the file")
    problems += check_uworld_subtasks(plan_doc.get("plan", {}))
    problems += check_date_echo_meta(plan_doc.get("plan", {}))
    problems += check_section_subs(plan_doc.get("plan", {}))
    return plan_doc, problems


WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SUB_DATE = re.compile(r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\b")


def check_section_subs(plan):
    """Section sub-headings must match the section's own days.

    Every "Weekday N" in a sub must be a real day in that section, with the
    right weekday. The first and last dates named must be the section's first
    and last days. A sub may not say "Day N" (the page already prints it).
    """
    problems = []
    for sec in plan.get("sections", []):
        title = sec.get("title", "")
        sub = sec.get("sub", "")
        if title and not sub.strip():
            problems.append(f"local file: section {title!r} has no sub-heading")
        if re.search(r"\bDay\s*\d", sub, re.IGNORECASE):
            problems.append(f"local file: sub-heading {sub!r} says Day N; use dates or a budget")
        dates = set()
        for d in sec.get("days", []):
            if d.get("from") and d.get("to"):
                start = datetime.date.fromisoformat(d["from"])
                end = datetime.date.fromisoformat(d["to"])
                while start <= end:
                    dates.add(start)
                    start += datetime.timedelta(days=1)
        tokens = SUB_DATE.findall(sub)
        for wd, n in tokens:
            if not any(WEEKDAYS[d.weekday()] == wd and d.day == int(n) for d in dates):
                problems.append(f"local file: sub-heading {sub!r} names {wd} {n}, which is not a day in this section")
        if dates and len(tokens) >= 2:
            first, last = min(dates), max(dates)
            if tokens[0] != (WEEKDAYS[first.weekday()], str(first.day)):
                problems.append(f"local file: sub-heading {sub!r} starts on {tokens[0][0]} {tokens[0][1]}, but the section starts {WEEKDAYS[first.weekday()]} {first.day}")
            if tokens[-1] != (WEEKDAYS[last.weekday()], str(last.day)):
                problems.append(f"local file: sub-heading {sub!r} ends on {tokens[-1][0]} {tokens[-1][1]}, but the section ends {WEEKDAYS[last.weekday()]} {last.day}")
    return problems


# A meta that only repeats the day: "Today", "Start today", "Wrap up today"...
DATE_ECHO = re.compile(
    r"^(today|((start|begin|finish|wrap up)( [\w/]+)* today|begin roughly today))\.?$",
    re.IGNORECASE,
)


def check_date_echo_meta(plan):
    """A meta that only repeats the day or the date adds nothing; it must be empty."""
    problems = []
    for sec in plan.get("sections", []):
        for d in sec.get("days", []):
            for b in d.get("blocks", []):
                for t in b.get("tasks", []):
                    m = (t.get("meta") or "").strip()
                    if m and DATE_ECHO.match(m):
                        problems.append(f"local file: meta {m!r} on {t.get('id')!r} only repeats the day; leave it empty")
    return problems


SCREENSHOT_TEXT = "Send all the screenshots of the blocks in the group"


def check_uworld_subtasks(plan):
    """Every UWorld task must be followed by its '-ss' screenshot subtask."""
    problems = []
    for sec in plan.get("sections", []):
        for d in sec.get("days", []):
            for b in d.get("blocks", []):
                tasks = b.get("tasks", [])
                for i, t in enumerate(tasks):
                    if t.get("split") != "uworld":
                        continue
                    nxt = tasks[i + 1] if i + 1 < len(tasks) else {}
                    if nxt.get("id") != t.get("id", "") + "-ss" or nxt.get("text") != SCREENSHOT_TEXT:
                        problems.append(f"local file: UWorld task {t.get('id')!r} has no screenshot subtask")
    return problems


def all_strings(node):
    """Every string value anywhere in a parsed JSON object."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from all_strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from all_strings(v)


def check_live(plan_doc, token):
    problems = []
    with urllib.request.urlopen(f"{SITE}/api/t/{token}") as r:
        body = r.read().decode("utf-8")
    if mojibake_in(body):
        problems.append("live page: garbled characters in the stored tracker")
    stored = json.loads(body).get("tracker", {})
    # Compare whole strings, not JSON text: JSON escapes quote marks, which
    # would make a correct "quoted" label look different from the plan.
    stored_strings = set(all_strings(stored))
    for label, s in plan_strings(plan_doc.get("plan", {})):
        if s and s not in stored_strings:
            problems.append(f"live page: {label} differs from the plan: {s!r}")
    plan_tasks = sum(
        len(b.get("tasks", []))
        for sec in plan_doc["plan"].get("sections", [])
        for d in sec.get("days", [])
        for b in d.get("blocks", [])
    )
    stored_tasks = sum(
        len(b.get("tasks", []))
        for sec in stored.get("sections", [])
        for d in sec.get("days", [])
        for b in d.get("blocks", [])
    )
    if plan_tasks != stored_tasks:
        problems.append(f"live page: {stored_tasks} tasks stored, plan has {plan_tasks}")
    return problems


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    try:
        plan_doc, problems = check_local(sys.argv[1])
    except FileNotFoundError:
        problems, plan_doc = [f"file not found: {sys.argv[1]}"], None
    except json.JSONDecodeError as e:
        problems, plan_doc = [f"the file is not valid JSON ({e})"], None
    if len(sys.argv) > 2 and not problems:
        try:
            problems += check_live(plan_doc, sys.argv[2])
        except urllib.error.HTTPError as e:
            problems.append(f"live page: the site answered {e.code} for token {sys.argv[2]!r} (not published, or wrong token)")
        except (urllib.error.URLError, OSError) as e:
            problems.append(f"live page: could not reach {SITE} ({e}). Check the internet and run again")
    if problems:
        print("QC FAILED. Do not send the link:")
        for p in problems:
            print("  - " + p)
        return 1
    if len(sys.argv) > 2:
        print("QC passed: text clean, live page matches the plan.")
    else:
        print("Local QC passed: text clean. Live page not checked yet (pass the token).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
