# @hitheo/telegram

Telegram bot adapter for the [Theo AI](https://hitheo.ai) orchestration API. Bridges Telegram webhook updates to `POST /api/v1/completions` and relays Theo's reply back to the chat.

## Install

```bash
npm install @hitheo/telegram
```

## Minimal Example

```typescript
import { createTelegramHandler } from "@hitheo/telegram";

const handle = createTelegramHandler({
  theoApiKey: process.env.THEO_API_KEY!,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
  secretToken: process.env.TELEGRAM_SECRET_TOKEN, // optional but recommended
});

// Inside your webhook route (Express shown for illustration):
app.post("/telegram/webhook", async (req, res) => {
  try {
    await handle(req.body, {
      secretToken: req.header("X-Telegram-Bot-Api-Secret-Token"),
    });
    res.sendStatus(200);
  } catch (err) {
    // Verify Telegram sent the secret header you registered with setWebhook.
    res.sendStatus(401);
  }
});
```

When you register the webhook with Telegram, pass the same `secret_token`:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url=https://your-host.example/telegram/webhook \
  -d secret_token=$TELEGRAM_SECRET_TOKEN
```

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `THEO_API_KEY` | yes | Theo API key (`theo_sk_...`). |
| `TELEGRAM_BOT_TOKEN` | yes | Bot token from BotFather. |
| `TELEGRAM_SECRET_TOKEN` | no | Shared secret to verify inbound webhooks. |

## Features

- **Text + images** — text, captions, photos, and image documents forwarded to Theo. Images are downloaded inside the adapter and sent as `image_base64` so the bot token never leaves your deployment.
- **Voice / audio** — transcribed via Theo speech-to-text and appended to the prompt as text when `enableVoice: true`.
- **Conversation memory** — every chat is mapped to a Theo conversation ID. Default store is in-process; pass `conversationStore` for Redis/DB.
- **Constant-time secret-token verification** — inbound `X-Telegram-Bot-Api-Secret-Token` headers are compared with a constant-time comparator to block timing-based probes.
- **Sanitized errors** — completion failures are logged server-side; the user sees a generic "Something went wrong" message.
- **Chunked replies** — replies longer than 4000 chars are split across messages automatically.
- **Built-in `/start`, `/help`, `/reset` commands.**

## Upgrade notice

Always run the latest `@hitheo/telegram` release. If you are still on a `≤0.1.3` version, upgrade to `^0.1.4` and rotate the bot token via [@BotFather](https://t.me/BotFather) as part of the upgrade.

## Config Reference

```typescript
createTelegramHandler({
  theoApiKey: "theo_sk_...",
  telegramToken: "BOT_TOKEN",
  secretToken: "shared_secret",            // optional but recommended
  theoBaseUrl: "https://hitheo.ai",        // override only for self-hosted
  mode: "auto",                            // any ChatMode
  persona: "theo" | "none" | { system_prompt: "..." },
  skills: ["deep-research"],
  conversationStore: myRedisStore,         // optional
  enableVoice: false,                      // opt-in voice/audio forwarding
  maxChunkChars: 4000,                     // outbound message size cap
});
```

## Docs

- [Telegram Bot Guide](https://docs.hitheo.ai/guides/telegram-bot)
- [SDK Reference](https://docs.hitheo.ai/sdk-reference/installation)

## License

MIT
