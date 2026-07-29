import { ToolDefinition } from '../types';
import { directoryTools } from './directory';
import { plannerTools } from './planner';
import { todoTools } from './todo';

export const allTools: ToolDefinition[] = [...directoryTools, ...plannerTools, ...todoTools];

export const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));

/** Shape sent over the wire in `tools/list`; the handler stays server-side. */
export function toolManifest() {
  return allTools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations,
  }));
}
