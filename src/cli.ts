#!/usr/bin/env node
/**
 * failshare CLI.
 *
 *   failshare <tool> '<json-args>'
 *   failshare mcp
 *   failshare --version
 *
 * <tool> is any of the 4 forwarded tools. Each tool
 * subcommand takes one JSON argument string with the
 * tool's arguments (omit it for tools that take none),
 * forwards the call like the MCP path, and prints the
 * forwarded result content. Exit codes: 0 success, 1
 * on an isError result, 2 usage error.
 */
import { callTool, TOOL_NAMES, VERSION } from "./forward.js";
import type { ToolResult } from "./types.js";

function usage(): never {
  console.error(`Usage:
  failshare <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  failshare mcp
  failshare --version`);
  process.exit(2);
}

function firstText(result: ToolResult): string {
  const content = result.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (
        item !== null &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string"
      ) {
        return (item as { text: string }).text;
      }
    }
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
    return;
  }
  if (!TOOL_NAMES.includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        usage();
      }
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  const result = await callTool(cmd, args);
  if (result.isError) {
    console.error(`error: ${firstText(result)}`);
    process.exit(1);
  }
  console.log(
    typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content, null, 2),
  );
}

void main();
