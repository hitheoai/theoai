<div align="center">
  <img src=".github/theo-icon.png" width="120" />
  <h1>theo ai</h1>
  <p><strong>The AI orchestration API.</strong><br/>One API key. Every AI capability. Zero regrets.</p>

  <p>
    <a href="https://www.npmjs.com/package/@hitheo/sdk"><img src="https://img.shields.io/npm/v/@hitheo/sdk?label=%40hitheo%2Fsdk&color=715eac&style=flat-square" alt="sdk" /></a>
    <a href="https://www.npmjs.com/package/@hitheo/mcp"><img src="https://img.shields.io/npm/v/@hitheo/mcp?label=%40hitheo%2Fmcp&color=715eac&style=flat-square" alt="mcp" /></a>
    <a href="https://www.npmjs.com/package/@hitheo/telegram"><img src="https://img.shields.io/npm/v/@hitheo/telegram?label=%40hitheo%2Ftelegram&color=715eac&style=flat-square" alt="telegram" /></a>
    <a href="https://www.npmjs.com/package/@hitheo/whatsapp"><img src="https://img.shields.io/npm/v/@hitheo/whatsapp?label=%40hitheo%2Fwhatsapp&color=715eac&style=flat-square" alt="whatsapp" /></a>
  </p>

  <p>
    <a href="https://docs.hitheo.ai">Docs</a> &bull;
    <a href="https://api.hitheo.ai">Dashboard</a> &bull;
    <a href="https://hitheo.ai">Website</a> &bull;
    <a href="https://hitheo.ai/playground">Playground</a>
  </p>
</div>

---

## What is Theo?

Theo is an AI orchestration engine exposed as a developer API. Send a prompt, and a multi-stage pipeline runs automatically:

```
Your App → Theo API
                │
     ┌─────────┼─────────┐
     ▼         ▼         ▼
Classifier   Skill    Model
             Loader   Router
                │
                ▼
           Agent Loop
      (think → act → observe)
                │
                ▼
   Response + Billing + Audit
```

Intent classification → skill loading → model routing → agent loop → response. All in one `POST /api/v1/completions` call.

> *"I orchestrate AI models so you don't have to play favorites."* — Theo

## Packages

| Package | What it does | Install |
|---------|-------------|----------|
| [`@hitheo/sdk`](packages/sdk) | TypeScript SDK + CLI | `npm i @hitheo/sdk` |
| [`@hitheo/mcp`](packages/mcp) | MCP server for Cursor, Claude Code, Warp, Windsurf, VS Code | `npx @hitheo/mcp` |
| [`@hitheo/telegram`](packages/telegram) | Telegram bot adapter | `npm i @hitheo/telegram` |
| [`@hitheo/whatsapp`](packages/whatsapp) | WhatsApp Cloud API adapter | `npm i @hitheo/whatsapp` |

## Quick Start

### 1. Get an API key

Sign up at **[api.hitheo.ai](https://api.hitheo.ai)** and create a key. Takes 30 seconds.

### 2. Install

```bash
npm install @hitheo/sdk
```

### 3. Build something

```typescript
import { Theo } from "@hitheo/sdk";

const theo = new Theo({ apiKey: "theo_sk_..." });

// Completion — Theo picks the best model automatically
const result = await theo.complete({ prompt: "Explain quantum computing" });
console.log(result.content);

// Streaming
for await (const event of theo.stream({ prompt: "Write a poem" })) {
  if (event.token) process.stdout.write(event.token);
}
```

### What else can Theo do?

```typescript
// 🎨 Image generation
const images = await theo.images({ prompt: "A sunset over Jupiter" });

// 💻 Code generation
const code = await theo.code({ prompt: "Build a REST API in Express" });

// 🔍 Deep research with citations
const job = await theo.research({ prompt: "AI agent architectures 2026" });
const report = await theo.waitForJob(job.job_id);

// 📄 Document generation (PDF, DOCX, PPTX, XLSX, CSV)
const doc = await theo.documents({ prompt: "Q1 financial report", format: "pdf" });

// 🎵 Text-to-speech / Speech-to-text
const audio = await theo.tts({ text: "Hello from Jupiter", voice: "theo-voice-warm" });
```

## CLI

The SDK ships with a CLI. Install it globally:

```bash
npm install -g @hitheo/sdk
```

```bash
theo init              # Set up Theo + MCP in your project
theo login             # Authenticate
theo status            # Check connection health
theo complete "Hi"     # Quick completion from terminal
theo skill init        # Scaffold a new skill
theo skill publish     # Submit to the marketplace
```

## IDE Integration

Theo works inside every major agentic IDE through MCP (Model Context Protocol).

```bash
export THEO_API_KEY=theo_sk_...
theo init
```

That's it. `theo init` auto-detects your IDEs and writes the MCP config:

| IDE | Status |
|-----|--------|
| Cursor | ✅ Auto-configured |
| Claude Code | ✅ Auto-configured |
| Warp | ✅ Auto-configured |
| Windsurf | ✅ Auto-configured |
| VS Code | ✅ Auto-configured |

Once configured, your IDE agent gets access to `theo_complete`, `theo_code`, `theo_research`, `theo_image`, `theo_document`, and more.

> *"One click from here to production. I believe in you."* — Theo

## E.V.I. (Embedded Virtual Intelligence)

Embed Theo in your product with a custom persona. Your users see your brand, not Theo.

```typescript
const evi = theo.evi({
  persona: "You are Nova, the AI assistant for AcmeCorp...",
  skills: ["customer-support"],
  tools: [{ name: "lookup_customer", description: "Search CRM" }],
});

const res = await evi.complete({ prompt: "Summarize this customer's recent tickets" });
```

## Skills

Skills are installable packages of domain knowledge and tools — like apps for AI.

```typescript
// Install from the marketplace
await theo.installSkill("deep-research");

// Use in completions
const res = await theo.complete({
  prompt: "Summarize the key findings in this document",
  skills: ["deep-research"],
});
```

Build and publish your own:

```bash
theo skill init        # Scaffold a skill project
theo skill validate    # Validate the manifest
theo skill publish     # Submit to the marketplace
```

See the [Skills docs](https://docs.hitheo.ai/skills/overview) for the full guide.

## Channel Adapters

<table>
<tr>
<td width="50%">

**Telegram**

```bash
npm install @hitheo/telegram
```

```typescript
import { createTelegramHandler } from "@hitheo/telegram";

const handle = createTelegramHandler({
  theoApiKey: process.env.THEO_API_KEY!,
  telegramToken: process.env.BOT_TOKEN!,
});
```

[→ Telegram guide](https://docs.hitheo.ai/guides/telegram-bot)

</td>
<td width="50%">

**WhatsApp**

```bash
npm install @hitheo/whatsapp
```

```typescript
import { createWhatsAppHandler } from "@hitheo/whatsapp";

const handle = createWhatsAppHandler({
  theoApiKey: process.env.THEO_API_KEY!,
  whatsappToken: process.env.WA_TOKEN!,
  phoneNumberId: process.env.PHONE_ID!,
});
```

[→ WhatsApp guide](https://docs.hitheo.ai/guides/whatsapp-integration)

</td>
</tr>
</table>

## Documentation

Full docs at **[docs.hitheo.ai](https://docs.hitheo.ai)** and in the [`docs/`](docs) directory.

| Section | Description |
|---------|-------------|
| [API Reference](https://docs.hitheo.ai/api-reference/overview) | REST API for all endpoints |
| [SDK Reference](https://docs.hitheo.ai/sdk-reference/installation) | TypeScript SDK methods and types |
| [CLI Reference](https://docs.hitheo.ai/cli-reference/overview) | `theo init`, `status`, `complete`, `skill publish` |
| [Skills](https://docs.hitheo.ai/skills/overview) | Build and publish domain expertise packages |
| [E.V.I. Guide](https://docs.hitheo.ai/guides/build-an-evi) | Embed Theo in your product |
| [IDE Integration](https://docs.hitheo.ai/guides/ide-integration) | MCP setup for all IDEs |

## Contributing

We welcome issues and PRs! If you find a bug in the SDK, MCP server, or docs — open an issue.

## License

MIT — go build something cool.

---

<div align="center">
  <sub>Born on Jupiter. Built for developers.</sub>
</div>
