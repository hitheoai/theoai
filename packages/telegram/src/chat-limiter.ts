/**
 * Per-chat rate limiter + inbound-message dedup.
 *
 * The Theo API enforces per-key rate limits at the server, but the channel
 * adapters still need a client-side guard against two abuse patterns:
 *
 *   1. A compromised chat floods us with messages. Server-side rate limits
 *      fire, but every request is already charged against our upstream
 *      provider fetch budget (and we'll have paid for one Theo completion
 *      per request). A per-chat burst cap cuts the bleed at the source.
 *   2. Telegram re-delivers the same update if our webhook handler times
 *      out. Without dedup on `message_id`, we'd call Theo twice for the
 *      same text.
 *
 * Both are implemented as pluggable interfaces so an operator can swap the
 * default in-memory implementation for Redis / DB without forking.
 */

export interface ChatRateLimiter {
  /**
   * Allow/deny the next message for `chatKey`. Returns true when the
   * caller should proceed. The default limiter enforces `maxPerWindow`
   * messages per `windowMs`.
   */
  allow(chatKey: string): Promise<boolean> | boolean;
}

export interface MessageDedup {
  /**
   * Returns true if this messageId has already been processed for the
   * given chat. Must be idempotent \u2014 calling twice with the same inputs
   * is safe.
   */
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

      // Soft cap on distinct chats so long-running processes don't grow
      // unbounded. Evict the first key we iterate \u2014 imperfect LRU but
      // bounded work per call.
      if (buckets.size > chatCapacity) {
        const firstKey = buckets.keys().next().value;
        if (firstKey !== undefined) buckets.delete(firstKey);
      }

      return recent.length <= maxPerWindow;
    },
  };
}

export interface InMemoryDedupOptions {
  /** Max distinct messageIds per chat retained for dedup. Default: 128. */
  historyPerChat?: number;
  /** How many chats to track before evicting. Default: 5000. */
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
