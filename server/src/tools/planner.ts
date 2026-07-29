/**
 * Microsoft Planner tools.
 *
 * Planner is the shared, group-owned side of Microsoft Tasks: plans live in a
 * Microsoft 365 group, contain buckets (columns) and tasks, and tasks can be
 * assigned to several people. Long-form fields (description, checklist,
 * attachments) live on a separate `details` entity with its own ETag, which is
 * why "get task" and "set details" both touch two Graph resources.
 */

import { currentEtag, etagOf } from '../graph';
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
  uuid,
} from './util';

// Planner stores priority as 0-10. The UI only ever shows these four buckets.
const PRIORITY_TO_LABEL: Record<number, string> = { 1: 'urgent', 3: 'important', 5: 'medium', 9: 'low' };
const LABEL_TO_PRIORITY: Record<string, number> = { urgent: 1, important: 3, medium: 5, low: 9 };

function priorityLabel(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (PRIORITY_TO_LABEL[value]) return PRIORITY_TO_LABEL[value];
  if (value <= 1) return 'urgent';
  if (value <= 4) return 'important';
  if (value <= 7) return 'medium';
  return 'low';
}

function progressLabel(percentComplete: number | undefined): string {
  if (percentComplete === undefined) return 'notStarted';
  if (percentComplete >= 100) return 'completed';
  if (percentComplete > 0) return 'inProgress';
  return 'notStarted';
}

interface PlannerTask {
  id: string;
  planId?: string;
  bucketId?: string;
  title?: string;
  percentComplete?: number;
  priority?: number;
  startDateTime?: string | null;
  dueDateTime?: string | null;
  completedDateTime?: string | null;
  createdDateTime?: string;
  hasDescription?: boolean;
  checklistItemCount?: number;
  activeChecklistItemCount?: number;
  referenceCount?: number;
  assignments?: Record<string, { orderHint?: string } | null>;
  appliedCategories?: Record<string, boolean>;
  '@odata.etag'?: string;
}

/**
 * Project a Planner task down to the fields a model actually reasons about.
 * Raw Planner tasks carry a dozen order hints and null timestamps that burn
 * context without informing any decision.
 */
function slimTask(task: PlannerTask) {
  return compact({
    id: task.id,
    title: task.title,
    status: progressLabel(task.percentComplete),
    percentComplete: task.percentComplete,
    priority: priorityLabel(task.priority),
    planId: task.planId,
    bucketId: task.bucketId,
    dueDateTime: task.dueDateTime ?? undefined,
    startDateTime: task.startDateTime ?? undefined,
    completedDateTime: task.completedDateTime ?? undefined,
    assignedTo: Object.entries(task.assignments ?? {})
      .filter(([, v]) => v !== null)
      .map(([userId]) => userId),
    labels: Object.entries(task.appliedCategories ?? {})
      .filter(([, applied]) => applied)
      .map(([category]) => category),
    hasDescription: task.hasDescription || undefined,
    checklist: task.checklistItemCount
      ? { total: task.checklistItemCount, remaining: task.activeChecklistItemCount ?? 0 }
      : undefined,
    attachmentCount: task.referenceCount || undefined,
  });
}

export const plannerTools: ToolDefinition[] = [
  defineTool({
    name: 'planner_list_plans',
    title: 'List Planner plans',
    description:
      'List the Planner plans the signed-in user belongs to. Always call this first when the user names a plan or board in words; never guess a plan ID. Returns plan IDs plus the label names configured on each plan.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        includeLabels: {
          type: 'boolean',
          description:
            'Also fetch each plan\'s label names (category1..category25). Costs one extra request per plan, so leave false when simply resolving a plan ID.',
        },
      },
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const includeLabels = optionalBoolean(args, 'includeLabels') ?? false;
      const plans = await graph.list<{ id: string; title?: string; container?: { containerId?: string; type?: string } }>(
        '/me/planner/plans',
        undefined,
        100,
      );

      const results = await Promise.all(
        plans.map(async (plan) => {
          const base = compact({
            id: plan.id,
            title: plan.title,
            ownerGroupId: plan.container?.containerId,
          });
          if (!includeLabels) return base;

          try {
            const details = await graph.get<{ categoryDescriptions?: Record<string, string | null> }>(
              `/planner/plans/${plan.id}/details`,
            );
            const labels = Object.entries(details.categoryDescriptions ?? {})
              .filter(([, name]) => Boolean(name))
              .map(([category, name]) => ({ category, name }));
            return { ...base, labels };
          } catch {
            // A plan the user can see but whose details are restricted should
            // not fail the whole listing.
            return base;
          }
        }),
      );

      return { plans: results, count: results.length };
    },
  }),

  defineTool({
    name: 'planner_list_buckets',
    title: 'List buckets in a plan',
    description:
      'List the buckets (columns) in a Planner plan. Call this before creating or moving a task when the user refers to a bucket by name.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { planId: { type: 'string', description: 'Plan ID from planner_list_plans.' } },
      required: ['planId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const planId = requireString(args, 'planId');
      const buckets = await graph.list<{ id: string; name?: string; orderHint?: string }>(
        `/planner/plans/${planId}/buckets`,
      );
      return { buckets: buckets.map((b) => ({ id: b.id, name: b.name })), count: buckets.length };
    },
  }),

  defineTool({
    name: 'planner_create_bucket',
    title: 'Create a bucket',
    description: 'Create a new bucket (column) in a Planner plan.',
    annotations: { idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID from planner_list_plans.' },
        name: { type: 'string', description: 'Bucket name as it will appear on the board.' },
      },
      required: ['planId', 'name'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const bucket = await graph.post<{ id: string; name?: string }>('/planner/buckets', {
        planId: requireString(args, 'planId'),
        name: requireString(args, 'name'),
        orderHint: ' !', // Planner's "put it first" sentinel.
      });
      return { id: bucket.id, name: bucket.name };
    },
  }),

  defineTool({
    name: 'planner_list_tasks',
    title: 'List tasks in a plan',
    description:
      'List tasks on a Planner plan, newest activity first. Completed tasks are excluded by default. Use this to answer questions about a shared board.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID from planner_list_plans.' },
        bucketId: { type: 'string', description: 'Only return tasks in this bucket.' },
        assignedToUserId: { type: 'string', description: 'Only return tasks assigned to this user ID (a GUID, not a name).' },
        includeCompleted: { type: 'boolean', description: 'Include completed tasks. Defaults to false.' },
        limit: { type: 'number', description: 'Maximum tasks to return. Defaults to 50, maximum 200.' },
      },
      required: ['planId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const planId = requireString(args, 'planId');
      const bucketId = optionalString(args, 'bucketId');
      const assignedToUserId = optionalString(args, 'assignedToUserId');
      const includeCompleted = optionalBoolean(args, 'includeCompleted') ?? false;
      const limit = Math.min(optionalNumber(args, 'limit') ?? 50, 200);

      // Planner does not support $filter on the tasks collection, so we
      // over-fetch and narrow here.
      const tasks = await graph.list<PlannerTask>(`/planner/plans/${planId}/tasks`, undefined, 400);

      const filtered = tasks
        .filter((t) => (includeCompleted ? true : (t.percentComplete ?? 0) < 100))
        .filter((t) => (bucketId ? t.bucketId === bucketId : true))
        .filter((t) => (assignedToUserId ? Boolean(t.assignments?.[assignedToUserId]) : true));

      return {
        tasks: filtered.slice(0, limit).map(slimTask),
        returned: Math.min(filtered.length, limit),
        totalMatching: filtered.length,
        truncated: filtered.length > limit,
      };
    },
  }),

  defineTool({
    name: 'planner_my_tasks',
    title: 'List my Planner tasks',
    description:
      'List Planner tasks assigned to the signed-in user across every plan. This is the right tool for "what is assigned to me" questions about shared boards.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        includeCompleted: { type: 'boolean', description: 'Include completed tasks. Defaults to false.' },
        limit: { type: 'number', description: 'Maximum tasks to return. Defaults to 50, maximum 200.' },
      },
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const includeCompleted = optionalBoolean(args, 'includeCompleted') ?? false;
      const limit = Math.min(optionalNumber(args, 'limit') ?? 50, 200);

      const tasks = await graph.list<PlannerTask>('/me/planner/tasks', undefined, 400);
      const filtered = tasks.filter((t) => (includeCompleted ? true : (t.percentComplete ?? 0) < 100));

      return {
        tasks: filtered.slice(0, limit).map(slimTask),
        returned: Math.min(filtered.length, limit),
        totalMatching: filtered.length,
        truncated: filtered.length > limit,
      };
    },
  }),

  defineTool({
    name: 'planner_get_task',
    title: 'Get a Planner task',
    description:
      'Get one Planner task including its description, checklist, and attachment links. Use this before summarising or updating a specific task.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Planner task ID.' } },
      required: ['taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const taskId = requireString(args, 'taskId');
      const [task, details] = await Promise.all([
        graph.get<PlannerTask>(`/planner/tasks/${taskId}`),
        graph
          .get<{
            description?: string;
            checklist?: Record<string, { title?: string; isChecked?: boolean } | null>;
            references?: Record<string, { alias?: string; type?: string } | null>;
          }>(`/planner/tasks/${taskId}/details`)
          .catch(() => undefined),
      ]);

      return compact({
        ...slimTask(task),
        description: details?.description || undefined,
        checklistItems: Object.entries(details?.checklist ?? {})
          .filter(([, item]) => item !== null)
          .map(([id, item]) => ({ id, title: item?.title, isChecked: item?.isChecked ?? false })),
        attachments: Object.entries(details?.references ?? {})
          .filter(([, ref]) => ref !== null)
          .map(([url, ref]) => ({ url: decodeURIComponent(url), alias: ref?.alias })),
      });
    },
  }),

  defineTool({
    name: 'planner_create_task',
    title: 'Create a Planner task',
    description:
      'Create a task on a shared Planner plan. Requires a plan ID; resolve it with planner_list_plans first. Set a description or checklist afterwards with planner_set_task_details.',
    annotations: { idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID from planner_list_plans.' },
        title: { type: 'string', description: 'Task title.' },
        bucketId: { type: 'string', description: 'Bucket to place the task in. Defaults to the plan default.' },
        dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD or a full ISO 8601 timestamp.' },
        startDate: { type: 'string', description: 'Start date as YYYY-MM-DD or a full ISO 8601 timestamp.' },
        priority: { type: 'string', enum: ['urgent', 'important', 'medium', 'low'], description: 'Task priority.' },
        assigneeUserIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Entra user object IDs to assign. Resolve names to IDs with directory_find_person first.',
        },
      },
      required: ['planId', 'title'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const dueDate = optionalString(args, 'dueDate');
      const startDate = optionalString(args, 'startDate');
      const priority = optionalString(args, 'priority');
      const assignees = optionalStringArray(args, 'assigneeUserIds') ?? [];

      if (priority && !(priority in LABEL_TO_PRIORITY)) {
        throw new ToolArgumentError('"priority" must be one of: urgent, important, medium, low.');
      }

      const body = compact({
        planId: requireString(args, 'planId'),
        title: requireString(args, 'title'),
        bucketId: optionalString(args, 'bucketId'),
        dueDateTime: dueDate ? toGraphDateTime(dueDate, 'dueDate') : undefined,
        startDateTime: startDate ? toGraphDateTime(startDate, 'startDate') : undefined,
        priority: priority ? LABEL_TO_PRIORITY[priority] : undefined,
        assignments: assignees.length ? buildAssignments(assignees) : undefined,
      });

      const task = await graph.post<PlannerTask>('/planner/tasks', body);
      return slimTask(task);
    },
  }),

  defineTool({
    name: 'planner_update_task',
    title: 'Update a Planner task',
    description:
      'Update fields on a Planner task. Only the fields you pass are changed. The required ETag is fetched automatically, so never pass one. To edit the description or checklist, use planner_set_task_details instead.',
    annotations: { idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Planner task ID.' },
        title: { type: 'string', description: 'New title.' },
        bucketId: { type: 'string', description: 'Move the task to this bucket.' },
        dueDate: { type: 'string', description: 'New due date (YYYY-MM-DD or ISO 8601). Pass an empty string to clear it.' },
        startDate: { type: 'string', description: 'New start date (YYYY-MM-DD or ISO 8601). Pass an empty string to clear it.' },
        priority: { type: 'string', enum: ['urgent', 'important', 'medium', 'low'], description: 'New priority.' },
        percentComplete: { type: 'number', description: 'Progress from 0 to 100. 0 is not started, 100 is completed.' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const taskId = requireString(args, 'taskId');
      const priority = optionalString(args, 'priority');
      if (priority && !(priority in LABEL_TO_PRIORITY)) {
        throw new ToolArgumentError('"priority" must be one of: urgent, important, medium, low.');
      }

      const percentComplete = optionalNumber(args, 'percentComplete');
      if (percentComplete !== undefined && (percentComplete < 0 || percentComplete > 100)) {
        throw new ToolArgumentError('"percentComplete" must be between 0 and 100.');
      }

      // An explicit empty string means "clear this date"; absent means "leave it".
      const dueDate = args.dueDate as string | undefined;
      const startDate = args.startDate as string | undefined;

      const body = compact({
        title: optionalString(args, 'title'),
        bucketId: optionalString(args, 'bucketId'),
        dueDateTime: dueDate === undefined ? undefined : dueDate === '' ? null : toGraphDateTime(dueDate, 'dueDate'),
        startDateTime:
          startDate === undefined ? undefined : startDate === '' ? null : toGraphDateTime(startDate, 'startDate'),
        priority: priority ? LABEL_TO_PRIORITY[priority] : undefined,
        percentComplete,
      });

      if (Object.keys(body).length === 0) {
        throw new ToolArgumentError('Pass at least one field to update.');
      }

      const etag = await currentEtag(graph, `/planner/tasks/${taskId}`);
      const updated = await graph.patch<PlannerTask>(`/planner/tasks/${taskId}`, body, etag);
      return updated ? slimTask(updated) : { id: taskId, updated: true };
    },
  }),

  defineTool({
    name: 'planner_complete_task',
    title: 'Complete or reopen a Planner task',
    description: 'Mark a Planner task complete, or reopen it by passing completed=false.',
    annotations: { idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Planner task ID.' },
        completed: { type: 'boolean', description: 'True to complete, false to reopen. Defaults to true.' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const taskId = requireString(args, 'taskId');
      const completed = optionalBoolean(args, 'completed') ?? true;
      const etag = await currentEtag(graph, `/planner/tasks/${taskId}`);
      const updated = await graph.patch<PlannerTask>(
        `/planner/tasks/${taskId}`,
        { percentComplete: completed ? 100 : 0 },
        etag,
      );
      return updated ? slimTask(updated) : { id: taskId, status: completed ? 'completed' : 'notStarted' };
    },
  }),

  defineTool({
    name: 'planner_assign_task',
    title: 'Assign or unassign a Planner task',
    description:
      'Add or remove assignees on a Planner task. Takes Entra user object IDs; resolve display names to IDs with directory_find_person first. Existing assignees you do not mention are left alone.',
    annotations: { idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Planner task ID.' },
        addUserIds: { type: 'array', items: { type: 'string' }, description: 'Entra user object IDs to assign.' },
        removeUserIds: { type: 'array', items: { type: 'string' }, description: 'Entra user object IDs to unassign.' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const taskId = requireString(args, 'taskId');
      const add = optionalStringArray(args, 'addUserIds') ?? [];
      const remove = optionalStringArray(args, 'removeUserIds') ?? [];
      if (add.length === 0 && remove.length === 0) {
        throw new ToolArgumentError('Pass at least one user ID in addUserIds or removeUserIds.');
      }

      // Planner treats the assignments map as a delta: a null value removes an
      // assignee, and keys you omit are untouched.
      const assignments: Record<string, unknown> = buildAssignments(add);
      for (const userId of remove) assignments[userId] = null;

      const etag = await currentEtag(graph, `/planner/tasks/${taskId}`);
      const updated = await graph.patch<PlannerTask>(`/planner/tasks/${taskId}`, { assignments }, etag);
      return updated ? slimTask(updated) : { id: taskId, updated: true };
    },
  }),

  defineTool({
    name: 'planner_set_task_details',
    title: 'Set Planner task description and checklist',
    description:
      'Set the long-form description, add or update checklist items, or tick checklist items on a Planner task. Task details are a separate Graph entity from the task itself.',
    annotations: { idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Planner task ID.' },
        description: { type: 'string', description: 'Replaces the whole description. Pass an empty string to clear it.' },
        addChecklistItems: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist item titles to add.',
        },
        checkItemIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist item IDs to mark as done. Get IDs from planner_get_task.',
        },
        uncheckItemIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist item IDs to mark as not done.',
        },
        removeItemIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist item IDs to delete.',
        },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const taskId = requireString(args, 'taskId');
      const description = args.description as string | undefined;
      const additions = optionalStringArray(args, 'addChecklistItems') ?? [];
      const check = optionalStringArray(args, 'checkItemIds') ?? [];
      const uncheck = optionalStringArray(args, 'uncheckItemIds') ?? [];
      const remove = optionalStringArray(args, 'removeItemIds') ?? [];

      const checklist: Record<string, unknown> = {};
      for (const title of additions) {
        checklist[uuid()] = { '@odata.type': 'microsoft.graph.plannerChecklistItem', title, isChecked: false };
      }
      for (const id of check) {
        checklist[id] = { '@odata.type': 'microsoft.graph.plannerChecklistItem', isChecked: true };
      }
      for (const id of uncheck) {
        checklist[id] = { '@odata.type': 'microsoft.graph.plannerChecklistItem', isChecked: false };
      }
      for (const id of remove) checklist[id] = null;

      const body = compact({
        description,
        checklist: Object.keys(checklist).length ? checklist : undefined,
      });

      if (Object.keys(body).length === 0) {
        throw new ToolArgumentError('Pass a description or at least one checklist change.');
      }

      // The details entity carries its own ETag, distinct from the task's.
      const etag = await currentEtag(graph, `/planner/tasks/${taskId}/details`);
      const updated = await graph.patch<{
        description?: string;
        checklist?: Record<string, { title?: string; isChecked?: boolean } | null>;
      }>(`/planner/tasks/${taskId}/details`, body, etag);

      return {
        taskId,
        description: updated?.description,
        checklistItems: Object.entries(updated?.checklist ?? {})
          .filter(([, item]) => item !== null)
          .map(([id, item]) => ({ id, title: item?.title, isChecked: item?.isChecked ?? false })),
      };
    },
  }),

  defineTool({
    name: 'planner_delete_task',
    title: 'Delete a Planner task',
    description:
      'Permanently delete a Planner task. This cannot be undone and the task disappears for everyone on the plan. Confirm with the user before calling.',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Planner task ID.' } },
      required: ['taskId'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const taskId = requireString(args, 'taskId');
      const etag = await currentEtag(graph, `/planner/tasks/${taskId}`);
      await graph.delete(`/planner/tasks/${taskId}`, etag);
      return { id: taskId, deleted: true };
    },
  }),
];

/** Planner's assignment shape. `orderHint: ' !'` means "top of that person's list". */
function buildAssignments(userIds: string[]): Record<string, unknown> {
  return Object.fromEntries(
    userIds.map((id) => [id, { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' }]),
  );
}

export { etagOf };
