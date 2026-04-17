# @hitheo/sdk

Official TypeScript SDK for the **Theo AI Orchestration API**.

One API key. Every AI capability. Theo picks the best model for each task automatically.

## Use Theo in Your IDE (Recommended)

The fastest way to use Theo is through your IDE agent — no code required.

```bash
# Install the SDK (includes the CLI)
npm install -g @hitheo/sdk

# Set your API key
export THEO_API_KEY=theo_sk_...

# Initialize Theo in your project
cd your-project
theo init
```

`theo init` detects your IDEs (Cursor, Claude Code, Warp, Windsurf, VS Code) and configures Theo as an MCP tool automatically. Restart your IDE, then:

> "Use Theo to generate a REST API for user management with auth"

See the [IDE Integration Guide](https://docs.hitheo.ai/guides/ide-integration) for details.

## Install (Programmatic SDK)

```bash
npm install @hitheo/sdk
```

## Quick Start

```typescript
import { Theo } from "@hitheo/sdk";

const theo = new Theo({ apiKey: "theo_sk_..." });

// Chat completion
const result = await theo.complete({ prompt: "Explain quantum computing" });
console.log(result.content);

// Streaming
for await (const event of theo.stream({ prompt: "Write a poem" })) {
  if (event.token) process.stdout.write(event.token);
}

// Image generation
const images = await theo.images({ prompt: "A sunset over Jupiter" });
console.log(images.images[0].url);

// Video (async - returns job ID)
const job = await theo.video({ prompt: "A cat playing piano" });
const result = await theo.waitForJob(job.job_id);
console.log(result.result);

// Code generation
const code = await theo.code({ prompt: "Build a REST API in Express" });
console.log(code.artifacts);

// Deep research (async)
const research = await theo.research({ prompt: "AI agent architectures 2026" });
const report = await theo.waitForJob(research.job_id);

// Document generation
const doc = await theo.documents({ prompt: "Q1 financial report", format: "pdf" });
console.log(doc.download_url);

// Text-to-speech
const audio = await theo.tts({ text: "Hello from Jupiter", voice: "theo-voice-warm" });

// Speech-to-text
const transcript = await theo.stt(audioBlob);
console.log(transcript.text);
```

## API Reference

### `new Theo({ apiKey, baseUrl? })`

Create a client. `baseUrl` defaults to `https://hitheo.ai`.

### Completions

| Method | Description |
|--------|-------------|
| `theo.complete(request)` | Non-streaming completion |
| `theo.stream(request)` | Streaming SSE (async generator) |

### Media

| Method | Description |
|--------|-------------|
| `theo.images({ prompt, style?, aspect_ratio? })` | Generate images |
| `theo.video({ prompt, duration?, style? })` | Generate video (async) |
| `theo.code({ prompt, language?, framework? })` | Generate code |
| `theo.research({ prompt, depth? })` | Deep research (async) |
| `theo.documents({ prompt, format? })` | Generate documents |
| `theo.tts({ text, voice?, speed? })` | Text-to-speech (returns ArrayBuffer). See the [TTS reference](https://docs.hitheo.ai/api-reference/audio/text-to-speech) for available Theo voice identifiers. |
| `theo.stt(file, language?)` | Speech-to-text |

### Jobs (async polling)

| Method | Description |
|--------|-------------|
| `theo.job(jobId)` | Get job status |
| `theo.waitForJob(jobId, interval?, timeout?)` | Poll until complete |

### E.V.I. Canvas

| Method | Description |
|--------|-------------|
| `theo.canvases()` | List your canvases |
| `theo.canvas(id)` | Get a canvas |
| `theo.createCanvas(input)` | Create a canvas |
| `theo.updateCanvas(id, input)` | Update a canvas |
| `theo.deleteCanvas(id)` | Delete a canvas |
| `theo.compileCanvas(id)` | Compile into SkillManifest + WorkflowSteps |
| `theo.testCanvas(id, message, history?)` | Test in sandbox |
| `theo.publishCanvas(id, opts)` | Publish as a skill |

### Platform

| Method | Description |
|--------|-------------|
| `theo.models()` | List available models |
| `theo.skills(filter?)` | List skills (marketplace or installed) |
| `theo.installSkill(skillId)` | Install a skill |
| `theo.tools()` | List available tools |
| `theo.conversations()` | List conversations |
| `theo.conversation(id)` | Get conversation |
| `theo.usage({ from?, to? })` | Usage & billing data |
| `theo.health()` | Provider health status |

## Project Configuration (`defineConfig`)

Create a `theo.config.ts` (or `.json`) to customize Theo's behavior per-project:

```typescript
import { defineConfig } from "@hitheo/sdk";

export default defineConfig({
  persona: "You are a backend engineer assistant for this Express API.",
  skills: ["deep-research", "content-writer"],
  defaultMode: "code",
});
```

The MCP server reads this on startup and applies persona/skills/mode to every tool call.

## CLI

```bash
theo init                  # Set up Theo + MCP in a project
theo login                 # Authenticate
theo mcp install           # Configure MCP for detected IDEs
theo status                # Check connection health
theo complete "prompt"     # Quick completion from terminal
theo skill init            # Scaffold a new skill
theo skill validate        # Validate a skill manifest
theo skill publish         # Submit to marketplace
```

## E.V.I. Canvas

Build AI skills visually and manage them programmatically:

```typescript
// Create a canvas
const canvas = await theo.createCanvas({ name: "Support Agent" });

// Compile and test
const compiled = await theo.compileCanvas(canvas.id);
const test = await theo.testCanvas(canvas.id, "Hello, test!");
console.log(test.response);

// Publish with visibility control
const result = await theo.publishCanvas(canvas.id, {
  slug: "support-agent",
  version: "1.0.0",
  author: { name: "Your Name" },
  visibility: "org", // "private" | "org" | "public"
  target_org_id: "org-uuid", // required for "org" visibility
});
```

## OpenAI Compatibility

Set `format: "openai"` to get ChatCompletion-compatible responses:

```typescript
const result = await theo.complete({
  prompt: "Hello",
  format: "openai",
});
// result matches OpenAI's chat.completion shape
```

## Security

> **⚠️ Never use API keys in client-side/browser code.** API keys grant full access to your account and should only be used in server-side environments (Node.js, Deno, edge workers, etc.). If a key is leaked in client-side JavaScript, anyone can use it to make API calls on your behalf.
>
> For use cases that require browser-side API access, set per-key `allowed_origins` restrictions via `PUT /api/v1/keys/:id`. See the full [Security documentation](https://docs.hitheo.ai/security/authentication) for details.

## License

MIT
