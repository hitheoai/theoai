#!/usr/bin/env node

/**
 * @hitheo/mcp — MCP server for the Theo AI orchestration API.
 *
 * Exposes Theo's capabilities as MCP tools for use in Cursor, Claude Code,
 * Warp, Windsurf, and any other MCP-compatible IDE agent.
 *
 * Usage (IDEs launch this automatically via config):
 *   npx @hitheo/mcp
 *
 * Environment:
 *   THEO_API_KEY — required, your theo_sk_... API key
 *   THEO_BASE_URL — optional, defaults to https://www.hitheo.ai
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Theo } from "@hitheo/sdk";
import { loadProjectConfig } from "./config.js";
import { TOOLS, handleToolCall } from "./tools.js";
import { RESOURCES, handleResourceRead } from "./resources.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const apiKey = process.env.THEO_API_KEY;
if (!apiKey) {
  console.error(
    "[theo-mcp] ERROR: THEO_API_KEY environment variable is required.\n" +
    "  Get one at https://api.hitheo.ai → API Keys.\n" +
    "  Then set it: export THEO_API_KEY=theo_sk_..."
  );
  process.exit(1);
}

// See Theo SDK 0.2.0 changelog for why we default to `www` — the apex
// domain 307-redirects and strips the `Authorization` header.
const baseUrl = process.env.THEO_BASE_URL ?? "https://www.hitheo.ai";
const client = new Theo({ apiKey, baseUrl });

// Load optional theo.config.json from the working directory. JS/TS config
// loading is disabled by default (it was an arbitrary-code-execution path);
// set THEO_ALLOW_JS_CONFIG=1 to re-enable at your own risk.
const projectConfig = await loadProjectConfig(process.cwd());

// Read our own package version so the MCP server reports the installed
// release to IDE clients (instead of a stale hardcoded string).
const serverVersion = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "theo", version: serverVersion },
  { capabilities: { tools: {}, resources: {} } },
);

// ── List tools ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// ── Call tool ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(client, projectConfig, name, args ?? {});
});

// ── List resources ──

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCES,
}));

// ── Read resource ──

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  return handleResourceRead(client, uri);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
