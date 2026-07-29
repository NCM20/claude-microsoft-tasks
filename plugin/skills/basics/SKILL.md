---
name: basics
description: Core routing and working rules for Microsoft Planner and Microsoft To Do. Use whenever the user mentions a task, to-do, reminder, Planner, a board, a bucket, a plan, "my plate", "what's due", assigning work to someone, or capturing action items. Also use before any tool call whose name starts with planner_ or todo_.
---

# Working with Microsoft Tasks

Microsoft splits tasks across two systems that share a front end but not an API.
Getting the routing right is most of the job.

| | Microsoft To Do | Microsoft Planner |
|---|---|---|
| Owns | One person | A Microsoft 365 group / team |
| Visible to | Just the user (unless the list is shared) | Everyone on the plan |
| Assignment | Implicit, always the owner | Explicit, several people per task |
| Organised by | Lists | Plans, split into buckets |
| Tools | `todo_*` | `planner_*` |

The Teams app called "Tasks by Planner and To Do" is a view over both. When a
user says "Tasks" they mean that view, so ask which side they mean, or check
both.

## Routing a new task

1. Did the user name a plan, board, bucket, team, or another person? Planner.
2. Is it personal, private, or a reminder for themselves? To Do.
3. Neither is clear? Ask. Do not default to one silently. Guessing wrong puts a
   private note on a board the whole department can read, or buries a team
   commitment where nobody else will see it.

The one safe default: when the user says "remind me" or "don't let me forget",
that is To Do.

## Resolve, then act

Plan IDs, bucket IDs, and list IDs are opaque strings. They cannot be guessed
or constructed, and a wrong one either fails or, worse, writes to something
else. So:

- The user speaks a **name**; the tools need an **ID**. Always list first.
  `planner_list_plans`, `planner_list_buckets`, `todo_list_lists`.
- Names are matched by you, not by the API. If two plans could match what the
  user said, ask which one instead of picking the closer string.
- Do not carry an ID from earlier in a long conversation into a write. Plans
  get archived and lists get renamed. Re-list when the last lookup was several
  turns ago.
- Assignment needs an Entra user object ID, not a name or an email. Run
  `directory_find_person` first. If it returns more than one match, ask.
  `whoami` gives the signed-in user's own ID.

Finding the right task is not the same as completing the request. After
locating it, carry out the actual change the user asked for.

## Before you write

Confirm with the user before:

- **Deleting anything.** `planner_delete_task` and `todo_delete_task` are
  permanent and, on a shared board, they are permanent for everyone.
- **Any write to a Planner board.** Other people see it immediately and get
  notified. Say what you are about to create or change, then do it.
- **Reassigning work away from someone.** That is a conversation the user
  should have, not one you should perform for them.

Reading is free. Never ask permission to list or fetch.

To Do writes are the user's own private data. Just do them and report what
changed.

## Batching

When the user asks for several changes, gather the IDs you need first, then
make the writes. Report once at the end with what changed, rather than
narrating each call.

If one write in a batch fails, keep going with the rest and tell the user
plainly which one did not land and why.

## Dates

- Pass `YYYY-MM-DD` for a plain due date. The server anchors it so the calendar
  date survives timezone rendering.
- Pass a full ISO 8601 timestamp only when the user gave a specific time.
- Resolve relative dates yourself. "Friday" and "end of the month" must become
  a real date before the tool call, and it is worth stating the date you
  resolved to, so the user can correct you.
- To clear a date, pass an empty string.

## What these tools cannot do

Say so plainly rather than approximating:

- Create or delete plans, or change plan membership. Plans are created in
  Planner or Teams.
- Set up recurrence. Recurring To Do tasks must be created in the To Do app.
  Completing an existing recurring task does roll it to its next occurrence.
- Upload attachments. Planner attachment links can be read, not added.
- See other people's To Do lists. Only Planner is shared.

## Related skills

- Board mechanics, buckets, labels, and assignment: `planner`
- Personal lists, reminders, and steps: `todo`
- Reviewing everything at once, or capturing tasks from a meeting: `triage`
