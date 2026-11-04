/**
 * failshare core: a forwarding client for the hosted
 * FailEcho MCP server.
 *
 * Nothing is stored locally. tools/list is answered
 * from the literal tool definitions below, taken verbatim
 * from a live capture of the upstream server (name, title,
 * description and inputSchema exactly as captured; the
 * capture's annotations are not reproduced). A tools/call
 * is forwarded over a streamable-HTTP JSON-RPC session:
 * an initialize POST, a notifications/initialized POST,
 * then the tools/call POST, honouring the Mcp-Session-Id
 * response header when the upstream issues one. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client. The
 * surface is a shared failure-knowledge base: one check
 * and three reports, all of them writes to the service's
 * own hosted state; this client adds no store of its own.
 *
 * The upstream endpoint is pinned to
 * https://failecho.com/mcp and can be overridden with
 * the FAILECHO_MCP_URL environment variable (that override
 * is a labelled reconstruction). When FAILECHO_REPORTER_ID
 * is set in the environment, every upstream request
 * carries an `X-Reporter-Id: <value>` header (also a
 * labelled reconstruction - the capture was taken
 * keyless); otherwise no such header is sent.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures - a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out - surface as an isError result whose text starts
 * with `failshare error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://failecho.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/failecho-tools-original.json)            */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "check_tool_failure",
    "title": "Check what the network knows about a tool failure",
    "description": "Use FailEcho when another tool fails, before retrying blindly. Call this BEFORE retrying a failed tool, API or MCP call. Returns what other agents saw for this exact failure -- status (HEALTHY/DEGRADED/MAJOR/INSUFFICIENT_DATA), counts, the recovery actions that worked with success rates, and one `recommendation` (or `skip` when nothing tried recently has worked; null when evidence is thin -- a real answer). Works on your own history before anyone else joins. Free, anonymous, stores nothing, never rate limited.",
    "inputSchema": {
      "properties": {
        "service": {
          "description": "The MCP server's own name (serverInfo.name) or the API host, e.g. 'api.github.com'. Not your client's local alias.",
          "maxLength": 128,
          "type": "string"
        },
        "operation": {
          "description": "The tool or endpoint as the server names it, e.g. 'create_issue', not 'mcp__github__create_issue'.",
          "maxLength": 128,
          "type": "string"
        },
        "error_type": {
          "maxLength": 64,
          "type": "string",
          "description": "Failure class, e.g. 'validation_error', 'timeout', 'rate_limit', 'auth_error'."
        },
        "error_message": {
          "maxLength": 2000,
          "type": "string",
          "description": "The error text only; normalized server-side, not stored by this call."
        },
        "error_code": {
          "maxLength": 32,
          "type": "string",
          "description": "Code, e.g. '422', 'ECONNRESET'."
        },
        "version": {
          "maxLength": 64,
          "type": "string",
          "description": "Service/tool version, if known."
        },
        "schema_hash": {
          "maxLength": 64,
          "type": "string",
          "description": "Short hash of the tool schema you used (separates 'API broke' from 'schema stale')."
        },
        "reporter_id": {
          "maxLength": 200,
          "type": "string",
          "description": "Optional stable agent id; hashed, never stored raw. Lets from_other_agents be answered."
        },
        "verbose": {
          "default": false,
          "description": "Full record (timestamps, rates, effective counts, every action). Default: the compact answer.",
          "type": "boolean"
        }
      },
      "required": [
        "service",
        "operation"
      ],
      "type": "object"
    }
  },
  {
    "name": "report_tool_failure",
    "title": "Report a failed tool call to the network",
    "description": "Report a failed tool/API/MCP call so others can recognise it; call after a failure, alongside check_tool_failure.\n\nPRIVACY: this is a shared network. Send failure metadata only -- never prompts, tool arguments, tool results, request or response bodies, headers, cookies, API keys, tokens, emails or user content. Error text is normalized server-side and the raw string discarded. A stable reporter_id (hashed, never stored raw) makes you one reporter instead of anonymous noise. Writes are rate limited per client.",
    "inputSchema": {
      "properties": {
        "service": {
          "description": "The MCP server's own name (serverInfo.name) or the API host, e.g. 'api.github.com'. Not your client's local alias.",
          "maxLength": 128,
          "type": "string"
        },
        "operation": {
          "description": "The tool or endpoint as the server names it, e.g. 'create_issue', not 'mcp__github__create_issue'.",
          "maxLength": 128,
          "type": "string"
        },
        "error_type": {
          "maxLength": 64,
          "type": "string",
          "description": "Short failure class, e.g. 'validation_error'."
        },
        "error_message": {
          "maxLength": 2000,
          "type": "string",
          "description": "Error text. Normalized before storage; no secrets please."
        },
        "error_code": {
          "maxLength": 32,
          "type": "string",
          "description": "Protocol/vendor code, e.g. '422'."
        },
        "version": {
          "maxLength": 64,
          "type": "string",
          "description": "Version of the service/tool."
        },
        "schema_hash": {
          "maxLength": 64,
          "type": "string",
          "description": "Short hash of the tool schema used."
        },
        "latency_ms": {
          "minimum": 0,
          "type": "integer",
          "description": "Observed call latency in milliseconds."
        },
        "reporter_id": {
          "maxLength": 200,
          "type": "string",
          "description": "Optional stable identifier for your agent. Salted and hashed on arrival; never stored raw."
        }
      },
      "required": [
        "service",
        "operation"
      ],
      "type": "object"
    }
  },
  {
    "name": "report_tool_success",
    "title": "Report a successful tool call to the network",
    "description": "Report that a call SUCCEEDED. Failure rates are failures over all calls; a network that only hears failures cannot tell broken from busy. No error data -- service, operation, version, latency.",
    "inputSchema": {
      "properties": {
        "service": {
          "description": "The MCP server's own name (serverInfo.name) or the API host, e.g. 'api.github.com'. Not your client's local alias.",
          "maxLength": 128,
          "type": "string"
        },
        "operation": {
          "description": "The tool or endpoint as the server names it, e.g. 'create_issue', not 'mcp__github__create_issue'.",
          "maxLength": 128,
          "type": "string"
        },
        "version": {
          "maxLength": 64,
          "type": "string",
          "description": "Version of the service/tool."
        },
        "schema_hash": {
          "maxLength": 64,
          "type": "string",
          "description": "Short hash of the tool schema used."
        },
        "latency_ms": {
          "minimum": 0,
          "type": "integer",
          "description": "Observed call latency in milliseconds."
        },
        "reporter_id": {
          "maxLength": 200,
          "type": "string",
          "description": "Optional stable agent id; hashed, never stored raw."
        }
      },
      "required": [
        "service",
        "operation"
      ],
      "type": "object"
    }
  },
  {
    "name": "report_recovery_outcome",
    "title": "Report whether a recovery action worked",
    "description": "After acting on a failure -- retry, wait, refresh_schema, reconnect, use_fallback, reauthenticate -- report whether it worked. Every recommendation others get is built from these. Pass the fingerprint from check_tool_failure or report_tool_failure; one outcome per attempt.",
    "inputSchema": {
      "properties": {
        "fingerprint": {
          "description": "From check_tool_failure or report_tool_failure (32 hex chars).",
          "pattern": "^[0-9a-f]{32}$",
          "type": "string"
        },
        "action": {
          "description": "What you tried, e.g. 'refresh_schema' ([a-z0-9_.-]).",
          "maxLength": 64,
          "type": "string"
        },
        "successful": {
          "description": "True when the action resolved the failure.",
          "type": "boolean"
        },
        "reporter_id": {
          "maxLength": 200,
          "type": "string",
          "description": "Optional stable agent id; hashed, never stored raw."
        }
      },
      "required": [
        "fingerprint",
        "action",
        "successful"
      ],
      "type": "object"
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `failshare error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class FailshareClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).FAILECHO_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private reporterId(): string | null {
    const raw = (this.deps.env ?? process.env).FAILECHO_REPORTER_ID;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const reporter = this.reporterId();
    if (reporter !== null) headers["X-Reporter-Id"] = reporter;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "failshare", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): FailshareClient {
  return new FailshareClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new FailshareClient(deps).callTool(name, args);
}
