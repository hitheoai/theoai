# @hitheo/whatsapp

WhatsApp Business API adapter for the [Theo AI](https://hitheo.ai) orchestration API. Bridges WhatsApp Cloud API webhook events to `POST /api/v1/completions` and sends Theo's reply back through the Graph API.

## Install

```bash
npm install @hitheo/whatsapp
```

## Minimal Example

```typescript
import express from "express";
import {
  createWhatsAppHandler,
  verifyWebhook,
  verifySignature,
} from "@hitheo/whatsapp";

const app = express();

const handle = createWhatsAppHandler({
  theoApiKey: process.env.THEO_API_KEY!,
  whatsappToken: process.env.WHATSAPP_TOKEN!,
  phoneNumberId: process.env.WHATSAPP_PHONE_ID!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});

// Meta pings this on setup to verify you own the endpoint:
app.get("/whatsapp/webhook", (req, res) => {
  const challenge = verifyWebhook({
    mode: String(req.query["hub.mode"]),
    token: String(req.query["hub.verify_token"]),
    challenge: String(req.query["hub.challenge"]),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  });
  if (challenge) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Real webhook — verify signature BEFORE JSON.parse:
app.post(
  "/whatsapp/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.header("x-hub-signature-256");
    if (!verifySignature(req.body, sig, process.env.WHATSAPP_APP_SECRET!)) {
      return res.sendStatus(401);
    }
    await handle(JSON.parse(req.body.toString("utf8")));
    res.sendStatus(200);
  },
);
```

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `THEO_API_KEY` | yes | Theo API key (`theo_sk_...`). |
| `WHATSAPP_TOKEN` | yes | Cloud API access token. |
| `WHATSAPP_PHONE_ID` | yes | Your WhatsApp Business phone number ID. |
| `WHATSAPP_APP_SECRET` | yes | Meta App Secret — used to verify `X-Hub-Signature-256`. |
| `WHATSAPP_VERIFY_TOKEN` | yes | Shared secret for the `GET` verification handshake. |

## Features

- **Text + images** — text, captions, images, and `image/*` documents forwarded to Theo. Images are downloaded inside the adapter and sent as `image_base64` — the Meta access token is never embedded in any URL that leaves your deployment.
- **Voice / audio** — transcribed via Theo speech-to-text and appended to the prompt as text when `enableVoice: true`.
- **HMAC signature verification** — `verifySignature(rawBody, headerSig, appSecret)` using `timingSafeEqual`. Must run on the raw body before JSON parsing.
- **Webhook challenge helper** — `verifyWebhook({ mode, token, challenge, verifyToken })` returns the challenge string or `null`.
- **Conversation memory** — per-phone-number conversation IDs. Default is in-process; pass `conversationStore` for Redis/DB.
- **Sanitized errors** — completion failures are logged server-side; the user sees a generic "Something went wrong" message.
- **Chunked replies** — >4000 char responses are split automatically.

## Config Reference

```typescript
createWhatsAppHandler({
  theoApiKey: "theo_sk_...",
  whatsappToken: "WHATSAPP_TOKEN",
  phoneNumberId: "PHONE_ID",
  appSecret: "APP_SECRET",                 // used by verifySignature() in your route
  theoBaseUrl: "https://hitheo.ai",        // override only for self-hosted
  mode: "auto",
  persona: "theo" | "none" | { system_prompt: "..." },
  skills: ["customer-support"],
  conversationStore: myRedisStore,         // optional
  enableVoice: false,                      // opt-in media forwarding
  maxChunkChars: 4000,
});
```

## Docs

- [WhatsApp Integration Guide](https://docs.hitheo.ai/guides/whatsapp-integration)
- [SDK Reference](https://docs.hitheo.ai/sdk-reference/installation)

## License

MIT
