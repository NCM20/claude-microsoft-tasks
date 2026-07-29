---
name: triage
description: Workflows for reviewing everything on the user's plate across Planner and To Do, running a daily or weekly review, and capturing action items from meeting notes, email, or chat into the right task system. Use for "what's on my plate", "what's due", "weekly review", "catch me up", "turn these notes into tasks", or when action items surface in a document or thread.
---

# Triage and capture

Two workflows: looking at what already exists, and getting new commitments into
the right place.

## What is on my plate

Read both systems before answering. People do not track which system a
commitment landed in, and an answer that covers only one is worse than useless
because it reads as complete.

1. `todo_my_tasks` for personal tasks across every list.
2. `planner_my_tasks` for shared work assigned to the user.

Then merge and sort by urgency, not by source. The user does not care which
Microsoft product a task lives in.

Report in this order:

1. **Overdue**, with how late. This is the only part most people read.
2. **Due today.**
3. **Due this week.**
4. **No due date**, as a count with a few examples rather than the full list.

Keep it to something a person can act on. Twelve items with dates beats forty
items in a wall of bullets. Say the total, show what matters, and offer to go
deeper.

Note the source per item only where it changes what the user would do, for
instance that a task sits on a shared board where colleagues can see it slipping.

## Daily review

Scope to today and tomorrow. Lead with anything overdue, then what is due. Close
by asking whether anything should move, rather than moving it yourself.

## Weekly review

Wider and more analytical:

- Everything due in the next seven days, across both systems.
- Anything overdue, with age. Something three weeks late is a different
  conversation from something two days late.
- Tasks completed in the last week, for a sense of throughput. Pass
  `includeCompleted: true`.
- Tasks with no due date that have been open a long time. These are usually
  either genuinely dead or quietly important.

Offer concrete cleanup: dates worth adding, tasks worth closing, work that
should move from a personal list onto a shared board because it turns out other
people depend on it. Propose, then wait for the user to pick.

## Capturing action items

When action items appear in meeting notes, an email thread, a Teams chat, or a
document, turn them into tasks properly rather than restating them.

For each candidate, work out:

- **What the commitment actually is.** A task title should say what to do, not
  echo the sentence it came from. "Send Q3 forecast to Dana" beats "Follow up on
  the forecast discussion".
- **Whose it is.** Someone else's commitment goes on a Planner board assigned to
  them, if the user has a board for it. The user's own goes wherever the routing
  rules point.
- **When it is due.** Take a date if the source gives one. Do not invent
  deadlines that nobody agreed to; leave the due date empty instead.
- **Whether it is already tracked.** Check the likely list or plan before
  creating. Duplicated tasks are how people stop trusting their task list.

Then show the user the full set you propose to create, with destination and due
date, and create them once they confirm. One confirmation for the batch, not one
per task.

Put source context in the notes or description: which meeting, which thread,
which date. In three weeks that context is the difference between a task getting
done and a task getting deleted.

## Things worth flagging unprompted

While reviewing, these are worth raising even though nobody asked:

- The same commitment tracked in two places.
- A Planner task assigned to nobody that has a due date.
- A task the user keeps pushing, which usually means it is blocked or it is not
  really theirs.
- A shared board where the user's own tasks are the ones holding others up.

Mention these briefly at the end. Do not act on them.
