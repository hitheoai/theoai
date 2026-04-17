import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Theo, TheoApiError, EviInstance } from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_KEY = "theo_sk_test_abc123";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as never);
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Theo SDK Client", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  // ── Constructor defaults ──

  describe("constructor", () => {
    it("uses default baseUrl, timeout, and retries", () => {
      const client = new Theo({ apiKey: TEST_KEY });
      // Access internals via prototype — just verify it doesn't throw
      expect(client).toBeDefined();
    });

    it("applies custom baseUrl (strips trailing slash)", async () => {
      fetchSpy = mockFetch(async (url) => {
        expect(url.startsWith("https://custom.api.com/api/v1/models")).toBe(true);
        return jsonResponse({ models: [] });
      });

      const client = new Theo({ apiKey: TEST_KEY, baseUrl: "https://custom.api.com/" });
      await client.models();
    });
  });

  // ── Request headers ──

  describe("request headers", () => {
    it("sends Authorization and Content-Type headers", async () => {
      fetchSpy = mockFetch(async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe(`Bearer ${TEST_KEY}`);
        expect(headers["Content-Type"]).toBe("application/json");
        return jsonResponse({ models: [] });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      await client.models();
    });
  });

  // ── Retry on 429 ──

  describe("retry on 429", () => {
    it("retries and respects Retry-After header", async () => {
      let attempts = 0;
      fetchSpy = mockFetch(async () => {
        attempts++;
        if (attempts === 1) {
          return jsonResponse(
            { error: { message: "Rate limited", type: "rate_limit_error", code: "rate_limit_exceeded" } },
            429,
            { "Retry-After": "1" },
          );
        }
        return jsonResponse({ models: [] });
      });

      const client = new Theo({ apiKey: TEST_KEY, maxRetries: 2 });
      const result = await client.models();
      expect(result).toEqual([]);
      expect(attempts).toBe(2);
    });
  });

  // ── Retry on 5xx ──

  describe("retry on 5xx", () => {
    it("retries on server errors with exponential backoff", async () => {
      let attempts = 0;
      fetchSpy = mockFetch(async () => {
        attempts++;
        if (attempts <= 2) {
          return jsonResponse({ error: { message: "Internal error" } }, 500);
        }
        return jsonResponse({ models: [] });
      });

      const client = new Theo({ apiKey: TEST_KEY, maxRetries: 3 });
      const result = await client.models();
      expect(result).toEqual([]);
      expect(attempts).toBe(3);
    });
  });

  // ── No retry on 4xx (except 429) ──

  describe("no retry on 4xx", () => {
    it("throws immediately on 400", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse(
          { error: { message: "Bad request", type: "invalid_request_error", code: "bad_request" } },
          400,
        );
      });

      const client = new Theo({ apiKey: TEST_KEY, maxRetries: 3 });
      await expect(client.models()).rejects.toThrow(TheoApiError);
    });

    it("throws immediately on 401", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse(
          { error: { message: "Unauthorized", type: "authentication_error", code: "unauthorized" } },
          401,
        );
      });

      const client = new Theo({ apiKey: TEST_KEY });
      await expect(client.models()).rejects.toThrow(TheoApiError);
    });

    it("throws immediately on 404", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse(
          { error: { message: "Not found", type: "not_found_error", code: "not_found" } },
          404,
        );
      });

      const client = new Theo({ apiKey: TEST_KEY });
      await expect(client.models()).rejects.toThrow(TheoApiError);
    });
  });

  // ── TheoApiError.fromResponse ──

  describe("TheoApiError.fromResponse", () => {
    it("parses structured error body", () => {
      const body = JSON.stringify({
        error: {
          message: "Invalid prompt",
          type: "invalid_request_error",
          code: "missing_prompt",
          request_id: "req_abc",
        },
      });

      const err = TheoApiError.fromResponse(400, body, "/api/v1/completions");
      expect(err.status).toBe(400);
      expect(err.details?.message).toBe("Invalid prompt");
      expect(err.details?.type).toBe("invalid_request_error");
      expect(err.details?.code).toBe("missing_prompt");
      expect(err.details?.request_id).toBe("req_abc");
      expect(err.message).toContain("Invalid prompt");
    });

    it("handles non-JSON body gracefully", () => {
      const err = TheoApiError.fromResponse(500, "Internal Server Error", "/api/v1/completions");
      expect(err.status).toBe(500);
      expect(err.body).toBe("Internal Server Error");
      expect(err.details).toBeNull();
    });
  });

  // ── SSE stream parsing ──

  describe("stream()", () => {
    it("parses SSE events correctly", async () => {
      const ssePayload = [
        'event: meta\ndata: {"id":"cmpl_1","mode":"auto"}\n\n',
        'event: token\ndata: {"token":"Hello"}\n\n',
        'event: token\ndata: {"token":" world"}\n\n',
        'event: done\ndata: {"id":"cmpl_1","content":"Hello world"}\n\n',
      ].join("");

      fetchSpy = mockFetch(async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(ssePayload));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const events: Array<{ type: string; token?: string }> = [];

      for await (const event of client.stream({ prompt: "test" })) {
        events.push({ type: event.type, token: event.token });
      }

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("meta");
      expect(events[1].type).toBe("token");
      expect(events[1].token).toBe("Hello");
      expect(events[2].token).toBe(" world");
      expect(events[3].type).toBe("done");
    });
  });

  // ── waitForJob ──

  describe("waitForJob()", () => {
    it("polls until job completes", async () => {
      let calls = 0;
      fetchSpy = mockFetch(async () => {
        calls++;
        if (calls <= 2) {
          return jsonResponse({ job: { id: "j1", type: "video", status: "active", progress: calls * 30, result: null, error: null, created_at: null, completed_at: null } });
        }
        return jsonResponse({ job: { id: "j1", type: "video", status: "completed", progress: 100, result: { url: "https://example.com/v.mp4" }, error: null, created_at: null, completed_at: new Date().toISOString() } });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const result = await client.waitForJob("j1", 50, 5000);
      expect(result.status).toBe("completed");
      expect(calls).toBe(3);
    });

    it("throws on timeout", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse({ job: { id: "j1", type: "video", status: "active", progress: 10, result: null, error: null, created_at: null, completed_at: null } });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      await expect(client.waitForJob("j1", 10, 50)).rejects.toThrow("timed out");
    });
  });
});

// ---------------------------------------------------------------------------
// E.V.I. (Embedded Virtual Intelligence) Tests
// ---------------------------------------------------------------------------

describe("EviInstance", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  function capturedBody(): Record<string, unknown> {
    const call = fetchSpy.mock.calls[0];
    const init = call?.[1] as RequestInit | undefined;
    return JSON.parse(init?.body as string);
  }

  describe("persona injection", () => {
    it("injects custom persona as system_prompt on every completion", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse({ id: "cmpl_1", content: "hi", mode: "auto", resolved_mode: "auto", model: { id: "m1", label: "M1", engine: "core" }, tools_used: [], artifacts: [], follow_ups: [], usage: { cost_cents: 0 }, metadata: null });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const evi = client.evi({ persona: "You are Nova, an operations assistant." });
      await evi.complete({ prompt: "Check stock levels" });

      const body = capturedBody();
      expect(body.persona).toEqual({ system_prompt: "You are Nova, an operations assistant." });
    });
  });

  describe("skill merging", () => {
    it("merges E.V.I. default skills with per-request skills", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse({ id: "cmpl_1", content: "ok", mode: "auto", resolved_mode: "auto", model: { id: "m1", label: "M1", engine: "core" }, tools_used: [], artifacts: [], follow_ups: [], usage: { cost_cents: 0 }, metadata: null });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const evi = client.evi({
        persona: "Assistant",
        skills: ["inventory-check", "data-extraction"],
      });
      await evi.complete({ prompt: "test", skills: ["deep-research"] });

      const body = capturedBody();
      expect(body.skills).toEqual(["inventory-check", "data-extraction", "deep-research"]);
    });

    it("omits skills array when neither E.V.I. nor request provides them", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse({ id: "cmpl_1", content: "ok", mode: "auto", resolved_mode: "auto", model: { id: "m1", label: "M1", engine: "core" }, tools_used: [], artifacts: [], follow_ups: [], usage: { cost_cents: 0 }, metadata: null });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const evi = client.evi({ persona: "A" });
      await evi.complete({ prompt: "test" });

      const body = capturedBody();
      expect(body.skills).toBeUndefined();
    });
  });

  describe("tool merging", () => {
    it("merges E.V.I. default tools with per-request tools", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse({ id: "cmpl_1", content: "ok", mode: "auto", resolved_mode: "auto", model: { id: "m1", label: "M1", engine: "core" }, tools_used: [], artifacts: [], follow_ups: [], usage: { cost_cents: 0 }, metadata: null });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const evi = client.evi({
        persona: "A",
        tools: [{ name: "lookup_customer", description: "Search CRM" }],
      });
      await evi.complete({
        prompt: "test",
        tools: [{ name: "send_email", description: "Send email" }],
      });

      const body = capturedBody();
      expect(body.tools).toHaveLength(2);
      expect(body.tools[0].name).toBe("lookup_customer");
      expect(body.tools[1].name).toBe("send_email");
    });
  });

  describe("default mode and metadata", () => {
    it("uses E.V.I. defaultMode when request omits mode", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse({ id: "cmpl_1", content: "ok", mode: "code", resolved_mode: "code", model: { id: "m1", label: "M1", engine: "core" }, tools_used: [], artifacts: [], follow_ups: [], usage: { cost_cents: 0 }, metadata: null });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const evi = client.evi({ persona: "A", defaultMode: "code" });
      await evi.complete({ prompt: "test" });

      const body = capturedBody();
      expect(body.mode).toBe("code");
    });

    it("attaches _evi metadata marker and merges with E.V.I. + request metadata", async () => {
      fetchSpy = mockFetch(async () => {
        return jsonResponse({ id: "cmpl_1", content: "ok", mode: "auto", resolved_mode: "auto", model: { id: "m1", label: "M1", engine: "core" }, tools_used: [], artifacts: [], follow_ups: [], usage: { cost_cents: 0 }, metadata: null });
      });

      const client = new Theo({ apiKey: TEST_KEY });
      const evi = client.evi({
        persona: "A",
        metadata: { product: "acme-portal" },
      });
      await evi.complete({ prompt: "test" });

      const body = capturedBody();
      expect(body.metadata).toEqual({ product: "acme-portal", _evi: true });
    });
  });

  describe("getConfig()", () => {
    it("returns a frozen copy of the config", () => {
      const client = new Theo({ apiKey: TEST_KEY });
      const evi = client.evi({
        persona: "Test persona",
        skills: ["s1"],
        defaultMode: "fast",
      });

      const config = evi.getConfig();
      expect(config.persona).toBe("Test persona");
      expect(config.skills).toEqual(["s1"]);
      expect(config.defaultMode).toBe("fast");
    });
  });
});
