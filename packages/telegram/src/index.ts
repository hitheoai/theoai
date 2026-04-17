/**
 * @hitheo/telegram - Telegram bot adapter for the Theo API.
 *
 * Bridges Telegram webhook updates to POST /api/v1/completions.
 * Deploy as a webhook handler in your own server/serverless function.
 *
 * Usage:
 *   import { createTelegramHandler } from "@hitheo/telegram";
 *   const handle = createTelegramHandler({
 *     theoApiKey: "theo_sk_...",
 *     telegramToken: "BOT_TOKEN",
 *     secretToken: "webhook_secret", // optional but recommended
 *   });
 *   // In your webhook route:
 *   await handle(req.body, {
 *     secretToken: req.header("X-Telegram-Bot-Api-Secret-Token"),
 *   });
 */

import { timingSafeEqual } from "node:crypto";
import { Theo } from "@hitheo/sdk";
import type { ChatMode, PersonaInput } from "@hitheo/sdk";

// ---------------------------------------------------------------------------
// Telegram types (minimal subset needed for the adapter)
// ---------------------------------------------------------------------------

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramFileRef {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  date: number;
  photo?: TelegramPhotoSize[];
  voice?: TelegramFileRef;
  audio?: TelegramFileRef;
  document?: TelegramFileRef;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

// ---------------------------------------------------------------------------
// Conversation store (pluggable; default in-memory)
// ---------------------------------------------------------------------------

export interface ConversationStore {
  get(chatId: string): Promise<string | null> | string | null;
  set(chatId: string, conversationId: string): Promise<void> | void;
  clear(chatId: string): Promise<void> | void;
}

function createMemoryStore(): ConversationStore {
  const map = new Map<string, string>();
  return {
    get: (chatId) => map.get(chatId) ?? null,
    set: (chatId, conversationId) => {
      map.set(chatId, conversationId);
    },
    clear: (chatId) => {
      map.delete(chatId);
    },
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TelegramHandlerConfig {
  theoApiKey: string;
  telegramToken: string;
  /**
   * Secret token shared with Telegram via setWebhook's `secret_token` parameter.
   * When set, inbound updates whose `X-Telegram-Bot-Api-Secret-Token` header
   * does not match are rejected with `TelegramSignatureError`.
   */
  secretToken?: string;
  theoBaseUrl?: string;
  mode?: ChatMode;
  persona?: PersonaInput;
  skills?: string[];
  /**
   * Conversation store for mapping Telegram chat IDs to Theo conversation IDs.
   * Defaults to an in-process `Map`. Swap for Redis/DB to persist across
   * instances.
   */
  conversationStore?: ConversationStore;
  /**
   * When true, voice and audio messages are forwarded to Theo as attachments
   * (Theo will transcribe them). Off by default because STT adds per-request
   * cost.
   */
  enableVoice?: boolean;
  /**
   * Max characters per outbound Telegram message. Telegram's hard limit is
   * 4096; we default to 4000 to leave headroom for markdown escaping.
   */
  maxChunkChars?: number;
}

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------

export interface TelegramRequestContext {
  /**
   * Value of the `X-Telegram-Bot-Api-Secret-Token` header, if present.
   * Required when `secretToken` is configured.
   */
  secretToken?: string | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TelegramSignatureError extends Error {
  constructor(message = "Invalid or missing X-Telegram-Bot-Api-Secret-Token") {
    super(message);
    this.name = "TelegramSignatureError";
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 4000;

export function createTelegramHandler(config: TelegramHandlerConfig) {
  const theo = new Theo({
    apiKey: config.theoApiKey,
    baseUrl: config.theoBaseUrl,
  });

  const store = config.conversationStore ?? createMemoryStore();
  const maxChunk = config.maxChunkChars ?? DEFAULT_MAX_CHARS;

  return async function handleUpdate(
    update: TelegramUpdate,
    context?: TelegramRequestContext,
  ): Promise<void> {
    // 1. Signature verification — constant-time compare so an attacker can't
    //    probe the secret via response-time side channels.
    if (config.secretToken) {
      if (!constantTimeEqual(context?.secretToken ?? null, config.secretToken)) {
        throw new TelegramSignatureError();
      }
    }

    // 2. Extract message (ignore channel_post and edited_message for now)
    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const chatKey = String(chatId);

    // 3. Built-in commands
    let text = message.text ?? message.caption ?? "";
    if (text.startsWith("/")) {
      await handleCommand(text, chatId, config.telegramToken, store, chatKey, maxChunk);
      return;
    }

    // 4. Resolve image attachments (photos + image documents) as base64.
    //    The adapter downloads media inside your deployment and forwards the
    //    bytes to Theo so Telegram's authenticated file URLs never leave the
    //    server that holds the bot token.
    const attachments = await resolveAttachments(message, config, theo);

    // 5. Voice / audio — transcribe with Theo STT and append to the prompt.
    //    Previously these were being tagged as `image_url`, which the server
    //    rejects for non-image attachments.
    if (config.enableVoice) {
      const voiceRef = message.voice ?? message.audio;
      if (voiceRef) {
        const transcript = await transcribeTelegramVoice(
          config.telegramToken,
          voiceRef.file_id,
          theo,
        );
        if (transcript) {
          text = text ? `${text}\n\n[voice]: ${transcript}` : transcript;
        }
      }
    }

    // 6. No meaningful content -> ignore
    if (!text && attachments.length === 0) return;

    try {
      const existingConversationId = await store.get(chatKey);

      // theo.complete's type doesn't expose attachments yet, but the API
      // accepts them. Cast via a loose type to bypass the SDK shape until
      // it's updated upstream.
      const request: Record<string, unknown> = {
        prompt: text || "(user sent an attachment without text)",
        mode: config.mode ?? "auto",
        persona: config.persona,
        skills: config.skills,
        conversation_id: existingConversationId ?? undefined,
        metadata: {
          channel: "telegram",
          telegram_chat_id: chatKey,
          telegram_user_id: String(message.from?.id ?? ""),
        },
      };
      if (attachments.length > 0) request.attachments = attachments;

      const result = await theo.complete(
        request as unknown as Parameters<typeof theo.complete>[0],
      );

      // Persist the conversation id from the response metadata (if present).
      const conversationId =
        (result as { conversation_id?: string }).conversation_id ??
        ((result.metadata as Record<string, unknown> | null)?.conversation_id as
          | string
          | undefined);
      if (conversationId && !existingConversationId) {
        await store.set(chatKey, conversationId);
      }

      await sendChunkedMessage(
        config.telegramToken,
        chatId,
        result.content,
        maxChunk,
      );
    } catch (err) {
      // Log the detail server-side, but don't echo raw error text (which can
      // include internal details, status codes, or response bodies) to the
      // end user.
      console.error("[theo-telegram] completion failed:", err);
      await sendChunkedMessage(
        config.telegramToken,
        chatId,
        "Something went wrong on our side. Please try again in a moment.",
        maxChunk,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function constantTimeEqual(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function handleCommand(
  text: string,
  chatId: number,
  token: string,
  store: ConversationStore,
  chatKey: string,
  maxChunk: number,
): Promise<void> {
  const [cmdRaw] = text.split(/\s+/, 1);
  const cmd = (cmdRaw ?? "").split("@")[0]!.toLowerCase();

  switch (cmd) {
    case "/start":
      await sendChunkedMessage(
        token,
        chatId,
        "Hi! I'm powered by Theo. Just send me a message and I'll respond. Use /reset to clear our conversation or /help to see what I can do.",
        maxChunk,
      );
      return;
    case "/reset":
      await store.clear(chatKey);
      await sendChunkedMessage(
        token,
        chatId,
        "Conversation cleared. Next message starts fresh.",
        maxChunk,
      );
      return;
    case "/help":
      await sendChunkedMessage(
        token,
        chatId,
        [
          "Commands:",
          "/start - introduction",
          "/reset - clear conversation history",
          "/help  - show this message",
          "",
          "Send any text, photo, or document and I'll respond with Theo.",
        ].join("\n"),
        maxChunk,
      );
      return;
    default:
      await sendChunkedMessage(
        token,
        chatId,
        "Unknown command. Try /help.",
        maxChunk,
      );
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

type Attachment =
  | { type: "image_url"; url: string }
  | { type: "image_base64"; data: string; mime_type: string };

async function resolveAttachments(
  message: TelegramMessage,
  config: TelegramHandlerConfig,
  theo: Theo,
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];

  // Photos: Telegram returns an array of sizes; pick the largest, download
  // the bytes, and forward as base64 so the bot token never leaves this
  // process in a URL path.
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) =>
      (a.file_size ?? a.width * a.height) > (b.file_size ?? b.width * b.height) ? a : b,
    );
    const attachment = await downloadTelegramFileAsAttachment(
      config.telegramToken,
      largest.file_id,
      "image/jpeg",
    );
    if (attachment) attachments.push(attachment);
  }

  // Documents: only forward if image-like. Same base64 path.
  if (message.document?.mime_type?.startsWith("image/")) {
    const attachment = await downloadTelegramFileAsAttachment(
      config.telegramToken,
      message.document.file_id,
      message.document.mime_type,
    );
    if (attachment) attachments.push(attachment);
  }

  // NOTE: voice/audio are NOT pushed into `attachments` here. They are
  // transcribed to text by `transcribeTelegramVoice` in the caller so the
  // Theo completion gets the transcript as prompt text.
  void theo;
  return attachments;
}

/**
 * Map Telegram MIME types Theo accepts as images.
 * The `/api/v1/completions` schema only allows `image/png`, `image/jpeg`,
 * `image/webp`, `image/gif` for `image_base64`.
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

/**
 * Resolve a Telegram file_id to a Blob by calling getFile + downloading the
 * content with the bot token in an Authorization-adjacent URL, but keeping
 * the URL purely internal. We never forward this URL outside the adapter.
 */
async function fetchTelegramFile(
  token: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  try {
    const meta = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    const data = (await meta.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    if (!data.ok || !data.result?.file_path) return null;

    const fileRes = await fetch(
      `https://api.telegram.org/file/bot${token}/${data.result.file_path}`,
    );
    if (!fileRes.ok) return null;
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    const mime = fileRes.headers.get("content-type");
    return { bytes: buf, mime };
  } catch {
    return null;
  }
}

async function downloadTelegramFileAsAttachment(
  token: string,
  fileId: string,
  fallbackMime: string,
): Promise<Attachment | null> {
  const file = await fetchTelegramFile(token, fileId);
  if (!file) return null;

  const mime = normalizeImageMime(file.mime ?? fallbackMime);
  if (!mime) return null;

  // Reject images > 15MB (server's base64 ceiling after ³33% encoding
  // overhead leaves ~15MB of source bytes).
  if (file.bytes.byteLength > 15 * 1024 * 1024) return null;

  const base64 = Buffer.from(file.bytes).toString("base64");
  return { type: "image_base64", data: base64, mime_type: mime };
}

async function transcribeTelegramVoice(
  token: string,
  fileId: string,
  theo: Theo,
): Promise<string | null> {
  const file = await fetchTelegramFile(token, fileId);
  if (!file) return null;
  try {
    const buf = Buffer.from(file.bytes);
    const blob = new Blob([buf], {
      type: file.mime ?? "application/octet-stream",
    });
    const transcript = await theo.stt(blob);
    return transcript.text || null;
  } catch (err) {
    console.error("[theo-telegram] transcription failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending messages (with Markdown fallback + chunking)
// ---------------------------------------------------------------------------

async function sendChunkedMessage(
  token: string,
  chatId: number,
  text: string,
  maxChars: number,
): Promise<void> {
  if (!text) return;
  const chunks = chunkText(text, maxChars);
  for (const chunk of chunks) {
    await sendTelegramMessage(token, chatId, chunk);
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
    // Prefer last double-newline, then newline, then space within the window.
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

/**
 * Send a Telegram message using Markdown. If Telegram rejects the markup
 * (ok=false with a parse-mode error), retry as plain text.
 */
async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  const payload = (extra: Record<string, unknown>) =>
    JSON.stringify({ chat_id: chatId, text, ...extra });

  const tryParseMode = async (parseMode?: string) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: parseMode ? payload({ parse_mode: parseMode }) : payload({}),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    return data;
  };

  const first = await tryParseMode("Markdown");
  if (first.ok) return;

  const desc = (first.description ?? "").toLowerCase();
  const isParseError =
    desc.includes("parse") ||
    desc.includes("can't parse") ||
    desc.includes("entities");
  if (isParseError) {
    // Retry without parse_mode so entities are sent as literal text.
    await tryParseMode(undefined);
  }
  // If the failure wasn't a parse-mode issue (e.g. chat not found), we
  // intentionally swallow it — the caller can't do anything useful with it
  // from inside a webhook handler.
}

export { Theo } from "@hitheo/sdk";
