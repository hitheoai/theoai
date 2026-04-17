/**
 * MCP tool definitions and handlers for the Theo MCP server.
 *
 * Each tool maps to a Theo SDK method. The MCP server calls these when
 * an IDE agent invokes a tool.
 */

import type { Theo, CompletionRequest, ChatMode } from "@hitheo/sdk";
import type { ProjectConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Tool definitions (sent to IDE agents via ListTools)
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: "theo_complete",
    description:
      "Run an AI completion through Theo's orchestration engine. " +
      "Theo automatically classifies intent, selects the best engine " +
      "across 300+ AI models, injects domain skills, executes tools, " +
      "and returns the response. " +
      "Use this for any general AI task: writing, analysis, planning, Q&A.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "The prompt or question to send to Theo.",
        },
        mode: {
          type: "string",
          enum: ["auto", "fast", "think", "code", "research", "roast"],
          description:
            "Execution mode. 'auto' lets Theo classify. 'fast' uses a lightweight model. " +
            "'think' uses deep reasoning. 'code' optimizes for code. Default: auto.",
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "Skill slugs to activate (e.g. ['deep-research', 'content-writer']).",
        },
        conversation_id: {
          type: "string",
          description: "Continue an existing conversation by ID.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "theo_code",
    description:
      "Generate code using Theo. Routes to the Theo Code engine for best-in-class " +
      "code generation with an extended output budget. Returns generated code and " +
      "any artifacts (full files, project scaffolds). Use this when the task is " +
      "primarily about writing, generating, or scaffolding code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Describe the code you want generated.",
        },
        language: {
          type: "string",
          description: "Target programming language (e.g. 'typescript', 'python', 'go').",
        },
        framework: {
          type: "string",
          description: "Target framework (e.g. 'nextjs', 'express', 'fastapi', 'react').",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "theo_research",
    description:
      "Run deep research on a topic. Theo searches the web, synthesizes " +
      "multiple sources, and returns a structured report with citations. " +
      "This is an async operation — Theo returns results when complete. " +
      "Use for market research, technical deep-dives, competitive analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "The research question or topic.",
        },
        depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "Research depth. 'basic' is faster, 'advanced' is more thorough. Default: basic.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "theo_image",
    description:
      "Generate images using Theo. Routes to the Theo Create engine " +
      "with automatic fallback. Returns image URLs. Use for logos, illustrations, " +
      "mockups, concept art, or any visual content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Describe the image to generate.",
        },
        style: {
          type: "string",
          description: "Visual style (e.g. 'photorealistic', 'illustration', '3d', 'pixel').",
        },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
          description: "Aspect ratio. Default: 1:1.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "theo_document",
    description:
      "Generate a formatted document (PDF, DOCX, PPTX, XLSX, CSV). " +
      "Theo creates the document and returns a download URL. " +
      "Use for reports, presentations, spreadsheets, and data exports.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Describe the document to generate.",
        },
        format: {
          type: "string",
          enum: ["pdf", "docx", "pptx", "xlsx", "csv"],
          description: "Output format. Default: pdf.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "theo_skill_list",
    description:
      "List available Theo skills. Skills are packages of domain knowledge " +
      "and tools that extend Theo's capabilities (like apps for AI). " +
      "Filter by 'installed' or 'marketplace' to see what's active or available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          enum: ["installed", "marketplace"],
          description: "Filter to installed skills or marketplace catalog.",
        },
      },
    },
  },
  {
    name: "theo_skill_install",
    description:
      "Install a skill from the Theo marketplace. Once installed, the skill's " +
      "domain knowledge and tools are available on every completion.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          description: "The skill ID to install.",
        },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "theo_status",
    description:
      "Check Theo's health and engine availability. Returns engine status, " +
      "latency, and infrastructure health. Use to verify the connection works " +
      "or diagnose issues.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleToolCall(
  client: Theo,
  config: ProjectConfig | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    switch (toolName) {
      case "theo_complete":
        return await handleComplete(client, config, args);
      case "theo_code":
        return await handleCode(client, config, args);
      case "theo_research":
        return await handleResearch(client, args);
      case "theo_image":
        return await handleImage(client, args);
      case "theo_document":
        return await handleDocument(client, args);
      case "theo_skill_list":
        return await handleSkillList(client, args);
      case "theo_skill_install":
        return await handleSkillInstall(client, args);
      case "theo_status":
        return await handleStatus(client);
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }] };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Theo error: ${message}` }] };
  }
}

// ---------------------------------------------------------------------------
// Individual handlers
// ---------------------------------------------------------------------------

async function handleComplete(
  client: Theo,
  config: ProjectConfig | null,
  args: Record<string, unknown>,
) {
  const request: CompletionRequest = {
    prompt: args.prompt as string,
    mode: (args.mode as ChatMode) ?? config?.defaultMode ?? "auto",
    skills: mergeSkills(config?.skills, args.skills as string[] | undefined),
    conversation_id: args.conversation_id as string | undefined,
  };

  // Inject project persona if configured
  if (config?.persona) {
    request.persona = { system_prompt: config.persona };
  }

  // Inject project tools if configured
  if (config?.tools && config.tools.length > 0) {
    request.tools = config.tools;
  }

  const res = await client.complete(request);

  const parts: string[] = [res.content];

  if (res.tools_used.length > 0) {
    parts.push(
      "\n\n---\nTools used: " +
      res.tools_used.map((t: { name: string; status: string }) => `${t.name} (${t.status})`).join(", "),
    );
  }

  parts.push(`\nModel: ${res.model.label} | Mode: ${res.resolved_mode} | Cost: ${res.usage.cost_cents}¢`);

  return { content: [{ type: "text" as const, text: parts.join("") }] };
}

async function handleCode(
  client: Theo,
  config: ProjectConfig | null,
  args: Record<string, unknown>,
) {
  const request: Record<string, unknown> = {
    prompt: args.prompt as string,
  };
  if (args.language) request.language = args.language;
  if (args.framework) request.framework = args.framework;

  const res = await client.code(request as unknown as Parameters<typeof client.code>[0]);

  const parts: string[] = [res.content];

  if (res.artifacts && (res.artifacts as unknown[]).length > 0) {
    parts.push(`\n\n---\nArtifacts: ${JSON.stringify(res.artifacts, null, 2)}`);
  }

  parts.push(`\nCost: ${res.usage.cost_cents}¢`);

  return { content: [{ type: "text" as const, text: parts.join("") }] };
}

async function handleResearch(client: Theo, args: Record<string, unknown>) {
  const job = await client.research({
    prompt: args.prompt as string,
    depth: (args.depth as "basic" | "advanced") ?? "basic",
  });

  // Poll until complete
  const result = await client.waitForJob(job.job_id, 3000, 120_000);

  if (result.status === "failed") {
    return { content: [{ type: "text" as const, text: `Research failed: ${result.error ?? "unknown error"}` }] };
  }

  const text = typeof result.result === "string"
    ? result.result
    : JSON.stringify(result.result, null, 2);

  return { content: [{ type: "text" as const, text }] };
}

async function handleImage(client: Theo, args: Record<string, unknown>) {
  const res = await client.images({
    prompt: args.prompt as string,
    style: args.style as string | undefined,
    aspect_ratio: args.aspect_ratio as string | undefined,
  });

  const urls = res.images
    .map((img: { url: string | null; engine: string }, i: number) => `Image ${i + 1}: ${img.url ?? "(pending)"} [${img.engine}]`)
    .join("\n");

  return {
    content: [{
      type: "text" as const,
      text: `${urls}\n\nCost: ${res.usage.cost_cents}¢`,
    }],
  };
}

async function handleDocument(client: Theo, args: Record<string, unknown>) {
  const res = await client.documents({
    prompt: args.prompt as string,
    format: (args.format as "pdf" | "docx" | "pptx" | "xlsx" | "csv") ?? "pdf",
  });

  const parts: string[] = [
    `Document: ${res.title}`,
    `Format: ${res.format}`,
  ];

  if (res.download_url) {
    parts.push(`Download: ${res.download_url}`);
  }

  if (res.content) {
    parts.push(`\n${res.content}`);
  }

  parts.push(`\nCost: ${res.usage.cost_cents}¢`);

  return { content: [{ type: "text" as const, text: parts.join("\n") }] };
}

async function handleSkillList(client: Theo, args: Record<string, unknown>) {
  const filter = args.filter as "installed" | "marketplace" | undefined;
  const skills = await client.skills(filter);
  return {
    content: [{
      type: "text" as const,
      text: skills.length > 0
        ? JSON.stringify(skills, null, 2)
        : `No skills found${filter ? ` (filter: ${filter})` : ""}.`,
    }],
  };
}

async function handleSkillInstall(client: Theo, args: Record<string, unknown>) {
  await client.installSkill(args.skill_id as string);
  return {
    content: [{
      type: "text" as const,
      text: `Skill ${args.skill_id} installed successfully.`,
    }],
  };
}

async function handleStatus(client: Theo) {
  const health = await client.health();

  const engineLines = Object.entries(health.providers)
    .map(([name, info]: [string, { status: string }]) => `  ${name}: ${info.status}`)
    .join("\n");

  const text = [
    `Status: ${health.status}`,
    `Version: ${health.version}`,
    `Engines:\n${engineLines}`,
  ].join("\n");

  return { content: [{ type: "text" as const, text }] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeSkills(
  configSkills: string[] | undefined,
  requestSkills: string[] | undefined,
): string[] | undefined {
  const merged = [...(configSkills ?? []), ...(requestSkills ?? [])];
  return merged.length > 0 ? merged : undefined;
}
