---
name: planner
description: Mechanics of Microsoft Planner boards, including buckets, labels, priority, assignment, checklists, and task descriptions. Use when working with a Planner plan or board, moving tasks between buckets, assigning or reassigning work, setting priority or labels, or reporting on a team board's status.
---

# Planner boards

A plan belongs to a Microsoft 365 group. It contains buckets, which are the
columns on the board, and tasks, which sit in exactly one bucket each.

## The two-entity model

Every Planner task is really two Graph resources:

- The **task**: title, dates, priority, bucket, assignees, labels, progress.
  Changed with `planner_update_task`, `planner_complete_task`,
  `planner_assign_task`.
- The **details**: the long description, the checklist, and attachment links.
  Changed with `planner_set_task_details`.

`planner_get_task` reads both, so use it whenever you need a task's description
or checklist. `planner_list_tasks` returns only the task half plus counts, which
is enough for board summaries and much cheaper.

Both halves carry their own ETag. The tools fetch and pass those for you, so
never construct one. If a write comes back complaining about a stale ETag,
somebody edited the task in the last moment: re-read it and retry once. If it
fails again, stop and tell the user rather than looping.

## Buckets are workflow, not category

Most teams use buckets as stages: To Do, In Progress, Blocked, Done. A few use
them as workstreams. Look at the bucket names before assuming.

Moving a task between buckets is `planner_update_task` with `bucketId`. Moving
it to a "Done" bucket does **not** complete it, and completing a task does not
move it. On boards that keep a Done bucket, do both, and say that you did.

## Progress

Planner has three states behind one number:

| `percentComplete` | Shows as |
|---|---|
| 0 | Not started |
| 1 to 99 | In progress |
| 100 | Completed |

Use `planner_complete_task` for the common complete or reopen case. Use
`planner_update_task` with `percentComplete: 50` to mark something as underway.
Reopening sets it back to 0, not to its previous value, because Planner does not
retain one.

## Priority

Pass `urgent`, `important`, `medium`, or `low`. These map onto the four levels
the Planner UI actually shows. Do not invent a numeric priority.

## Labels

Planner labels are 25 fixed slots (`category1` through `category25`) that each
plan names for itself. `planner_list_plans` with `includeLabels: true` returns
the mapping, so "the Blocked label" becomes `category4` on that plan and
something else entirely on the next one.

Read labels back through that mapping too. Reporting "category7" to a user is
useless.

## Assignment

1. `directory_find_person` to turn a name into an Entra user object ID.
2. `planner_assign_task` with `addUserIds`, `removeUserIds`, or both.

Assignees you do not mention stay assigned. To replace one person with another,
pass both `addUserIds` and `removeUserIds` in the same call.

Anyone can be assigned only if they are a member of the group that owns the
plan. A 403 on assignment usually means the person is not on the team, not that
the user lacks permission.

Confirm before assigning work to someone other than the signed-in user. Someone
receives a notification with their name on it.

## Descriptions and checklists

Descriptions are plain text. `planner_set_task_details` replaces the whole
description, so read the current one first if the user wants to add to it rather
than overwrite it.

Checklist items are a good fit for the steps in a task. Add several at once with
`addChecklistItems`. To tick items off you need their IDs, which come from
`planner_get_task`. Planner caps a checklist at 20 items.

Prefer a checklist over a numbered list buried in the description. Checklists
show progress on the board card; descriptions do not.

## Reporting on a board

For "how is the project going" questions:

1. `planner_list_plans` to resolve the plan.
2. `planner_list_buckets` to learn the workflow stages.
3. `planner_list_tasks` with `includeCompleted: true` when you need
   completion rates, false when you want the live workload.

Worth calling out unprompted, because it is what people actually want to know:

- Tasks overdue right now, and by how long.
- Tasks with no assignee. These are the ones that quietly never get done.
- Tasks with no due date, if the board otherwise uses them.
- Anyone carrying noticeably more open tasks than the rest of the team.

Group by bucket or by assignee, whichever matches the question. Give counts
alongside examples rather than listing forty task titles.
