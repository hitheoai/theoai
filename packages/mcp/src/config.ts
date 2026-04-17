/**
 * Project configuration loader.
 *
 * Reads an optional theo.config.ts (or .js/.json) from the project root
 * and provides defaults to the MCP server tools.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ChatMode } from "@hitheo/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  /** Custom persona prompt injected into every completion. */
  persona?: string;
  /** Skill slugs activated on every completion. */
  skills?: string[];
  /** Default execution mode. */
  defaultMode?: ChatMode;
  /** Inline tool definitions available on every completion. */
  tools?: Array<{
    name: string;
    description: string;
    input_schema?: Record<string, unknown>;
  }>;
  /** Default temperature for completions. */
  temperature?: number;
  /** Metadata attached to every request for tracking. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Attempt to load a project config from the given directory.
 *
 * By default we only load `theo.config.json` (safe: `JSON.parse`, no code
 * execution). A `theo.config.js` or `theo.config.ts` file is IGNORED unless
 * the operator explicitly sets `THEO_ALLOW_JS_CONFIG=1` in the environment.
 *
 * Rationale: the MCP server is launched by IDE agents whenever a user opens
 * a project. Auto-importing JS/TS config from the working directory turns
 * any repo with a malicious `theo.config.js` into an arbitrary-code-exec
 * vector. JSON config covers every documented use case without that risk.
 *
 * Returns null if no config file is found. Never throws — config is optional.
 */
export async function loadProjectConfig(dir: string): Promise<ProjectConfig | null> {
  // 1. JSON config (safe — JSON.parse only, no code execution)
  const jsonPath = join(dir, "theo.config.json");
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, "utf-8");
      return JSON.parse(raw) as ProjectConfig;
    } catch {
      console.error(`[theo-mcp] Warning: Failed to parse ${jsonPath}`);
    }
  }

  // 2./3. JS / TS config — disabled by default. Enabling these causes
  //       `import()` to execute arbitrary code from the current directory,
  //       which is a code-execution vector for any project the user opens.
  const jsPath = join(dir, "theo.config.js");
  const tsPath = join(dir, "theo.config.ts");
  const sawCodeConfig = existsSync(jsPath) || existsSync(tsPath);
  const allowCodeConfig = process.env.THEO_ALLOW_JS_CONFIG === "1";

  if (sawCodeConfig && !allowCodeConfig) {
    console.error(
      `[theo-mcp] Ignored ${existsSync(jsPath) ? "theo.config.js" : "theo.config.ts"}: ` +
      `JS/TS config is disabled by default. Set THEO_ALLOW_JS_CONFIG=1 to ` +
      `enable it (arbitrary code execution — only do this in trusted ` +
      `directories). Use theo.config.json for safe config.`,
    );
    return null;
  }

  if (allowCodeConfig && existsSync(jsPath)) {
    try {
      const mod = await import(jsPath);
      return (mod.default ?? mod) as ProjectConfig;
    } catch {
      console.error(`[theo-mcp] Warning: Failed to load ${jsPath}`);
    }
  }

  if (allowCodeConfig && existsSync(tsPath)) {
    try {
      const mod = await import(tsPath);
      return (mod.default ?? mod) as ProjectConfig;
    } catch {
      console.error(
        `[theo-mcp] Note: Found theo.config.ts but couldn't import it. ` +
        `Use theo.config.json or compile to theo.config.js.`,
      );
    }
  }

  return null;
}
