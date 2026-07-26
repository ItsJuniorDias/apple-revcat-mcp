import type { z } from "zod";
import type { ToolResult } from "../index.js";

/**
 * Formats a value as a text ToolResult. Objects are JSON.stringify'd, strings
 * are passed through. The MCP spec only supports text content blocks for
 * tool responses, so structured data is always serialized.
 */
export function textResult(value: unknown): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wraps a handler with Zod validation. If args fail the schema, we return a
 * structured error to the model (not a thrown exception) so it can retry with
 * corrected args instead of the caller seeing a stack trace.
 */
export function validated<T extends z.ZodTypeAny>(
  schema: T,
  handler: (args: z.infer<T>) => Promise<ToolResult>
): (args: Record<string, unknown>) => Promise<ToolResult> {
  return async (args) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return errorResult(`Invalid arguments: ${issues}`);
    }
    return handler(parsed.data);
  };
}
