import { afterEach, describe, expect, it, vi } from "vitest";
import { Theo, TheoStream, type StreamEvent, type CompletionResponse } from "../src/index";

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

function sseResponse(payload: string, headers?: Record<string, string>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

describe("CompletionResponse usage shape", () => {
  afterEach(() => vi.restoreAllMocks());

  it("surfaces prompt_tokens, completion_tokens, total_tokens + request_id from header", async () => {
    mockFetch(async () =>
      jsonResponse(
        {
          id: "cmpl_abc",
          object: "completion",
          created: "2026-04-21T00:00:00Z",
          content: "hi",
          mode: "auto",
          resolved_mode: "fast",
          model: { id: "theo-1-flash", label: "Theo Flash", engine: "theo-core" },
          tools_used: [],
          artifacts: [],
          follow_ups: [],
          usage: { cost_cents: 0.02, prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
          metadata: null,
        },
        200,
        { "X-Request-Id": "req_from_header" },
      ),
    );

    const theo = new Theo({ apiKey: TEST_KEY });
    const res: CompletionResponse = await theo.complete({ prompt: "hi" });

    expect(res.usage.prompt_tokens).toBe(4);
    expect(res.usage.completion_tokens).toBe(6);
    expect(res.usage.total_tokens).toBe(10);
    expect(res.usage.cost_cents).toBe(0.02);
    expect(res.request_id).toBe("req_from_header");
  });

  it("preserves request_id in body if the server already set it", async () => {
    mockFetch(async () =>
      jsonResponse({
        id: "cmpl_abc",
        object: "completion",
        created: "2026-04-21T00:00:00Z",
        content: "hi",
        mode: "auto",
        resolved_mode: "fast",
        model: { id: "theo-1-flash", label: "Theo Flash", engine: "theo-core" },
        tools_used: [],
        artifacts: [],
        follow_ups: [],
        usage: { cost_cents: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        metadata: null,
        request_id: "req_from_body",
      }),
    );

    const theo = new Theo({ apiKey: TEST_KEY });
    const res = await theo.complete({ prompt: "hi" });
    expect(res.request_id).toBe("req_from_body");
  });
});

describe("TheoStream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures conversationId, usage, model, and requestId from meta + done events", async () => {
    const payload = [
      'event: meta\ndata: {"id":"cmpl_1","mode":"auto","resolved_mode":"fast","model":{"id":"theo-1-flash","label":"Theo Flash","engine":"theo-core"},"tools":[],"artifacts":[],"conversation_id":"conv_abc","request_id":"req_meta"}\n\n',
      'event: token\ndata: {"token":"Hello"}\n\n',
      'event: token\ndata: {"token":" world"}\n\n',
      'event: done\ndata: {"id":"cmpl_1","content":"Hello world","follow_ups":[],"usage":{"cost_cents":0.02,"prompt_tokens":4,"completion_tokens":6,"total_tokens":10},"conversation_id":"conv_abc","request_id":"req_done"}\n\n',
    ].join("");

    mockFetch(async () => sseResponse(payload, { "X-Request-Id": "req_header" }));

    const theo = new Theo({ apiKey: TEST_KEY });
    const stream = theo.stream({ prompt: "test" });

    const collected: string[] = [];
    for await (const event of stream) {
      if (event.type === "token") collected.push(event.token);
    }

    expect(stream.conversationId).toBe("conv_abc");
    expect(stream.model?.id).toBe("theo-1-flash");
    expect(stream.resolvedMode).toBe("fast");
    expect(stream.usage?.total_tokens).toBe(10);
    expect(stream.content).toBe("Hello world");
    // `done.request_id` takes precedence over the header value.
    expect(stream.requestId).toBe("req_done");
    expect(collected).toEqual(["Hello", " world"]);
  });

  it("discriminated union narrows event.data by event.type", async () => {
    const payload = [
      'event: meta\ndata: {"id":"cmpl_1","mode":"auto","resolved_mode":"fast","model":{"id":"theo-1-flash","label":"Theo Flash","engine":"theo-core"},"tools":[],"artifacts":[],"conversation_id":null,"request_id":"req_1"}\n\n',
      'event: tool\ndata: {"name":"Intent classifier","status":"complete","description":"Classified to fast mode"}\n\n',
      'event: done\ndata: {"id":"cmpl_1","content":"ok","follow_ups":[],"usage":{"cost_cents":0,"prompt_tokens":0,"completion_tokens":0,"total_tokens":0},"conversation_id":null,"request_id":"req_1"}\n\n',
    ].join("");

    mockFetch(async () => sseResponse(payload));

    const theo = new Theo({ apiKey: TEST_KEY });
    const stream = theo.stream({ prompt: "test" });

    const observedTypes: StreamEvent["type"][] = [];
    for await (const event of stream) {
      observedTypes.push(event.type);
      // Compile-time narrowing checks \u2014 these branches must type-check.
      if (event.type === "meta") {
        // event.data is StreamMetaData \u2014 should expose resolved_mode.
        expect(typeof event.data.resolved_mode).toBe("string");
      } else if (event.type === "tool") {
        expect(typeof event.data.name).toBe("string");
      } else if (event.type === "done") {
        expect(typeof event.data.usage.total_tokens).toBe("number");
      }
    }
    expect(observedTypes).toEqual(["meta", "tool", "done"]);
  });

  it("cancel() aborts the underlying fetch and terminates iteration", async () => {
    // Infinite stream so we can test cancel mid-flight.
    const encoder = new TextEncoder();
    mockFetch((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve) => {
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: meta\ndata: {"id":"cmpl_1","mode":"auto","resolved_mode":"fast","model":{"id":"theo-1-flash","label":"Theo Flash","engine":"theo-core"},"tools":[],"artifacts":[],"conversation_id":null,"request_id":"req_1"}\n\n',
              ),
            );
            for (let i = 0; i < 5000; i++) {
              if (signal?.aborted) {
                controller.close();
                return;
              }
              controller.enqueue(encoder.encode(`event: token\ndata: {"token":"${i}"}\n\n`));
              await new Promise((r) => setTimeout(r, 1));
            }
            controller.close();
          },
        });
        resolve(
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      });
    });

    const theo = new Theo({ apiKey: TEST_KEY });
    const stream = theo.stream({ prompt: "test" });

    const events: StreamEvent[] = [];
    setTimeout(() => stream.cancel(), 20);

    for await (const event of stream) {
      events.push(event);
      if (events.length > 20) break; // safety net
    }

    expect(stream.isCancelled).toBe(true);
    // We got at least the meta event and the stream ended without hanging.
    expect(events[0].type).toBe("meta");
  });

  it("exposes TheoStream class directly for consumer-side construction", () => {
    // Used by tests and advanced callers who want to build a stream from a custom Response.
    const stream = new TheoStream(async () =>
      new Response("", { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    expect(stream).toBeInstanceOf(TheoStream);
    expect(stream.isCancelled).toBe(false);
  });
});

describe("theo.verify()", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns authenticated + healthy on successful /health + /models", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/api/v1/health")) {
        return jsonResponse({
          status: "healthy",
          timestamp: new Date().toISOString(),
          version: "2026-03-28",
          providers: { "theo-core": { status: "healthy" } },
        });
      }
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ mode: "auto", model_id: "theo-1-auto", label: "Theo Auto", engine: "theo-core", description: "" }] });
      }
      return jsonResponse({ error: { message: "not found" } }, 404);
    });

    const theo = new Theo({ apiKey: TEST_KEY });
    const result = await theo.verify();
    expect(result.authenticated).toBe(true);
    expect(result.healthy).toBe(true);
    expect(result.modelCount).toBe(1);
    expect(result.version).toBe("2026-03-28");
    expect(typeof result.latencyMs).toBe("number");
    spy.mockRestore();
  });

  it("returns auth hint when /models 401s", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/api/v1/health")) {
        return jsonResponse({
          status: "healthy",
          timestamp: new Date().toISOString(),
          version: "2026-03-28",
          providers: {},
        });
      }
      return jsonResponse(
        { error: { message: "Invalid API key", type: "authentication_error", code: "invalid_api_key", request_id: null } },
        401,
      );
    });

    const theo = new Theo({ apiKey: TEST_KEY, maxRetries: 0 });
    const result = await theo.verify();
    expect(result.healthy).toBe(true);
    expect(result.authenticated).toBe(false);
    expect(result.hint).toContain("theo_sk_");
  });
});
