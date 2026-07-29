---
name: todo
description: Mechanics of Microsoft To Do personal task lists, including due dates versus reminders, importance, steps, categories, and recurring tasks. Use when working with the user's own to-do lists, adding personal reminders, or reviewing what they personally have outstanding.
---

# Microsoft To Do lists

To Do holds the user's personal tasks. Everything here is private to them unless
they have explicitly shared a list.

## Lists

`todo_list_lists` returns every list. The one marked `isDefault` is the built-in
list that the To Do app labels "Tasks"; it is where anything goes when the user
does not name a list. Lists marked `isShared: true` are visible to others, so
treat writes there with the same care as a Planner board.

Two To Do features do not appear as lists in the API and cannot be written to:
"My Day", which is a daily view rather than storage, and "Flagged email", which
mirrors Outlook.

Create a new list only when the user asks for one. People accumulate lists they
never open, and a task in a forgotten list is worse than a task in the default
one.

## Due date is not a reminder

This trips people up constantly, so be explicit about which one you set.

- `dueDate` is when the task is due. It does not notify anyone.
- `reminderDateTime` is when To Do pings the user, and it needs a time, not just
  a date. Setting it turns the reminder on.

"Remind me Thursday" means a reminder, and it needs a time of day. Pick a
sensible one such as 09:00 and say which you chose, or ask if the timing
plausibly matters.

Setting both is normal: due Friday, reminder Thursday morning.

## Status

To Do carries five statuses: `notStarted`, `inProgress`, `completed`,
`waitingOnOthers`, `deferred`. The app only surfaces complete and not complete,
so the middle three are mostly useful as your own bookkeeping. `waitingOnOthers`
is genuinely handy when the user is blocked on somebody.

Use `todo_complete_task` for the common case rather than setting status by hand.

## Importance

`low`, `normal`, or `high`. `high` is what the To Do app shows as the star. This
is a separate concept from Planner's four-level priority; do not carry a value
across from one to the other without saying so.

## Steps

To Do calls checklist items "steps". Manage them with `todo_set_checklist`,
which can add, tick, untick, and delete in one call. Get the item IDs from
`todo_get_task`.

Break a task into steps when the user describes something with clear stages.
Do not invent steps they did not ask for.

## Notes

The `notes` field is free text on the task body. It is the right home for
context, links, and background. Passing `notes` replaces what is there, so read
the task first when adding to existing notes.

## Recurring tasks

You cannot create recurrence through these tools. If a user asks for a repeating
task, create the single task and tell them to set the repeat in the To Do app,
rather than silently creating a one-off they will assume repeats.

Existing recurring tasks work normally: completing one rolls the series forward
to its next occurrence, which is why a task you just completed can reappear with
a later due date. That is correct behaviour, not a failed write.

## Reviewing personal tasks

`todo_my_tasks` sweeps every list at once and sorts by due date, undated last.
This is the right tool for "what do I have on", not a series of
`todo_list_tasks` calls.

Use `dueBefore` to scope it, for example to today or the end of the week. Note
that `dueBefore` drops undated tasks entirely, which is usually what you want
for "what is due this week" and wrong for "what is outstanding".

When reporting back, lead with anything overdue, then today, then the rest.
Mention which list each task came from when the user has several, because the
list is often the only clue to what a terse task title means.
