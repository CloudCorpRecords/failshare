/**
 * failshare types.
 *
 * failshare keeps no fleet data of its own. It is a
 * forwarding client: the captured tool surface lives here
 * as data (ToolDef entries served verbatim for tools/list)
 * and every tools/call travels to the hosted FailEcho MCP
 * endpoint through an injectable fetch, so the test suite
 * never touches the live network.
 */

/** One captured tool definition, served verbatim for tools/list. */
export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

/** A tool's arguments, as decoded JSON. */
export type ToolArgs = Record<string, unknown>;

/** A tools/call result: upstream results pass through verbatim; failures use this shape. */
export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the forwarding client, all injectable in tests. */
export interface ForwardDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Environment (FAILECHO_MCP_URL, FAILECHO_REPORTER_ID). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Endpoint URL override. Defaults to env FAILECHO_MCP_URL or the pinned default. */
  url?: string;
  /** Per-request timeout in ms. Defaults to 30000. */
  timeoutMs?: number;
}
