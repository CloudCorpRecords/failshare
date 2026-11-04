# failshare

failshare is a small local bridge to FailEcho's hosted
MCP server, a shared failure-knowledge base for agents.
When a tool, API or MCP call fails, agents check what
the network already knows about that exact failure
before retrying blindly, and they report their own
failures, successes and recovery outcomes so the next
agent gets a better answer.

The bridge keeps no failure data and computes nothing
of its own. It serves the upstream server's tool list
locally, exactly as captured from the live endpoint,
and forwards each tool call upstream, returning the
result untouched.

## Tools

- `check_tool_failure` - ask what the network knows
  about a failure before retrying. Returns a status
  (HEALTHY / DEGRADED / MAJOR / INSUFFICIENT_DATA),
  counts, the recovery actions that worked with their
  success rates, and one recommendation. Required:
  `service` (the server's own name or API host) and
  `operation` (the tool or endpoint as the server
  names it). Optional context: `error_type`,
  `error_message`, `error_code`, `version`,
  `schema_hash`, `reporter_id`, and `verbose` for the
  full record instead of the compact answer.
- `report_tool_failure` - report a failed call so
  others can recognise it. Required: `service`,
  `operation`. Optional: `error_type`, `error_message`,
  `error_code`, `version`, `schema_hash`, `latency_ms`
  and `reporter_id`. Send failure metadata only -
  never prompts, arguments, results, headers or keys;
  error text is normalised server-side.
- `report_tool_success` - report that a call
  succeeded. Failure rates need the denominator: a
  network that only hears failures cannot tell broken
  from busy. Required: `service`, `operation`.
  Optional: `version`, `schema_hash`, `latency_ms`,
  `reporter_id`.
- `report_recovery_outcome` - after acting on a
  failure (retry, wait, refresh_schema, reconnect,
  use_fallback, reauthenticate), report whether it
  worked; every recommendation is built from these.
  Required: `fingerprint` (from `check_tool_failure`
  or `report_tool_failure`), `action`, and
  `successful`. Optional: `reporter_id`.

## Configuration

- `FAILECHO_MCP_URL` (optional) - override the upstream
  endpoint. Defaults to `https://failecho.com/mcp`.
  (The override hook is this rebuild's own labelled
  reconstruction.)
- `FAILECHO_REPORTER_ID` (optional) - when set, every
  upstream request carries an
  `X-Reporter-Id: <value>` header carrying the value.
  When it is not set, no such header is sent. (This
  forwarding is also a labelled reconstruction; the
  original surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC `initialize`
request (protocolVersion `2025-03-26`, clientInfo name
`failshare`), then a `notifications/initialized`
notification, then the `tools/call` request carrying
the caller's arguments unchanged. When the upstream
answers `initialize` with an `Mcp-Session-Id` header,
that value rides on every later request of the session,
which is reused for the life of the process. Replies
may arrive as plain JSON or as server-sent events;
both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures - a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed - come back as an `isError` result whose
text starts with `failshare error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON argument
string:

```bash
npx @reneturcios/failshare check_tool_failure '{"service":"api.github.com","operation":"create_issue","error_type":"timeout"}'
npx @reneturcios/failshare report_tool_failure '{"service":"api.github.com","operation":"create_issue","error_type":"validation_error"}'
npx @reneturcios/failshare report_tool_success '{"service":"api.github.com","operation":"create_issue","latency_ms":42}'
npx @reneturcios/failshare report_recovery_outcome '{"fingerprint":"0123456789abcdef0123456789abcdef","action":"refresh_schema","successful":true}'
npx @reneturcios/failshare --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/failshare mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "failshare": {
      "command": "npx",
      "args": ["-y", "@reneturcios/failshare", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/failshare
docker run --rm ghcr.io/cloudcorprecords/failshare --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream - no live network calls.

## License

MIT - see `LICENSE`.
