#!/usr/bin/env node

/**
 * @hitheo/sdk CLI
 *
 * Commands:
 *   theo init                   - Set up Theo in a project (config + MCP + IDE detection)
 *   theo login                  - Authenticate and store API key
 *   theo mcp install [--ide X]  - Configure MCP for detected/specified IDEs
 *   theo status                 - Check connection and health
 *   theo complete "<prompt>"    - Quick completion from terminal
 *   theo skill init             - Scaffold a new skill project
 *   theo skill validate         - Validate a theo-skill.json manifest
 *   theo skill publish          - Submit the skill to the marketplace
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir, platform } from "os";
import { execSync } from "child_process";
import { defineSkill, Theo } from "./index.js";
import type { SkillManifestInput } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[theo] ${msg}`);
}

function error(msg: string): never {
  console.error(`[theo] ERROR: ${msg}`);
  process.exit(1);
}

function resolveApiKey(): string {
  // 1. Environment variable
  if (process.env.THEO_API_KEY) return process.env.THEO_API_KEY;

  // 2. Stored credentials file
  const credPath = join(homedir(), ".theo", "credentials");
  if (existsSync(credPath)) {
    try {
      const data = JSON.parse(readFileSync(credPath, "utf-8"));
      if (data.apiKey) return data.apiKey;
    } catch {
      // ignore
    }
  }

  return "";
}

function createClient(apiKey?: string): Theo {
  const key = apiKey || resolveApiKey();
  if (!key) {
    error(
      "No API key found. Set THEO_API_KEY or run: theo login\n" +
      "  Get a key at https://api.hitheo.ai → API Keys"
    );
  }
  const baseUrl = process.env.THEO_BASE_URL ?? "https://hitheo.ai";
  return new Theo({ apiKey: key, baseUrl });
}

// ---------------------------------------------------------------------------
// IDE Detection
// ---------------------------------------------------------------------------

interface IdeTarget {
  name: string;
  slug: string;
  detected: boolean;
  configAction: (dir: string) => void;
}

function detectIdes(projectDir: string): IdeTarget[] {
  const home = homedir();
  const targets: IdeTarget[] = [];

  // Cursor
  const cursorGlobal = join(home, ".cursor");
  const cursorDetected = existsSync(cursorGlobal) || existsSync(join(projectDir, ".cursor"));
  targets.push({
    name: "Cursor",
    slug: "cursor",
    detected: cursorDetected,
    configAction: (dir) => writeCursorConfig(dir),
  });

  // Claude Code
  let claudeDetected = false;
  try {
    execSync("which claude", { stdio: "ignore" });
    claudeDetected = true;
  } catch {
    claudeDetected = existsSync(join(home, ".claude"));
  }
  targets.push({
    name: "Claude Code",
    slug: "claude-code",
    detected: claudeDetected,
    configAction: (dir) => writeClaudeCodeConfig(dir),
  });

  // Windsurf
  const windsurfConfig = join(home, ".codeium", "windsurf");
  targets.push({
    name: "Windsurf",
    slug: "windsurf",
    detected: existsSync(windsurfConfig),
    configAction: () => writeWindsurfConfig(),
  });

  // Warp
  const warpDetected = existsSync("/Applications/Warp.app") || existsSync(join(home, ".warp"));
  targets.push({
    name: "Warp",
    slug: "warp",
    detected: warpDetected,
    configAction: (dir) => writeWarpConfig(dir),
  });

  // VS Code
  const vscodeDetected = existsSync(join(projectDir, ".vscode")) ||
    existsSync(join(home, ".vscode"));
  targets.push({
    name: "VS Code",
    slug: "vscode",
    detected: vscodeDetected,
    configAction: (dir) => writeVSCodeConfig(dir),
  });

  return targets;
}

// ---------------------------------------------------------------------------
// IDE Config Writers
// ---------------------------------------------------------------------------

const MCP_SERVER_CONFIG = {
  command: "npx",
  args: ["-y", "@hitheo/mcp"],
  env: { THEO_API_KEY: "${env:THEO_API_KEY}" },
};

function writeMcpJson(configPath: string, label: string) {
  let existing: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // overwrite if corrupt
    }
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  servers.theo = MCP_SERVER_CONFIG;
  existing.mcpServers = servers;

  const dir = join(configPath, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
  log(`  ✓ ${label}: ${configPath}`);
}

function writeCursorConfig(projectDir: string) {
  writeMcpJson(join(projectDir, ".cursor", "mcp.json"), "Cursor");
}

function writeClaudeCodeConfig(projectDir: string) {
  // Try the claude CLI first
  try {
    execSync("claude mcp add theo npx -y @hitheo/mcp", {
      stdio: "inherit",
      cwd: projectDir,
    });
    log("  ✓ Claude Code: registered via `claude mcp add`");
    return;
  } catch {
    // CLI not available — write .mcp.json
  }
  writeMcpJson(join(projectDir, ".mcp.json"), "Claude Code");
}

function writeWindsurfConfig() {
  writeMcpJson(
    join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    "Windsurf",
  );
}

function writeWarpConfig(projectDir: string) {
  writeMcpJson(join(projectDir, ".warp", "mcp.json"), "Warp");
}

function writeVSCodeConfig(projectDir: string) {
  writeMcpJson(join(projectDir, ".vscode", "mcp.json"), "VS Code");
}

// ---------------------------------------------------------------------------
// RULES.md Generator
// ---------------------------------------------------------------------------

function generateRulesFile(projectDir: string, skills: string[]) {
  const dir = join(projectDir, ".theo");
  mkdirSync(dir, { recursive: true });

  const skillLine = skills.length > 0
    ? `Available skills: ${skills.join(", ")}`
    : "No skills pre-configured. Install skills via `theo_skill_install` or at https://api.hitheo.ai.";

  const content = `# Theo AI — Available in this project

This project is configured with **Theo AI orchestration** via MCP (Model Context Protocol).
Theo automatically routes to the best engine for each task.

## Available MCP Tools

| Tool | Use for |
|------|--------|
| \`theo_complete\` | General AI completions — writing, analysis, planning, Q&A. Auto-routes to best engine. |
| \`theo_code\` | Code generation — Theo Code engine (long-form output). |
| \`theo_research\` | Deep research with web search, citations, and structured reports. |
| \`theo_image\` | Image generation — Theo Create engine. |
| \`theo_document\` | Document generation (PDF, DOCX, PPTX, XLSX, CSV). |
| \`theo_skill_list\` | Browse available skills (domain knowledge packages). |
| \`theo_skill_install\` | Install a skill from the marketplace. |
| \`theo_status\` | Check Theo health and engine availability. |

## Skills
${skillLine}

## Configuration
Edit \`theo.config.json\` (or \`theo.config.ts\`) at the project root to customize:
- \`persona\` — Custom system prompt for all completions
- \`skills\` — Default skills activated on every request
- \`defaultMode\` — Default mode (auto, fast, think, code, research)
- \`tools\` — Inline tool definitions for project-specific actions

## Docs
- API reference: https://docs.hitheo.ai
- SDK: https://www.npmjs.com/package/@hitheo/sdk
- MCP server: https://www.npmjs.com/package/@hitheo/mcp
`;

  writeFileSync(join(dir, "RULES.md"), content);
  log(`  ✓ Created .theo/RULES.md`);
}

// ---------------------------------------------------------------------------
// Commands: Init
// ---------------------------------------------------------------------------

async function cmdInit(dir: string) {
  log("Initializing Theo in this project...\n");

  // 1. Check for API key
  const apiKey = resolveApiKey();
  if (!apiKey) {
    log("No API key found.");
    log("Set THEO_API_KEY environment variable or run: theo login");
    log("Get a key at https://api.hitheo.ai → API Keys\n");
    log("Continuing setup without API key (you can set it later)...\n");
  }

  // 2. Create theo.config.json
  const configPath = join(dir, "theo.config.json");
  if (!existsSync(configPath)) {
    const projectName = basename(dir);
    const config = {
      persona: `You are an AI assistant for the ${projectName} project.`,
      skills: [] as string[],
      defaultMode: "auto",
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    log(`  ✓ Created theo.config.json`);
  } else {
    log(`  ✓ theo.config.json already exists`);
  }

  // 3. Detect IDEs and write MCP configs
  log("\nDetecting IDEs...");
  const ides = detectIdes(dir);
  const detectedIdes = ides.filter((ide) => ide.detected);

  if (detectedIdes.length === 0) {
    log("  No IDEs detected. Run `theo mcp install --ide <name>` manually.");
  } else {
    log(`  Found: ${detectedIdes.map((i) => i.name).join(", ")}\n`);
    log("Writing MCP configurations...");
    for (const ide of detectedIdes) {
      ide.configAction(dir);
    }
  }

  // 4. Generate .theo/RULES.md
  log("\nGenerating agent context...");
  let skills: string[] = [];
  try {
    const raw = readFileSync(join(dir, "theo.config.json"), "utf-8");
    const cfg = JSON.parse(raw);
    skills = cfg.skills ?? [];
  } catch {
    // ignore
  }
  generateRulesFile(dir, skills);

  // 5. Summary
  log("\n✅ Theo initialized!\n");
  if (!apiKey) {
    log("Next steps:");
    log("  1. Set your API key: export THEO_API_KEY=theo_sk_...");
    log("  2. Restart your IDE");
    log("  3. Ask your agent: \"Use Theo to generate a REST API\"\n");
  } else {
    log("Next steps:");
    log("  1. Restart your IDE to load MCP config");
    log("  2. Ask your agent: \"Use Theo to generate a REST API\"\n");
  }
  log("Edit theo.config.json to customize persona, skills, and default mode.");
  log("Docs: https://docs.hitheo.ai");
}

// ---------------------------------------------------------------------------
// Commands: Login
// ---------------------------------------------------------------------------

async function cmdLogin() {
  log("Theo Login\n");

  const existing = resolveApiKey();
  if (existing) {
    log(`Already authenticated (key starts with ${existing.slice(0, 12)}...)`);
    log("To use a different key, set THEO_API_KEY or edit ~/.theo/credentials\n");
    return;
  }

  log("To authenticate, get an API key from the Theo dashboard:\n");
  log("  1. Go to https://api.hitheo.ai");
  log("  2. Sign in or create an account");
  log("  3. Go to API Keys → Create Key");
  log("  4. Copy your theo_sk_... key\n");

  // Try to open browser
  try {
    const openCmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
    execSync(`${openCmd} https://api.hitheo.ai`, { stdio: "ignore" });
    log("Opening dashboard in your browser...\n");
  } catch {
    // Can't open browser, that's fine
  }

  log("Once you have your key, set it:");
  log("  export THEO_API_KEY=theo_sk_...\n");
  log("Or store it permanently:");
  log("  mkdir -p ~/.theo");
  log('  echo \'{"apiKey":"theo_sk_..."}\'  > ~/.theo/credentials');
  log("  chmod 600 ~/.theo/credentials");
}

// ---------------------------------------------------------------------------
// Commands: MCP Install
// ---------------------------------------------------------------------------

async function cmdMcpInstall(dir: string, ideFlag?: string) {
  log("Configuring Theo MCP server...\n");

  const ides = detectIdes(dir);

  if (ideFlag && ideFlag !== "all") {
    const target = ides.find((i) => i.slug === ideFlag);
    if (!target) {
      error(
        `Unknown IDE: ${ideFlag}\n` +
        `Available: ${ides.map((i) => i.slug).join(", ")}, all`
      );
    }
    target.configAction(dir);
  } else if (ideFlag === "all") {
    for (const ide of ides) {
      ide.configAction(dir);
    }
  } else {
    const detected = ides.filter((i) => i.detected);
    if (detected.length === 0) {
      log("No IDEs detected. Specify one with --ide:");
      log(`  theo mcp install --ide ${ides.map((i) => i.slug).join("|")}`);  
      return;
    }

    log(`Detected: ${detected.map((i) => i.name).join(", ")}\n`);
    for (const ide of detected) {
      ide.configAction(dir);
    }
  }

  log("\n✓ MCP configured. Restart your IDE to connect.");
  log("Make sure THEO_API_KEY is set in your environment.");
}

// ---------------------------------------------------------------------------
// Commands: Status
// ---------------------------------------------------------------------------

async function cmdStatus() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    log("❌ No API key found. Run: theo login");
    return;
  }

  log(`API key: ${apiKey.slice(0, 12)}...`);
  log(`Base URL: ${process.env.THEO_BASE_URL ?? "https://hitheo.ai"}\n`);

  const client = createClient(apiKey);

  try {
    const health = await client.health();
    log(`Status: ${health.status}`);
    log(`Version: ${health.version}\n`);

    log("Theo engines:");
    for (const [name, info] of Object.entries(health.providers)) {
      log(`  ${name}: ${info.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Connection failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Commands: Complete
// ---------------------------------------------------------------------------

async function cmdComplete(prompt: string) {
  const client = createClient();

  try {
    const res = await client.complete({ prompt, mode: "auto" });
    console.log(res.content);
    console.log(
      `\n---\nModel: ${res.model.label} | Mode: ${res.resolved_mode} | Cost: ${res.usage.cost_cents}¢`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg);
  }
}

// ---------------------------------------------------------------------------
// Commands: Skill (preserved from original)
// ---------------------------------------------------------------------------

function loadManifest(dir: string): SkillManifestInput {
  const manifestPath = join(dir, "theo-skill.json");
  if (!existsSync(manifestPath)) {
    error(`No theo-skill.json found in ${dir}. Run "theo skill init" first.`);
  }
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as SkillManifestInput;
  } catch (err) {
    error(`Failed to parse theo-skill.json: ${(err as Error).message}`);
  }
}

async function skillInit(dir: string) {
  const manifestPath = join(dir, "theo-skill.json");
  if (existsSync(manifestPath)) {
    error("theo-skill.json already exists in this directory.");
  }

  const template: SkillManifestInput = {
    name: "My Skill",
    slug: "my-skill",
    version: "1.0.0",
    description: "A brief description of what this skill does.",
    category: "productivity",
    author: { name: "Your Name" },
    systemPromptExtension: "You are a specialist in...",
    tools: [],
    permissions: [],
    knowledge: [],
    license: "MIT",
    keywords: [],
  };

  writeFileSync(manifestPath, JSON.stringify(template, null, 2) + "\n");

  const readmePath = join(dir, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# ${template.name}\n\n${template.description}\n\n## Usage\n\nInstall this skill from the Theo Skill Store.\n`,
    );
  }

  log(`Created theo-skill.json and README.md in ${dir}`);
  log("Edit the manifest, then run: theo skill validate");
}

async function skillValidate(dir: string) {
  const input = loadManifest(dir);

  try {
    const manifest = defineSkill(input);
    log(`✓ Manifest is valid: "${manifest.name}" v${manifest.version}`);
    log(`  Category: ${manifest.category}`);
    log(`  Tools: ${manifest.tools.length}`);
    log(`  Permissions: ${manifest.permissions.length > 0 ? manifest.permissions.join(", ") : "none"}`);

    const hasTools = manifest.tools.length > 0;
    const hasExternal = manifest.permissions.includes("external:http");
    const hasWrites = manifest.permissions.some((p) => p.startsWith("write:"));
    const hasKnowledge = manifest.knowledge.length > 0;

    let tier = "auto (will be auto-approved)";
    if (hasExternal && (hasWrites || hasTools)) {
      tier = "security (requires security team review)";
    } else if (hasTools || hasKnowledge || hasWrites) {
      tier = "staff (requires staff review)";
    }
    log(`  Review tier: ${tier}`);
  } catch (err) {
    error((err as Error).message);
  }
}

async function skillPublish(dir: string) {
  const input = loadManifest(dir);

  const readmePath = join(dir, "README.md");
  if (existsSync(readmePath) && !input.readme) {
    input.readme = readFileSync(readmePath, "utf-8");
  }

  let manifest;
  try {
    manifest = defineSkill(input);
  } catch (err) {
    error(`Validation failed: ${(err as Error).message}`);
  }

  const client = createClient();

  log(`Submitting "${manifest.name}" v${manifest.version}...`);

  try {
    const result = await client.submitSkill(manifest) as Record<string, unknown>;
    const status = result.status as string;
    const autoApproved = result.autoApproved as boolean;

    if (autoApproved) {
      log("✓ Skill auto-approved and published!");
    } else if (status === "pending_review") {
      log("✓ Submitted for review. You'll be notified when approved.");
      log(`  Review tier: ${result.reviewTier}`);
    } else {
      log(`Submission status: ${status}`);
    }
  } catch (err) {
    error(`Publish failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// CLI Router
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  switch (command) {
    case "init":
      return cmdInit(resolve(args[1] ?? "."));

    case "login":
      return cmdLogin();

    case "mcp": {
      if (subcommand === "install") {
        const ideIdx = args.indexOf("--ide");
        const ideFlag = ideIdx >= 0 ? args[ideIdx + 1] : undefined;
        return cmdMcpInstall(resolve("."), ideFlag);
      }
      log("Usage: theo mcp install [--ide cursor|claude-code|windsurf|warp|vscode|all]");
      process.exit(1);
      break;
    }

    case "status":
      return cmdStatus();

    case "complete": {
      const prompt = args.slice(1).join(" ");
      if (!prompt) {
        error('Usage: theo complete "your prompt here"');
      }
      return cmdComplete(prompt);
    }

    case "skill": {
      const dir = resolve(args[2] ?? ".");
      switch (subcommand) {
        case "init":
          return skillInit(dir);
        case "validate":
          return skillValidate(dir);
        case "publish":
          return skillPublish(dir);
        default:
          log("Usage: theo skill <init|validate|publish> [directory]");
          process.exit(1);
      }
      break;
    }

    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;

    default:
      log(`Unknown command: ${command}\n`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
  theo — Theo AI CLI

  Setup:
    theo init              Initialize Theo in a project (config + MCP + IDE detection)
    theo login             Authenticate and store API key
    theo mcp install       Configure MCP for detected IDEs
    theo status            Check connection and health

  Usage:
    theo complete "<p>"    Quick AI completion from terminal

  Skills:
    theo skill init        Scaffold a new skill project
    theo skill validate    Validate a theo-skill.json manifest
    theo skill publish     Submit skill to marketplace

  Options:
    theo mcp install --ide cursor|claude-code|windsurf|warp|vscode|all

  Docs: https://docs.hitheo.ai
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
