# @hitheo/mcp

MCP server for [Theo AI](https://hitheo.ai) — use Theo as a tool inside any MCP-compatible IDE: Cursor, Claude Code, Warp, Windsurf, VS Code, and more.

## What it does

Exposes Theo's orchestration engine (intent classification → model routing → skills → agent loop) as MCP tools so your IDE agent can call Theo for completions, code, research, images, and documents — all behind a single `theo_sk_...` key.

## Install

The easiest way is via the SDK CLI, which auto-configures every IDE it can detect:

```bash
npm install -g @hitheo/sdk
export THEO_API_KEY=theo_sk_...
cd your-project
theo init
```

You can also invoke the MCP server directly:

```bash
npx @hitheo/mcp
```

## Manual IDE Config

If you prefer to write the config by hand, point your IDE's MCP configuration at `@hitheo/mcp`:

```json
{
  "mcpServers": {
    "theo": {
      "command": "npx",
      "args": ["-y", "@hitheo/mcp"],
      "env": { "THEO_API_KEY": "${env:THEO_API_KEY}" }
    }
  }
}
```

Config file locations:

| IDE | Path |
| --- | --- |
| Cursor | `<project>/.cursor/mcp.json` |
| Claude Code | `claude mcp add theo npx -y @hitheo/mcp` (or `<project>/.mcp.json`) |
| Warp | `<project>/.warp/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code | `<project>/.vscode/mcp.json` |

Restart the IDE after editing.

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `THEO_API_KEY` | yes | Your Theo API key. Get one at [api.hitheo.ai](https://api.hitheo.ai). |
| `THEO_BASE_URL` | no | Override the API base URL. Defaults to `https://hitheo.ai`. |

## Exposed MCP Tools

| Tool | What it does |
| --- | --- |
| `theo_complete` | Run an AI completion (auto-routes to the best engine). |
| `theo_code` | Generate code (long-form output, framework/language hints). |
| `theo_research` | Deep research with cited sources (async). |
| `theo_image` | Generate images with style and aspect-ratio hints. |
| `theo_document` | Generate PDF/DOCX/PPTX/XLSX/CSV documents. |
| `theo_skill_list` | List installed or marketplace skills. |
| `theo_skill_install` | Install a skill from the Theo marketplace. |
| `theo_status` | Check engine health and latency. |

## Project Configuration (`theo.config.json`)

Drop a `theo.config.json` at your project root to pin a persona, default mode, skills, or inline tools for every MCP tool call:

```json
{
  "persona": "You are a backend engineer assistant for this Express API.",
  "skills": ["deep-research", "content-writer"],
  "defaultMode": "code"
}
```

The MCP server loads this on startup and applies it to every request.

### JS/TS config is opt-in

`theo.config.js` and `theo.config.ts` are **ignored by default** (loading them would execute arbitrary code from the current working directory, which is unsafe whenever an IDE agent opens an untrusted repo). Set `THEO_ALLOW_JS_CONFIG=1` in the environment if you need JS/TS config, and only do it in directories you trust.

## Docs

- [IDE Integration Guide](https://docs.hitheo.ai/guides/ide-integration)
- [CLI Reference](https://docs.hitheo.ai/cli-reference/overview)
- [SDK Reference](https://docs.hitheo.ai/sdk-reference/installation)

## License

MIT
