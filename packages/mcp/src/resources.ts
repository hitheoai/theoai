/**
 * MCP resource definitions for the Theo MCP server.
 *
 * Resources provide read-only data that IDE agents can pull
 * for context without executing a tool.
 */

import type { Theo } from "@hitheo/sdk";

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------

export const RESOURCES = [
  {
    uri: "theo://models",
    name: "Theo Models",
    description:
      "Available AI models and their routing configuration. " +
      "Shows which model handles each task type (code, research, image, etc.).",
    mimeType: "application/json",
  },
  {
    uri: "theo://skills/installed",
    name: "Installed Skills",
    description:
      "Skills currently installed for this API key. " +
      "Skills add domain knowledge and tools to Theo's completions.",
    mimeType: "application/json",
  },
  {
    uri: "theo://health",
    name: "Theo Health",
    description:
      "Live system health — provider availability, latency, " +
      "infrastructure status, and API version.",
    mimeType: "application/json",
  },
];

// ---------------------------------------------------------------------------
// Resource handler
// ---------------------------------------------------------------------------

export async function handleResourceRead(
  client: Theo,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    switch (uri) {
      case "theo://models": {
        const models = await client.models();
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(models, null, 2),
          }],
        };
      }

      case "theo://skills/installed": {
        const skills = await client.skills("installed");
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(skills, null, 2),
          }],
        };
      }

      case "theo://health": {
        const health = await client.health();
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(health, null, 2),
          }],
        };
      }

      default:
        return {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: `Unknown resource: ${uri}`,
          }],
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: `Error reading ${uri}: ${message}`,
      }],
    };
  }
}
