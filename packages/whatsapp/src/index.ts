/**
 * @hitheo/whatsapp - WhatsApp Business API adapter for the Theo API.
 *
 * Bridges WhatsApp Cloud API webhook events to POST /api/v1/completions.
 *
 * Usage:
 *   import {
 *     createWhatsAppHandler,
 *     verifyWebhook,
 *     verifySignature,
 *   } from "@hitheo/whatsapp";
 *
 *   const handle = createWhatsAppHandler({
 *     theoApiKey: process.env.THEO_API_KEY!,
 *     whatsappToken: process.env.WHATSAPP_TOKEN!,
 *     phoneNumberId: process.env.WHATSAPP_PHONE_ID!,
 *     appSecret: process.env.WHATSAPP_APP_SECRET!,
 *   });
 *
 *   app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
 *     if (!verifySignature(req.body, req.header("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET!)) {
 *       return res.sendStatus(401);
 *     }
 *     await handle(JSON.parse(req.body.toString("utf8")));
 *     res.sendStatus(200);
 *   });
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Theo } from "@hitheo/sdk";
import type { ChatMode, PersonaInput } from "@hitheo/sdk";
import {
  createInMemoryChatRateLimiter,
  createInMemoryMessageDedup,
  type ChatRateLimiter,
  type MessageDedup,
} from "./chat-limiter.js";

// ---------------------------------------------------------------------------
// WhatsApp Cloud API types (minimal)
// ---------------------------------------------------------------------------

export interface WhatsAppMediaRef {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WhatsAppMediaRef;
  audio?: WhatsAppMediaRef;
  video?: WhatsAppMediaRef;
  document?: WhatsAppMediaRef;
  voice?: WhatsAppMediaRef;
}

export interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        messages?: WhatsAppMessage[];
        statuses?: WhatsAppStatus[];
      };
      field: string;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Conversation store (pluggable; default in-memory)
// ---------------------------------------------------------------------------

export interface ConversationStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, conversationId: string): Promise<void> | void;
  clear(key: string): Promise<void> | void;
}

function createMemoryStore(): ConversationStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, conversationId) => {
      map.set(key, conversationId);
    },
    clear: (key) => {
      map.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WhatsAppHandlerConfig {
  theoApiKey: string;
  whatsappToken: string;
  phoneNumberId: string;
  /**
   * Meta App Secret used to verify X-Hub-Signature-256 on incoming webhooks.
   * Not consumed inside `handleWebhook`; pass it to the exported
   * `verifySignature` helper in your HTTP layer, before JSON parsing.
   */
  appSecret?: string;
  theoBaseUrl?: string;
  mode?: ChatMode;
  persona?: PersonaInput;
  skills?: string[];
  conversationStore?: ConversationStore;
  enableVoice?: boolean;
  /**
   * Max chars per outbound WhatsApp message. Hard limit is 4096; we default
   * to 4000 to leave a small buffer.
   */
  maxChunkChars?: number;
  /**
   * Per-chat rate limiter (default: 20 msgs/min, in-memory).
   * Swap for a Redis-backed implementation in multi-worker deploys.
   */
  chatRateLimiter?: ChatRateLimiter;
  /**
   * Dedup helper that prevents Meta webhook retries from being forwarded
   * to Theo twice. Defaults to an in-memory LRU keyed on `from`+`msg.id`.
   */
  messageDedup?: MessageDedup;
}

// ---------------------------------------------------------------------------
// Signature verification helper
// ---------------------------------------------------------------------------

/**
 * Verify the X-Hub-Signature-256 header Meta sends with every webhook POST.
 * `rawBody` MUST be the exact bytes from the request (not a reparsed JSON
 * object). Use `express.raw({ type: "application/json" })` or framework
 * equivalent.
 */
export function verifySignature(
  rawBody: Buffer | string,
  headerSig: string | null | undefined,
  appSecret: string,
): boolean {
  if (!headerSig || !appSecret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(headerSig);
  if (!match) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expectedHex = createHmac("sha256", appSecret).update(body).digest("hex");
  const providedHex = match[1]!;

  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(providedHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Webhook challenge (GET verification)
// ---------------------------------------------------------------------------

/**
 * Verify the webhook challenge Meta sends on setup (GET request).
 */
export function verifyWebhook(params: {
  mode: string;
  token: string;
  challenge: string;
  verifyToken: string;
}): string | null {
  if (params.mode === "subscribe" && params.token === params.verifyToken) {
    return params.challenge;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 4000;

export function createWhatsAppHandler(config: WhatsAppHandlerConfig) {
  const theo = new Theo({
    apiKey: config.theoApiKey,
    baseUrl: config.theoBaseUrl,
  });

  const store = config.conversationStore ?? createMemoryStore();
  const maxChunk = config.maxChunkChars ?? DEFAULT_MAX_CHARS;
  const chatRateLimiter = config.chatRateLimiter ?? createInMemoryChatRateLimiter();
  const messageDedup = config.messageDedup ?? createInMemoryMessageDedup();

  return async function handleWebhook(
    payload: WhatsAppWebhookPayload,
  ): Promise<void> {
    if (payload.object !== "whatsapp_business_account") return;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        // Acknowledge status events (delivered/read) silently.
        if (change.value.statuses && !change.value.messages) continue;

        const messages = change.value.messages ?? [];
        for (const msg of messages) {
          // Meta retries webhooks on any non-2xx response — drop the
          // retry so Theo is only called once per unique message.
          if (await messageDedup.seen(msg.from, msg.id)) continue;

          // Throttle a single sender that's flooding us; client-side cap
          // keeps the cost off our Theo completion budget.
          if (!(await chatRateLimiter.allow(msg.from))) {
            await sendChunkedWhatsAppMessage(
              config.whatsappToken,
              config.phoneNumberId,
              msg.from,
              "You're sending messages too quickly. Please slow down and try again in a minute.",
              maxChunk,
            );
            continue;
          }

          await handleMessage(msg, theo, config, store, maxChunk);
        }
      }
    }
  };
}

async function handleMessage(
  msg: WhatsAppMessage,
  theo: Theo,
  config: WhatsAppHandlerConfig,
  store: ConversationStore,
  maxChunk: number,
): Promise<void> {
  const from = msg.from;
  let text = extractText(msg);
  const attachments = await resolveAttachments(msg, config);

  // Voice / audio — transcribe with Theo STT and append to the prompt.
  // Previously these were tagged as `image_url` which the server rejects.
  if (config.enableVoice) {
    const voiceRef = msg.voice ?? msg.audio;
    if (voiceRef?.id) {
      const transcript = await transcribeWhatsAppVoice(
        config.whatsappToken,
        voiceRef.id,
        theo,
      );
      if (transcript) {
        text = text ? `${text}\n\n[voice]: ${transcript}` : transcript;
      }
    }
  }

  // Nothing we can forward — skip.
  if (!text && attachments.length === 0) return;

  try {
    const existingConversationId = await store.get(from);

    const request: Record<string, unknown> = {
      prompt: text || "(user sent an attachment without text)",
      mode: config.mode ?? "auto",
      persona: config.persona,
      skills: config.skills,
      conversation_id: existingConversationId ?? undefined,
      metadata: {
        channel: "whatsapp",
        whatsapp_from: from,
        whatsapp_message_id: msg.id,
      },
    };
    if (attachments.length > 0) request.attachments = attachments;

    const result = await theo.complete(
      request as unknown as Parameters<typeof theo.complete>[0],
    );

    const conversationId =
      (result as { conversation_id?: string }).conversation_id ??
      ((result.metadata as Record<string, unknown> | null)?.conversation_id as
        | string
        | undefined);
    if (conversationId && !existingConversationId) {
      await store.set(from, conversationId);
    }

    await sendChunkedWhatsAppMessage(
      config.whatsappToken,
      config.phoneNumberId,
      from,
      result.content,
      maxChunk,
    );
  } catch (err) {
    // Log the detail server-side, don't echo raw error text to the user.
    console.error("[theo-whatsapp] completion failed:", err);
    await sendChunkedWhatsAppMessage(
      config.whatsappToken,
      config.phoneNumberId,
      from,
      "Something went wrong on our side. Please try again in a moment.",
      maxChunk,
    );
  }
}

function extractText(msg: WhatsAppMessage): string {
  if (msg.text?.body) return msg.text.body;
  // Captions on media count as text for our purposes.
  return (
    msg.image?.caption ??
    msg.video?.caption ??
    msg.document?.caption ??
    ""
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

type Attachment =
  | { type: "image_url"; url: string }
  | { type: "image_base64"; data: string; mime_type: string };

async function resolveAttachments(
  msg: WhatsAppMessage,
  config: WhatsAppHandlerConfig,
): Promise<Attachment[]> {
  const out: Attachment[] = [];

  // Images and image-like documents: download bytes ourselves (the Graph
  // CDN URL requires a Bearer token to fetch, so forwarding the raw URL
  // to Theo won't work). Forward as image_base64.
  if (msg.image?.id) {
    const attachment = await downloadWhatsAppImage(
      config.whatsappToken,
      msg.image.id,
      msg.image.mime_type ?? "image/jpeg",
    );
    if (attachment) out.push(attachment);
  }

  if (msg.document?.mime_type?.startsWith("image/") && msg.document.id) {
    const attachment = await downloadWhatsAppImage(
      config.whatsappToken,
      msg.document.id,
      msg.document.mime_type,
    );
    if (attachment) out.push(attachment);
  }

  // Voice/audio are NOT pushed as attachments — they are transcribed to
  // text and merged into the prompt by the caller.
  return out;
}

/**
 * Map WhatsApp-reported MIME types to the image MIMEs Theo accepts.
 */
function normalizeImageMime(
  mime: string,
): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  const lower = mime.toLowerCase();
  if (lower === "image/png") return "image/png";
  if (lower === "image/jpg" || lower === "image/jpeg") return "image/jpeg";
  if (lower === "image/webp") return "image/webp";
  if (lower === "image/gif") return "image/gif";
  return null;
}

async function fetchWhatsAppMedia(
  token: string,
  mediaId: string,
): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!fileRes.ok) return null;
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    return { bytes, mime: meta.mime_type ?? fileRes.headers.get("content-type") };
  } catch {
    return null;
  }
}

async function downloadWhatsAppImage(
  token: string,
  mediaId: string,
  fallbackMime: string,
): Promise<Attachment | null> {
  const file = await fetchWhatsAppMedia(token, mediaId);
  if (!file) return null;
  const mime = normalizeImageMime(file.mime ?? fallbackMime);
  if (!mime) return null;
  if (file.bytes.byteLength > 15 * 1024 * 1024) return null;
  const base64 = Buffer.from(file.bytes).toString("base64");
  return { type: "image_base64", data: base64, mime_type: mime };
}

async function transcribeWhatsAppVoice(
  token: string,
  mediaId: string,
  theo: Theo,
): Promise<string | null> {
  const file = await fetchWhatsAppMedia(token, mediaId);
  if (!file) return null;
  try {
    const buf = Buffer.from(file.bytes);
    const blob = new Blob([buf], {
      type: file.mime ?? "application/octet-stream",
    });
    const transcript = await theo.stt(blob);
    return transcript.text || null;
  } catch (err) {
    console.error("[theo-whatsapp] transcription failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending messages (with chunking)
// ---------------------------------------------------------------------------

async function sendChunkedWhatsAppMessage(
  token: string,
  phoneNumberId: string,
  to: string,
  text: string,
  maxChars: number,
): Promise<void> {
  if (!text) return;
  for (const chunk of chunkText(text, maxChars)) {
    await sendWhatsAppMessage(token, phoneNumberId, to, chunk);
  }
}

/**
 * Split text on paragraph/line boundaries where possible, falling back to
 * hard splits for single long lines.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const out: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf("\n\n", maxChars);
    if (splitAt < maxChars / 2) splitAt = remaining.lastIndexOf("\n", maxChars);
    if (splitAt < maxChars / 2) splitAt = remaining.lastIndexOf(" ", maxChars);
    if (splitAt <= 0) splitAt = maxChars;

    out.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\s+/, "");
  }

  if (remaining.length > 0) out.push(remaining);
  return out;
}

async function sendWhatsAppMessage(
  token: string,
  phoneNumberId: string,
  to: string,
  text: string,
): Promise<void> {
  await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    },
  );
}

export { Theo } from "@hitheo/sdk";
