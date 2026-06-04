import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MacOSError } from "./errors.ts";

export interface NextAction {
  tool: string;
  description: string;
}

export const readOnlyAnnotations = {
  readOnlyHint: true as const,
  destructiveHint: false as const,
  idempotentHint: true as const,
  openWorldHint: false as const,
};

/**
 * Annotations for a write/command tool with an external side effect (e.g.
 * sending a message). Not read-only, not idempotent (each call acts again), and
 * open-world since it reaches beyond this Mac. `destructiveHint` stays false —
 * it creates rather than deletes local data — but such actions are typically
 * irreversible, so say so in the tool description.
 */
export const writeAnnotations = {
  readOnlyHint: false as const,
  destructiveHint: false as const,
  idempotentHint: false as const,
  openWorldHint: true as const,
};

export function toolError(e: MacOSError) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: e.name,
          message: e.message,
          category: e.category,
          retryable: e.retryable,
          recovery: e.recovery,
        }),
      },
    ],
  };
}

export function wrapTool<T>(fn: () => T, hints?: NextAction[]) {
  try {
    const data = fn();
    const result: Record<string, unknown> = { data };
    if (Array.isArray(data)) result.totalResults = data.length;
    if (hints?.length) result._next = hints;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  } catch (e) {
    if (e instanceof MacOSError) return toolError(e);
    throw e;
  }
}

export type McpServerInstance = InstanceType<typeof McpServer>;
