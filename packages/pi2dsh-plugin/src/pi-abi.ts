/**
 * Minimal Pi Extension ABI surface used by this plugin.
 * Avoids a hard dependency on @earendil-works/pi-coding-agent for offline builds;
 * at runtime pi2dsh supplies the real ExtensionAPI.
 */

export type PiTextContent = { type: 'text'; text: string };

export type PiToolResult<TDetails = unknown> = {
  content: PiTextContent[];
  details?: TDetails;
};

export type PiToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  promptSnippet?: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<PiToolResult>;
};

export type PiSessionBeforeCompactEvent = {
  type: 'session_before_compact';
  reason: 'manual' | 'threshold' | 'overflow';
  preparation?: {
    tokensBefore?: number;
    tokenCount?: number;
    estimatedTokens?: number;
    pressureFloor?: number;
    threshold?: number;
  };
  customInstructions?: string;
};

export type PiSessionBeforeCompactResult = {
  cancel?: boolean;
  /** Host-specific; Pi may accept customInstructions via compaction payload. */
  compaction?: unknown;
  customInstructions?: string;
};

export type PiExtensionAPI = {
  registerTool: (tool: PiToolDefinition) => void;
  on: (
    event: string,
    handler: (event: unknown, ctx?: unknown) => unknown | Promise<unknown>,
  ) => void;
};

export function toolTextResult(value: unknown, details?: unknown): PiToolResult {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text }],
    details: details ?? (typeof value === 'object' ? value : { value }),
  };
}

export function toolErrorResult(err: unknown): PiToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    details: { ok: false, error: message },
  };
}
