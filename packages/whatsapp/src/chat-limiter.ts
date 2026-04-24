/**
 * Per-chat rate limiter + inbound-message dedup for the WhatsApp adapter.
 * Mirrors the companion helper in `@hitheo/telegram` so the protections
 * stay aligned across channels.
 */

export interface ChatRateLimiter {
  allow(chatKey: string): Promise<boolean> | boolean;
}

export interface MessageDedup {
  seen(chatKey: string, messageId: string): Promise<boolean> | boolean;
}

export interface InMemoryChatLimiterOptions {
  /** Max inbound messages per window. Default: 20. */
  maxPerWindow?: number;
  /** Window length in ms. Default: 60_000 (1 minute). */
  windowMs?: number;
  /** How many distinct chats to track before evicting. Default: 5000. */
  chatCapacity?: number;
}

export function createInMemoryChatRateLimiter(
  options: InMemoryChatLimiterOptions = {},
): ChatRateLimiter {
  const maxPerWindow = options.maxPerWindow ?? 20;
  const windowMs = options.windowMs ?? 60_000;
  const chatCapacity = options.chatCapacity ?? 5_000;

  const buckets = new Map<string, number[]>();

  return {
    allow(chatKey: string): boolean {
      const now = Date.now();
      const windowStart = now - windowMs;
      const existing = buckets.get(chatKey) ?? [];
      const recent = existing.filter((t) => t > windowStart);
      recent.push(now);
      buckets.set(chatKey, recent);

      if (buckets.size > chatCapacity) {
        const firstKey = buckets.keys().next().value;
        if (firstKey !== undefined) buckets.delete(firstKey);
      }

      return recent.length <= maxPerWindow;
    },
  };
}

export interface InMemoryDedupOptions {
  historyPerChat?: number;
  chatCapacity?: number;
}

export function createInMemoryMessageDedup(
  options: InMemoryDedupOptions = {},
): MessageDedup {
  const historyPerChat = options.historyPerChat ?? 128;
  const chatCapacity = options.chatCapacity ?? 5_000;

  const seen = new Map<string, Set<string>>();
  const insertionOrder = new Map<string, string[]>();

  return {
    seen(chatKey: string, messageId: string): boolean {
      let chatSet = seen.get(chatKey);
      let order = insertionOrder.get(chatKey);
      if (!chatSet) {
        chatSet = new Set();
        order = [];
        seen.set(chatKey, chatSet);
        insertionOrder.set(chatKey, order);
      }

      if (chatSet.has(messageId)) return true;

      chatSet.add(messageId);
      order!.push(messageId);
      if (order!.length > historyPerChat) {
        const evict = order!.shift();
        if (evict !== undefined) chatSet.delete(evict);
      }

      if (seen.size > chatCapacity) {
        const firstKey = seen.keys().next().value;
        if (firstKey !== undefined) {
          seen.delete(firstKey);
          insertionOrder.delete(firstKey);
        }
      }

      return false;
    },
  };
}
