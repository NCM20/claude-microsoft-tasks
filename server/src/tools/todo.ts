/**
 * Microsoft To Do tools.
 *
 * To Do is the personal, private side of Microsoft Tasks. Lists belong to one
 * person (though they can be shared), tasks have a single implicit owner, and
 * unlike Planner there is no ETag requirement on writes.
 *
 * Dates are `dateTimeTimeZone` objects rather than plain ISO strings, so they
 * need converting in both directions.
 */

import { ToolContext, ToolDefinition } from '../types';
import {
  ToolArgumentError,
  compact,
  defineTool,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireString,
  toGraphDateTime,
} from './util';

const STATUSES = ['notStarted', 'inProgress', 'completed', 'waitingOnOthers', 'deferred'] as const;
const IMPORTANCE = ['low', 'normal', 'high'] as const;

interface DateTimeTimeZone {
  dateTime?: string;
  timeZone?: string;
}

interface TodoTask {
  id: string;
  title?: string;
  status?: string;
  importance?: string;
  body?: { content?: string; contentType?: string };
  dueDateTime?: DateTimeTimeZone | null;
  reminderDateTime?: DateTimeTimeZone | null;
  completedDateTime?: DateTimeTimeZone | null;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  categories?: string[];
  isReminderOn?: boolean;
  hasAttachments?: boolean;
  recurrence?: unknown;
}

/** Graph wants a naive local timestamp plus an explicit zone, not an ISO `Z` string. */
function toDateTimeTimeZone(value: string, field: string): DateTimeTimeZone {
  const iso = toGraphDateTime(value, field);
  return { dateTime: iso.replace(/\.\d+Z$/, '').replace(/Z$/, ''), timeZone: 'UTC' };
}

/** Flatten a dateTimeTimeZone back to a plain ISO string for the model. */
function fromDateTimeTimeZone(value: DateTimeTimeZone | null | undefined): string | undefined {
  if (!value?.dateTime) return undefined;
  const zone = value.timeZone ?? 'UTC';
  if (zone !== 'UTC') return `${value.dateTime} (${zone})`;
  return `${value.dateTime.replace(/\.\d+$/, '')}Z`;
}

function slimTask(task: TodoTask, listId?: string) {
  return compact({
    id: task.id,
    listId,
    title: task.title,
    status: task.status,
    importance: task.importance,
    dueDateTime: fromDateTimeTimeZone(task.dueDateTime),
    reminderDateTime: task.isReminderOn ? fromDateTimeTimeZone(task.reminderDateTime) : undefined,
    completedDateTime: fromDateTimeTimeZone(task.completedDateTime),
    notes: task.body?.content?.trim() || undefined,
    categories: task.categories?.length ? task.categories : undefined,
    isRecurring: task.recurrence ? true : undefined,
    hasAttachments: task.hasAttachments || undefined,
  });
}

export const todoTools: ToolDefinition[] = [
  defineTool({
    name: 'todo_list_lists',
    title: 'List To Do lists',
    description:
      'List the signed-in user\'s Microsoft To Do lists. Call this first when the user names a list; never guess a list ID. The list flagged `defaultList` is the one To Do calls "Tasks".',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, { graph }: ToolContext) {
      const lists = await graph.list<{
        id: string;
        displayName?: string;
        isOwner?: boolean;
        isShared?: boolean;
        wellknownListName?: string;
      }>('/me/todo/lists');

      return {
        lists: lists.map((list) =>
          compact({
            id: list.id,
            name: list.displayName,
            isDefault: list.wellknownListName === 'defaultList' || undefined,
            isShared: list.isShared || undefined,
            isOwner: list.isOwner,
          }),
        ),
        count: lists.length,
      };
    },
  }),

  defineTool({
    name: 'todo_create_list',
    title: 'Create a To Do list',
    description: 'Create a new Microsoft To Do list for the signed-in user.',
    annotations: { idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name for the new list.' } },
      required: ['name'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const list = await graph.post<{ id: string; displayName?: string }>('/me/todo/lists', {
        displayName: requireString(args, 'name'),
      });
      return { id: list.id, name: list.displayName };
    },
  }),

  defineTool({
    name: 'todo_list_tasks',
    title: 'List tasks in a To Do list',
    description:
      'List tasks in one Microsoft To Do list. Completed tasks are excluded by default. Use todo_my_tasks instead to sweep every list at once.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'List ID from todo_list_lists.' },
        includeCompleted: { type: 'boolean', description: 'Include completed tasks. Defaults to false.' },
        limit: { type: 'number', description: 'Maximum tasks to return. Defaults to 50, maximum 200.' },
      },
      required: ['listId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const listId = requireString(args, 'listId');
      const includeCompleted = optionalBoolean(args, 'includeCompleted') ?? false;
      const limit = Math.min(optionalNumber(args, 'limit') ?? 50, 200);

      const tasks = await graph.list<TodoTask>(
        `/me/todo/lists/${listId}/tasks`,
        compact({
          $filter: includeCompleted ? undefined : "status ne 'completed'",
          $orderby: 'lastModifiedDateTime desc',
          $top: Math.min(limit, 100),
        }) as Record<string, string | number>,
        limit,
      );

      return { tasks: tasks.map((t) => slimTask(t, listId)), count: tasks.length };
    },
  }),

  defineTool({
    name: 'todo_my_tasks',
    title: 'List all my To Do tasks',
    description:
      'List open Microsoft To Do tasks across every one of the user\'s lists. This is the right tool for "what is on my to-do list" questions about personal tasks.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        dueBefore: {
          type: 'string',
          description: 'Only return tasks due on or before this date (YYYY-MM-DD). Tasks with no due date are excluded when set.',
        },
        limit: { type: 'number', description: 'Maximum tasks to return in total. Defaults to 100, maximum 300.' },
      },
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const dueBefore = optionalString(args, 'dueBefore');
      const limit = Math.min(optionalNumber(args, 'limit') ?? 100, 300);
      const cutoff = dueBefore ? new Date(toGraphDateTime(dueBefore, 'dueBefore')) : undefined;

      const lists = await graph.list<{ id: string; displayName?: string }>('/me/todo/lists');

      const perList = await Promise.all(
        lists.map(async (list) => {
          const tasks = await graph
            .list<TodoTask>(
              `/me/todo/lists/${list.id}/tasks`,
              { $filter: "status ne 'completed'", $top: 100 },
              200,
            )
            .catch(() => [] as TodoTask[]);
          return tasks.map((task) => ({ ...slimTask(task, list.id), listName: list.displayName }));
        }),
      );

      let tasks = perList.flat();
      if (cutoff) {
        tasks = tasks.filter((t) => t.dueDateTime && new Date(t.dueDateTime) <= cutoff);
      }
      // Undated tasks sort last; otherwise soonest first.
      tasks.sort((a, b) => (a.dueDateTime ?? '9999').localeCompare(b.dueDateTime ?? '9999'));

      return {
        tasks: tasks.slice(0, limit),
        returned: Math.min(tasks.length, limit),
        totalMatching: tasks.length,
        truncated: tasks.length > limit,
      };
    },
  }),

  defineTool({
    name: 'todo_get_task',
    title: 'Get a To Do task',
    description: 'Get one Microsoft To Do task including its notes and checklist items.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'List ID from todo_list_lists.' },
        taskId: { type: 'string', description: 'To Do task ID.' },
      },
      required: ['listId', 'taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const listId = requireString(args, 'listId');
      const taskId = requireString(args, 'taskId');

      const [task, checklist] = await Promise.all([
        graph.get<TodoTask>(`/me/todo/lists/${listId}/tasks/${taskId}`),
        graph
          .list<{ id: string; displayName?: string; isChecked?: boolean }>(
            `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`,
          )
          .catch(() => []),
      ]);

      return compact({
        ...slimTask(task, listId),
        checklistItems: checklist.length
          ? checklist.map((item) => ({ id: item.id, title: item.displayName, isChecked: item.isChecked ?? false }))
          : undefined,
      });
    },
  }),

  defineTool({
    name: 'todo_create_task',
    title: 'Create a To Do task',
    description:
      'Create a personal task in a Microsoft To Do list. Use this for the user\'s own work; use planner_create_task when the task belongs on a shared team board.',
    annotations: { idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'List ID from todo_list_lists.' },
        title: { type: 'string', description: 'Task title.' },
        notes: { type: 'string', description: 'Free-text notes stored on the task body.' },
        dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD or a full ISO 8601 timestamp.' },
        reminderDateTime: { type: 'string', description: 'Reminder time as an ISO 8601 timestamp. Turns the reminder on.' },
        importance: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Task importance.' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Category names to tag the task with.' },
      },
      required: ['listId', 'title'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const listId = requireString(args, 'listId');
      const notes = optionalString(args, 'notes');
      const dueDate = optionalString(args, 'dueDate');
      const reminder = optionalString(args, 'reminderDateTime');
      const importance = optionalString(args, 'importance');

      if (importance && !IMPORTANCE.includes(importance as (typeof IMPORTANCE)[number])) {
        throw new ToolArgumentError(`"importance" must be one of: ${IMPORTANCE.join(', ')}.`);
      }

      const body = compact({
        title: requireString(args, 'title'),
        body: notes ? { content: notes, contentType: 'text' } : undefined,
        dueDateTime: dueDate ? toDateTimeTimeZone(dueDate, 'dueDate') : undefined,
        reminderDateTime: reminder ? toDateTimeTimeZone(reminder, 'reminderDateTime') : undefined,
        isReminderOn: reminder ? true : undefined,
        importance,
        categories: optionalStringArray(args, 'categories'),
      });

      const task = await graph.post<TodoTask>(`/me/todo/lists/${listId}/tasks`, body);
      return slimTask(task, listId);
    },
  }),

  defineTool({
    name: 'todo_update_task',
    title: 'Update a To Do task',
    description: 'Update fields on a Microsoft To Do task. Only the fields you pass are changed.',
    annotations: { idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'List ID from todo_list_lists.' },
        taskId: { type: 'string', description: 'To Do task ID.' },
        title: { type: 'string', description: 'New title.' },
        notes: { type: 'string', description: 'Replaces the notes. Pass an empty string to clear them.' },
        dueDate: { type: 'string', description: 'New due date (YYYY-MM-DD or ISO 8601). Pass an empty string to clear it.' },
        reminderDateTime: { type: 'string', description: 'New reminder time. Pass an empty string to turn the reminder off.' },
        importance: { type: 'string', enum: ['low', 'normal', 'high'], description: 'New importance.' },
        status: {
          type: 'string',
          enum: [...STATUSES],
          description: 'New status. Prefer todo_complete_task for the common complete/reopen case.',
        },
      },
      required: ['listId', 'taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const listId = requireString(args, 'listId');
      const taskId = requireString(args, 'taskId');
      const importance = optionalString(args, 'importance');
      const status = optionalString(args, 'status');

      if (importance && !IMPORTANCE.includes(importance as (typeof IMPORTANCE)[number])) {
        throw new ToolArgumentError(`"importance" must be one of: ${IMPORTANCE.join(', ')}.`);
      }
      if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
        throw new ToolArgumentError(`"status" must be one of: ${STATUSES.join(', ')}.`);
      }

      const notes = args.notes as string | undefined;
      const dueDate = args.dueDate as string | undefined;
      const reminder = args.reminderDateTime as string | undefined;

      const body = compact({
        title: optionalString(args, 'title'),
        body: notes === undefined ? undefined : { content: notes, contentType: 'text' },
        dueDateTime: dueDate === undefined ? undefined : dueDate === '' ? null : toDateTimeTimeZone(dueDate, 'dueDate'),
        reminderDateTime:
          reminder === undefined ? undefined : reminder === '' ? null : toDateTimeTimeZone(reminder, 'reminderDateTime'),
        isReminderOn: reminder === undefined ? undefined : reminder !== '',
        importance,
        status,
      });

      if (Object.keys(body).length === 0) {
        throw new ToolArgumentError('Pass at least one field to update.');
      }

      const task = await graph.patch<TodoTask>(`/me/todo/lists/${listId}/tasks/${taskId}`, body);
      return slimTask(task, listId);
    },
  }),

  defineTool({
    name: 'todo_complete_task',
    title: 'Complete or reopen a To Do task',
    description:
      'Mark a Microsoft To Do task complete, or reopen it by passing completed=false. For a recurring task, completing it rolls the series to the next occurrence.',
    annotations: { idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'List ID from todo_list_lists.' },
        taskId: { type: 'string', description: 'To Do task ID.' },
        completed: { type: 'boolean', description: 'True to complete, false to reopen. Defaults to true.' },
      },
      required: ['listId', 'taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const listId = requireString(args, 'listId');
      const taskId = requireString(args, 'taskId');
      const completed = optionalBoolean(args, 'completed') ?? true;

      const task = await graph.patch<TodoTask>(`/me/todo/lists/${listId}/tasks/${taskId}`, {
        status: completed ? 'completed' : 'notStarted',
      });
      return slimTask(task, listId);
    },
  }),

  defineTool({
    name: 'todo_set_checklist',
    title: 'Edit a To Do task checklist',
    description: 'Add, tick, untick, or delete checklist items (To Do calls these "steps") on a task.',
    annotations: { idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'List ID from todo_list_lists.' },
        taskId: { type: 'string', description: 'To Do task ID.' },
        addItems: { type: 'array', items: { type: 'string' }, description: 'Step titles to add.' },
        checkItemIds: { type: 'array', items: { type: 'string' }, description: 'Step IDs to mark done.' },
        uncheckItemIds: { type: 'array', items: { type: 'string' }, description: 'Step IDs to mark not done.' },
        removeItemIds: { type: 'array', items: { type: 'string' }, description: 'Step IDs to delete.' },
      },
      required: ['listId', 'taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const listId = requireString(args, 'listId');
      const taskId = requireString(args, 'taskId');
      const base = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`;

      const add = optionalStringArray(args, 'addItems') ?? [];
      const check = optionalStringArray(args, 'checkItemIds') ?? [];
      const uncheck = optionalStringArray(args, 'uncheckItemIds') ?? [];
      const remove = optionalStringArray(args, 'removeItemIds') ?? [];

      if (!add.length && !check.length && !uncheck.length && !remove.length) {
        throw new ToolArgumentError('Pass at least one checklist change.');
      }

      // Unlike Planner, To Do checklist items are individually addressable
      // resources rather than a single map, so each change is its own request.
      for (const title of add) await graph.post(base, { displayName: title });
      for (const id of check) await graph.patch(`${base}/${id}`, { isChecked: true });
      for (const id of uncheck) await graph.patch(`${base}/${id}`, { isChecked: false });
      for (const id of remove) await graph.delete(`${base}/${id}`);

      const items = await graph.list<{ id: string; displayName?: string; isChecked?: boolean }>(base);
      return {
        taskId,
        checklistItems: items.map((item) => ({
          id: item.id,
          title: item.displayName,
          isChecked: item.isChecked ?? false,
        })),
      };
    },
  }),

  defineTool({
    name: 'todo_delete_task',
    title: 'Delete a To Do task',
    description: 'Permanently delete a Microsoft To Do task. This cannot be undone. Confirm with the user before calling.',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'List ID from todo_list_lists.' },
        taskId: { type: 'string', description: 'To Do task ID.' },
      },
      required: ['listId', 'taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const listId = requireString(args, 'listId');
      const taskId = requireString(args, 'taskId');
      await graph.delete(`/me/todo/lists/${listId}/tasks/${taskId}`);
      return { id: taskId, deleted: true };
    },
  }),
];
