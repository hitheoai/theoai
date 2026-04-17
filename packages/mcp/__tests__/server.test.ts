import { describe, it, expect, vi, beforeEach } from "vitest";
import { TOOLS, handleToolCall } from "../src/tools.js";
import { RESOURCES, handleResourceRead } from "../src/resources.js";
import { loadProjectConfig } from "../src/config.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Mock Theo client — all methods return predictable data, no real API calls
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    complete: vi.fn().mockResolvedValue({
      content: "Mock completion",
      mode: "auto",
      resolved_mode: "auto",
      model: { id: "theo-1-flash", label: "Theo Flash", provider: "theo-core" },
      tools_used: [],
      artifacts: [],
      follow_ups: [],
      usage: { cost_cents: 1 },
    }),
    code: vi.fn().mockResolvedValue({
      content: "console.log('hello');",
      artifacts: [],
      tools_used: [],
      usage: { cost_cents: 2 },
    }),
    research: vi.fn().mockResolvedValue({
      id: "r1",
      job_id: "job_r1",
      status: "queued",
      created: new Date().toISOString(),
      poll_url: "/api/v1/jobs/job_r1",
    }),
    waitForJob: vi.fn().mockResolvedValue({
      id: "job_r1",
      type: "research",
      status: "completed",
      progress: 100,
      result: "Research report content",
      error: null,
      created_at: null,
      completed_at: new Date().toISOString(),
    }),
    images: vi.fn().mockResolvedValue({
      images: [{ url: "https://example.com/img.png", engine: "theo-vision", prompt: "test" }],
      usage: { cost_cents: 5 },
    }),
    documents: vi.fn().mockResolvedValue({
      title: "Test Doc",
      format: "pdf",
      download_url: "https://example.com/doc.pdf",
      content: "Document text",
      usage: { cost_cents: 3 },
    }),
    skills: vi.fn().mockResolvedValue([
      { id: "s1", name: "Test Skill", slug: "test-skill" },
    ]),
    installSkill: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({
      status: "healthy",
      version: "2026-03-28",
      providers: { "theo-core": { status: "healthy", latencyMs: 42 } },
      infrastructure: {
        database: { status: "healthy", latencyMs: 3 },
        redis: { status: "healthy", latencyMs: 1 },
      },
    }),
    models: vi.fn().mockResolvedValue([
      { mode: "auto", model_id: "theo-1-flash", label: "Theo Flash", engine: "theo-core", description: "Fast model" },
    ]),
  } as unknown as import("@hitheo/sdk").Theo;
}

// ---------------------------------------------------------------------------
// Tool definition validation
// ---------------------------------------------------------------------------

describe("Tool definitions", () => {
  it("exports exactly 8 tools", () => {
    expect(TOOLS).toHaveLength(8);
  });

  it("every tool has name, description, and inputSchema", () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe("string");
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("tool names follow theo_ prefix convention", () => {
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^theo_/);
    }
  });

  it("tools with required prompt have it in required array", () => {
    const promptTools = TOOLS.filter((t) => t.inputSchema.properties?.prompt);
    for (const tool of promptTools) {
      expect(tool.inputSchema.required).toContain("prompt");
    }
  });
});

// ---------------------------------------------------------------------------
// handleToolCall routing
// ---------------------------------------------------------------------------

describe("handleToolCall", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("routes theo_complete to complete()", async () => {
    const result = await handleToolCall(client as never, null, "theo_complete", { prompt: "test" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Mock completion");
    expect((client as unknown as { complete: ReturnType<typeof vi.fn> }).complete).toHaveBeenCalled();
  });

  it("routes theo_code to code()", async () => {
    const result = await handleToolCall(client as never, null, "theo_code", { prompt: "write code" });
    expect(result.content[0].text).toContain("console.log");
    expect((client as unknown as { code: ReturnType<typeof vi.fn> }).code).toHaveBeenCalled();
  });

  it("routes theo_research to research() + waitForJob()", async () => {
    const result = await handleToolCall(client as never, null, "theo_research", { prompt: "research this" });
    expect(result.content[0].text).toContain("Research report content");
    expect((client as unknown as { research: ReturnType<typeof vi.fn> }).research).toHaveBeenCalled();
    expect((client as unknown as { waitForJob: ReturnType<typeof vi.fn> }).waitForJob).toHaveBeenCalled();
  });

  it("routes theo_image to images()", async () => {
    const result = await handleToolCall(client as never, null, "theo_image", { prompt: "draw this" });
    expect(result.content[0].text).toContain("https://example.com/img.png");
  });

  it("routes theo_document to documents()", async () => {
    const result = await handleToolCall(client as never, null, "theo_document", { prompt: "make doc" });
    expect(result.content[0].text).toContain("Test Doc");
  });

  it("routes theo_skill_list to skills()", async () => {
    const result = await handleToolCall(client as never, null, "theo_skill_list", {});
    expect(result.content[0].text).toContain("test-skill");
  });

  it("routes theo_skill_install to installSkill()", async () => {
    const result = await handleToolCall(client as never, null, "theo_skill_install", { skill_id: "s1" });
    expect(result.content[0].text).toContain("installed successfully");
    expect((client as unknown as { installSkill: ReturnType<typeof vi.fn> }).installSkill).toHaveBeenCalledWith("s1");
  });

  it("routes theo_status to health()", async () => {
    const result = await handleToolCall(client as never, null, "theo_status", {});
    expect(result.content[0].text).toContain("healthy");
  });

  it("returns error content for unknown tools", async () => {
    const result = await handleToolCall(client as never, null, "theo_nonexistent", {});
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("returns error content when handler throws", async () => {
    (client as unknown as { complete: ReturnType<typeof vi.fn> }).complete.mockRejectedValue(new Error("API down"));
    const result = await handleToolCall(client as never, null, "theo_complete", { prompt: "test" });
    expect(result.content[0].text).toContain("Theo error");
    expect(result.content[0].text).toContain("API down");
  });

  it("injects project config persona and skills into theo_complete", async () => {
    const config = { persona: "You are a test bot.", skills: ["custom-skill"] };
    await handleToolCall(client as never, config, "theo_complete", { prompt: "test" });
    const callArgs = (client as unknown as { complete: ReturnType<typeof vi.fn> }).complete.mock.calls[0][0];
    expect(callArgs.persona).toEqual({ system_prompt: "You are a test bot." });
    expect(callArgs.skills).toContain("custom-skill");
  });
});

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------

describe("Resource definitions", () => {
  it("exports exactly 3 resources", () => {
    expect(RESOURCES).toHaveLength(3);
  });

  it("every resource has uri, name, description, and mimeType", () => {
    for (const res of RESOURCES) {
      expect(res.uri).toBeTruthy();
      expect(res.name).toBeTruthy();
      expect(res.description).toBeTruthy();
      expect(res.mimeType).toBe("application/json");
    }
  });

  it("resource URIs follow theo:// scheme", () => {
    for (const res of RESOURCES) {
      expect(res.uri).toMatch(/^theo:\/\//);
    }
  });
});

// ---------------------------------------------------------------------------
// handleResourceRead
// ---------------------------------------------------------------------------

describe("handleResourceRead", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("returns JSON for theo://models", async () => {
    const result = await handleResourceRead(client as never, "theo://models");
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe("theo://models");
    expect(result.contents[0].mimeType).toBe("application/json");
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].model_id).toBe("theo-1-flash");
  });

  it("returns JSON for theo://skills/installed", async () => {
    const result = await handleResourceRead(client as never, "theo://skills/installed");
    expect(result.contents[0].mimeType).toBe("application/json");
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed[0].slug).toBe("test-skill");
    expect((client as unknown as { skills: ReturnType<typeof vi.fn> }).skills).toHaveBeenCalledWith("installed");
  });

  it("returns JSON for theo://health", async () => {
    const result = await handleResourceRead(client as never, "theo://health");
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.status).toBe("healthy");
    expect(parsed.version).toBe("2026-03-28");
  });

  it("returns error text for unknown URIs", async () => {
    const result = await handleResourceRead(client as never, "theo://nonexistent");
    expect(result.contents[0].mimeType).toBe("text/plain");
    expect(result.contents[0].text).toContain("Unknown resource");
  });

  it("returns error text when client throws", async () => {
    (client as unknown as { models: ReturnType<typeof vi.fn> }).models.mockRejectedValue(new Error("Network error"));
    const result = await handleResourceRead(client as never, "theo://models");
    expect(result.contents[0].text).toContain("Error reading");
    expect(result.contents[0].text).toContain("Network error");
  });
});

// ---------------------------------------------------------------------------
// loadProjectConfig
// ---------------------------------------------------------------------------

describe("loadProjectConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "theo-mcp-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no config exists", async () => {
    const config = await loadProjectConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("loads theo.config.json correctly", async () => {
    const configData = {
      persona: "You are a test assistant.",
      skills: ["deep-research"],
      defaultMode: "code",
      temperature: 0.5,
    };
    writeFileSync(join(tmpDir, "theo.config.json"), JSON.stringify(configData));

    const config = await loadProjectConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.persona).toBe("You are a test assistant.");
    expect(config!.skills).toEqual(["deep-research"]);
    expect(config!.defaultMode).toBe("code");
    expect(config!.temperature).toBe(0.5);
  });

  it("handles malformed JSON gracefully", async () => {
    writeFileSync(join(tmpDir, "theo.config.json"), "{ broken json");

    // Should not throw — logs warning and returns null (or falls through to other formats)
    const config = await loadProjectConfig(tmpDir);
    // Either null (parse failed) or possibly loaded from a .js fallback (which doesn't exist)
    expect(config).toBeNull();
  });

  it("handles empty config object", async () => {
    writeFileSync(join(tmpDir, "theo.config.json"), "{}");

    const config = await loadProjectConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.persona).toBeUndefined();
    expect(config!.skills).toBeUndefined();
  });
});
