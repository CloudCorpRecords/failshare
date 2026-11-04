/**
 * failshare MCP server. Tools: the 4 captured FailEcho
 * tools (see forward.ts).
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema
 * and rewrites the served schemas, which breaks exact
 * tool-list/schema parity with the live capture. This
 * file serves tools/list locally from the core's explicit
 * literals — the verbatim tool objects from the upstream
 * server's live tools/list — and forwards every
 * tools/call upstream.
 *
 * A forwarded result is returned unchanged (including any
 * upstream isError flag and extra result fields). An
 * upstream failure comes back as an isError result
 * carrying a `failshare error:` text, synthesised by the
 * forwarding client. An unknown tool name is rejected
 * with McpError MethodNotFound, and arguments that are
 * not a JSON object with McpError InvalidParams, before
 * any network hop.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createClient,
  isKnownTool,
  TOOL_DEFS,
  VERSION,
  type FailshareClient,
} from "./forward.js";
import type { ForwardDeps, ToolResult } from "./types.js";

/**
 * Validate and forward one tools/call through `client`.
 * Exported so the forwarding behaviour can be tested
 * directly without a stdio transport.
 */
export async function handleCallTool(
  client: FailshareClient,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  if (!isKnownTool(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  if (
    args !== undefined &&
    (typeof args !== "object" || args === null || Array.isArray(args))
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Arguments for tool ${name} must be a JSON object`,
    );
  }
  return client.callTool(name, (args ?? {}) as Record<string, unknown>);
}

/** Build the stdio MCP server (transport not yet connected). */
export function createServer(deps: ForwardDeps = {}): Server {
  const client = createClient(deps);
  const server = new Server(
    { name: "failshare", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleCallTool(client, name, args);
    return result as never;
  });

  return server;
}

/** Connect the MCP server over stdio. */
export async function startMcpServer(deps: ForwardDeps = {}): Promise<void> {
  await createServer(deps).connect(new StdioServerTransport());
}
