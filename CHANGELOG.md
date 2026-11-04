# Changelog

## 0.1.0 (2026-10-27)

- First release: a forwarding client for the hosted FailEcho MCP server, serving all 4 captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `check_tool_failure`, `report_tool_failure`, `report_tool_success`, `report_recovery_outcome`. One check against the shared failure-knowledge base and three reports into the service's own hosted state; no store is kept locally.
- Upstream results pass through verbatim; upstream failures surface as `failshare error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `FAILECHO_MCP_URL`; when `FAILECHO_REPORTER_ID` is set it is sent as an `X-Reporter-Id` header on every upstream request.
