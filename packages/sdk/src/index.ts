/**
 * @hitheo/sdk - Official TypeScript SDK for the Theo AI orchestration API.
 *
 * Usage:
 *   import { Theo } from "@hitheo/sdk";
 *   const theo = new Theo({ apiKey: "theo_sk_..." });
 *   const result = await theo.complete({ prompt: "Hello", mode: "auto" });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMode =
  | "auto" | "fast" | "think" | "image" | "video"
  | "code" | "research" | "roast" | "genui"
  | "data_extraction";

export type PersonaInput = "theo" | "none" | { system_prompt: string };

// ---------------------------------------------------------------------------
// Personality / response style (mirrors the server's per-request overrides)
// ---------------------------------------------------------------------------

export interface PersonalityConfigInput {
  traits: {
    romantic: number;
    intelligent: number;
    sarcastic: number;
    rude: number;
    funny: number;
    comedic: number;
    witty: number;
  };
  uncensored_mode: boolean;
  active_preset_id: string | null;
}

export interface ResponseStyleInput {
  format: string;
  preciseness: string;
  intent: string;
}

// ---------------------------------------------------------------------------
// Attachments + stealth media pins
// ---------------------------------------------------------------------------

export type CompletionAttachment =
  | { type: "image_url"; url: string }
  | { type: "image_base64"; data: string; mime_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif" };

export type TheoImageEngine =
  | "auto"
  | "theo-1-create"
  | "theo-1-photo"
  | "theo-1-rapid"
  | "theo-1-design"
  | "theo-1-studio"
  | "theo-1-type";

export type TheoImageQuality = "draft" | "standard" | "hd";

export type TheoStealthAspect = "square" | "portrait" | "landscape" | "wide";
export type TheoStealthDuration = "5s" | "6s" | "10s";

// ---------------------------------------------------------------------------
// Inline conversation envelope (for stateless callers)
// ---------------------------------------------------------------------------

export interface InlineConversationMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  mode?: ChatMode;
  artifacts?: Array<Record<string, unknown>>;
}

export interface InlineConversation {
  id?: string;
  title?: string;
  messages: InlineConversationMessage[];
}

export interface CompletionRequest {
  prompt: string;
  mode?: ChatMode;
  conversation_id?: string | null;
  /**
   * Inline conversation envelope. Use when you don't want to persist a
   * server-side conversation but still need multi-turn context for
   * deictic references ("make it longer", "try a different angle").
   */
  conversation?: InlineConversation;
  skills?: string[];
  tools?: Array<{
    name: string;
    description: string;
    input_schema?: Record<string, unknown>;
  }>;
  model_overrides?: Record<string, string>;
  stream?: boolean;
  persona?: PersonaInput;
  /** Per-request personality config override. */
  personality_config?: PersonalityConfigInput;
  /** Per-request response style override. */
  response_style?: ResponseStyleInput;
  /** Set to false to strip Theo personality/branding from this response. */
  theo_branding?: boolean;
  /** Set to false to disable the API key's Brand Soul for this request. */
  brand_soul?: boolean;
  max_iterations?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
  /** Response format. "theo" (default) or "openai" for ChatCompletion-compatible responses. */
  format?: "theo" | "openai";
  /** Custom OpenUI component library identifier for GenUI mode. */
  component_library?: string;
  /** Image attachments for vision analysis. */
  attachments?: CompletionAttachment[];
  /** Theo image sub-engine to route through when mode resolves to `image`. */
  image_model?: TheoImageEngine;
  /** Image quality tier. Ignored for non-image modes. */
  image_quality?: TheoImageQuality;
  /** Stealth model pin. Ignored outside `stealth_*` modes. */
  stealth_model?: string;
  /** Stealth image aspect ratio. Ignored outside `stealth_image`. */
  stealth_aspect?: TheoStealthAspect;
  /** Stealth video duration. Ignored outside `stealth_video`. */
  stealth_duration?: TheoStealthDuration;
}

export interface CompletionUsage {
  /** Total cost of this completion in cents (markup-inclusive). */
  cost_cents: number;
  /** Prompt token count. Always 0 for non-text modes (image, video, tts). */
  prompt_tokens: number;
  /** Completion token count. Always 0 for non-text modes. */
  completion_tokens: number;
  /** Sum of prompt + completion tokens. */
  total_tokens: number;
  /** True when the response came from the semantic cache. */
  cached?: boolean;
}

export interface CompletionResponse {
  id: string;
  object: string;
  created: string;
  content: string;
  mode: ChatMode;
  resolved_mode: ChatMode;
  /** Model info uses Theo-branded identifiers (e.g. "theo-1-reason"). */
  model: { id: string; label: string; engine: string };
  tools_used: Array<{ name: string; status: string; description?: string }>;
  artifacts: unknown[];
  follow_ups: Array<{ label: string; prompt: string }>;
  usage: CompletionUsage;
  metadata: Record<string, unknown> | null;
  /**
   * Server-assigned request identifier. Mirrors the `X-Request-Id`
   * response header. Include this in support tickets to let us look
   * the request up in logs.
   */
  request_id?: string;
  /** When the response resolves to a persisted server-side conversation. */
  conversation_id?: string | null;
}

// ---------------------------------------------------------------------------
// Streaming event shapes (discriminated union)
// ---------------------------------------------------------------------------

/** Payload of the first `meta` event on a stream. */
export interface StreamMetaData {
  id: string;
  mode: ChatMode;
  resolved_mode: ChatMode;
  model: { id: string; label: string; engine: string };
  tools: Array<{ name: string; status: string; description?: string }>;
  artifacts: unknown[];
  brand?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  conversation_id?: string | null;
  request_id?: string;
}

/** Payload of an individual `token` event. */
export interface StreamTokenData {
  token: string;
}

/** Payload of a `tool` event. */
export interface StreamToolData {
  name: string;
  status: string;
  description?: string;
}

/** Payload of a `skills` event. */
export interface StreamSkillsData {
  active: Array<{ id: string; slug: string; name: string; intensity?: number }>;
}

/** Payload of the final `done` event. */
export interface StreamDoneData {
  id: string;
  content: string;
  follow_ups: Array<{ label: string; prompt: string }>;
  structured_output?: { type: string; data: unknown; parse_error?: string };
  skills_active?: Array<{ id: string; slug: string; name: string; intensity?: number }>;
  routing?: Record<string, unknown>;
  usage: CompletionUsage;
  conversation_id?: string | null;
  request_id?: string;
}

/** Payload of the `error` event. Matches the REST error envelope. */
export interface StreamErrorData {
  error: {
    message: string;
    type: string;
    code: string;
    request_id: string | null;
  };
}

/** Metadata event emitted when the response uses GenUI mode (OpenUI Lang). */
export interface GenUIMetaEvent {
  /** Component library identifier (e.g. "theo" for the built-in Theo library). */
  library: string;
  /** Tool names available for the Renderer's toolProvider. */
  tools: string[];
}

export type StreamEvent =
  | { type: "meta"; data: StreamMetaData }
  | { type: "token"; data: StreamTokenData; token: string }
  | { type: "tool"; data: StreamToolData }
  | { type: "artifact"; data: Record<string, unknown> }
  | { type: "genui_meta"; data: GenUIMetaEvent }
  | { type: "skills"; data: StreamSkillsData }
  | { type: "done"; data: StreamDoneData }
  | { type: "error"; data: StreamErrorData };

/** Extended completion response when mode === "genui". */
export interface GenUICompletionResponse extends CompletionResponse {
  /** Raw OpenUI Lang source code (same as content for genui mode). */
  genui_code: string;
}

export interface ModelInfo {
  mode: string;
  /** Theo-branded model ID (e.g. "theo-1-flash", "theo-1-reason"). */
  model_id: string;
  label: string;
  /** Theo engine subsystem (e.g. "theo-core", "theo-vision"). */
  engine: string;
  description: string;
  /** URL to the Theo mascot emoji image (can be used as bot avatar in channels). */
  icon_url?: string;
}

// --- Images ---

export interface ImageRequest {
  prompt: string;
  style?: string;
  aspect_ratio?: string;
  count?: number;
}

export interface ImageResponse {
  id: string;
  created: string;
  images: Array<{ url: string | null; engine: string; prompt: string }>;
  usage: { cost_cents: number };
}

// --- Video ---

export interface VideoRequest {
  prompt: string;
  duration?: string;
  style?: string;
}

// --- Code ---

export interface CodeRequest {
  prompt: string;
  language?: string;
  framework?: string;
}

export interface CodeResponse {
  id: string;
  created: string;
  content: string;
  artifacts: unknown[];
  tools_used: Array<{ name: string; status: string }>;
  usage: { cost_cents: number };
}

// --- Research ---

export interface ResearchRequest {
  prompt: string;
  depth?: "basic" | "advanced";
  max_sources?: number;
}

// --- Documents ---

export interface DocumentRequest {
  prompt: string;
  format?: "pdf" | "docx" | "pptx" | "xlsx" | "csv";
}

export interface DocumentResponse {
  id: string;
  created: string;
  format: string;
  title: string;
  download_url: string | null;
  size_bytes: number | null;
  content: string;
  usage: { cost_cents: number };
}

// --- Audio ---

export interface TtsRequest {
  text: string;
  voice?: string;
  speed?: number;
}

export interface SttResponse {
  id: string;
  created: string;
  text: string;
  language: string | null;
  duration_seconds: number | null;
  usage: { cost_cents: number };
}

// --- Async jobs ---

export interface AsyncJobResponse {
  id: string;
  job_id: string;
  status: "queued";
  created: string;
  poll_url: string;
}

export interface JobStatus {
  id: string;
  type: string;
  status: "queued" | "active" | "completed" | "failed";
  progress: number;
  result: unknown | null;
  error: string | null;
  created_at: string | null;
  completed_at: string | null;
}

// --- Theo Browser (headless browser sessions) ---

export type BrowserRegion =
  | "us-west-2"
  | "us-east-1"
  | "eu-central-1"
  | "ap-southeast-1";

export interface BrowserCreateRequest {
  /** Optional starting URL (navigated to immediately after launch). */
  url?: string;
  /** Keep the session alive across disconnections. Default: false. */
  keep_alive?: boolean;
  /** Route the session through Theo's residential proxy pool (billed higher). */
  proxies?: boolean;
  /** Datacenter region to launch the session in. Default: us-west-2. */
  region?: BrowserRegion;
}

export interface BrowserSessionHandle {
  session_id: string;
  /**
   * Iframe-embeddable live view URL for the Theo-branded browser window.
   * Short-lived — refresh via `theo.browser.live(id, { force: true })`
   * whenever the embedded live view signals a disconnect.
   */
  live_view_url: string | null;
  /**
   * Drop-in branded embed URL that third-party apps can iframe into
   * their own product without building UI. Backed by a short-lived
   * signed token and served from `/embed/browser/:sessionId`.
   */
  embed_url?: string | null;
  region: BrowserRegion;
  keep_alive: boolean;
  started_at: string;
  expires_at: string;
}

export interface BrowserSessionSnapshot extends BrowserSessionHandle {
  current_url?: string | null;
  current_title?: string | null;
  favicon_url?: string | null;
  last_active_at?: string;
  proxies?: boolean;
}

export interface BrowserLiveView {
  session_id: string;
  live_view_url: string;
  /**
   * Monotonic counter — clients should rekey their iframe whenever
   * this advances, even if `live_view_url` appears identical. Theo
   * bumps the counter every time a tool call may have invalidated
   * the underlying CDP target.
   */
  live_view_version: number;
  pages: Array<{
    id: string;
    url: string;
    title: string;
    favicon_url: string;
  }>;
}

export interface BrowserEndResult {
  session_id: string;
  duration_seconds: number;
  proxy_bytes: number;
  cost_cents: number;
}

// --- Health ---

export interface HealthResponse {
  status: "healthy" | "degraded" | "down";
  timestamp: string;
  version: string;
  /** Theo engine subsystems (e.g. "theo-core", "theo-vision", "theo-search"). */
  providers: Record<string, { status: string }>;
}

// --- Skill Manifest ---

export type SkillCategory = "productivity" | "domain" | "integration" | "automation" | "creative";

export type SkillPermission =
  | "read:conversations"
  | "read:artifacts"
  | "write:artifacts"
  | "write:notes"
  | "external:http"
  | "execute:tools"
  | "autonomous:run";

export type SkillTriggerType = "manual" | "keyword" | "event" | "schedule";

export interface SkillToolInput {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissionLevel?: "user" | "org_member" | "org_admin" | "system";
  requiresApproval?: boolean;
}

export interface SkillTriggerInput {
  type: SkillTriggerType;
  config?: Record<string, unknown>;
}

export interface SkillManifestInput {
  name: string;
  slug: string;
  version: string;
  description: string;
  category: SkillCategory;
  author: { name: string; email?: string; url?: string };
  systemPromptExtension: string;
  tools?: SkillToolInput[];
  permissions?: SkillPermission[];
  knowledge?: string[];
  modelPreference?: string;
  trigger?: SkillTriggerInput;
  hooks?: { onInstall?: string; onUninstall?: string };
  readme?: string;
  changelog?: string;
  license?: string;
  repository?: string;
  keywords?: string[];
}

export interface SkillManifest extends Required<Pick<SkillManifestInput,
  "name" | "slug" | "version" | "description" | "category" | "author" | "systemPromptExtension"
>> {
  tools: SkillToolInput[];
  permissions: SkillPermission[];
  knowledge: string[];
  modelPreference?: string;
  trigger?: SkillTriggerInput;
  hooks?: { onInstall?: string; onUninstall?: string };
  readme?: string;
  changelog?: string;
  license: string;
  repository?: string;
  keywords: string[];
}

/**
 * Type-safe builder for Theo skill manifests.
 *
 * Usage:
 *   import { defineSkill } from "@hitheo/sdk";
 *
 *   export default defineSkill({
 *     name: "inventory-check",
 *     slug: "inventory-check",
 *     version: "1.0.0",
 *     description: "Real-time inventory lookup and reorder alerts",
 *     category: "automation",
 *     author: { name: "Acme Corp" },
 *     systemPromptExtension: "You are an inventory specialist...",
 *     tools: [{ name: "check_stock", description: "Look up current stock levels" }],
 *     permissions: ["read:artifacts", "external:http"],
 *   });
 */
export function defineSkill(input: SkillManifestInput): SkillManifest {
  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(input.slug)) {
    throw new Error(`Invalid slug "${input.slug}": must be lowercase alphanumeric with hyphens, no leading/trailing hyphens.`);
  }

  // Validate semver
  if (!/^\d+\.\d+\.\d+$/.test(input.version)) {
    throw new Error(`Invalid version "${input.version}": must follow semver (e.g. 1.0.0).`);
  }

  // Validate tool names
  for (const tool of input.tools ?? []) {
    if (!/^[a-z0-9_]+$/.test(tool.name)) {
      throw new Error(`Invalid tool name "${tool.name}": must be lowercase alphanumeric with underscores.`);
    }
  }

  return {
    name: input.name,
    slug: input.slug,
    version: input.version,
    description: input.description,
    category: input.category,
    author: input.author,
    systemPromptExtension: input.systemPromptExtension,
    tools: input.tools ?? [],
    permissions: input.permissions ?? [],
    knowledge: input.knowledge ?? [],
    modelPreference: input.modelPreference,
    trigger: input.trigger,
    hooks: input.hooks,
    readme: input.readme,
    changelog: input.changelog,
    license: input.license ?? "MIT",
    repository: input.repository,
    keywords: input.keywords ?? [],
  };
}

// --- E.V.I. Canvas ---

export type CanvasVisibility = "private" | "org" | "public";
export type CanvasStatus = "draft" | "testing" | "published";

export interface CanvasRecord {
  id: string;
  name: string;
  description: string | null;
  status: CanvasStatus;
  graphJson: { nodes: unknown[]; edges: unknown[] };
  compiledManifest: unknown | null;
  compiledWorkflowSteps: unknown[] | null;
  isPublic: boolean;
  publishedSkillId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCanvasInput {
  name: string;
  description?: string;
  graph_json?: { nodes: unknown[]; edges: unknown[] };
}

export interface UpdateCanvasInput {
  name?: string;
  description?: string;
  graph_json?: { nodes: unknown[]; edges: unknown[] };
  is_public?: boolean;
}

export interface PublishCanvasInput {
  slug: string;
  version: string;
  author: { name: string; email?: string; url?: string };
  /** Publishing visibility: "private" (author-only), "org" (org members), "public" (marketplace). */
  visibility?: CanvasVisibility;
  /** Required when visibility is "org". */
  target_org_id?: string;
  readme?: string;
  license?: string;
  keywords?: string[];
}

export interface CanvasCompileResult {
  compiled: boolean;
  manifest: unknown | null;
  steps: unknown[] | null;
  errors: Array<{ code: string; message: string; nodeId?: string }>;
}

export interface CanvasTestResult {
  response: string | null;
  cost_cents: number;
  errors?: Array<{ code: string; message: string }>;
}

export interface CanvasPublishResult {
  published: boolean;
  visibility: CanvasVisibility;
  submission: {
    id: string;
    status: string;
    reviewTier: string;
    autoApproved: boolean;
  } | null;
  skillId: string | null;
}

// --- E.V.I. (Embedded Virtual Intelligence) ---

/**
 * Configuration for an E.V.I. instance — Theo embedded in your product
 * with a custom persona, pre-configured skills, and inline tools.
 *
 * Usage:
 *   const evi = theo.evi({
 *     persona: "You are Nova, an AI assistant for WarehouseOS...",
 *     skills: ["inventory-check"],
 *     tools: [{ name: "check_stock", description: "..." }],
 *   });
 *   const res = await evi.complete({ prompt: "Check stock levels" });
 */
export interface EviConfig {
  /** Custom persona prompt. Replaces Theo's default personality entirely. */
  persona: string;
  /** Skill slugs to activate on every completion (merged with user's installed skills). */
  skills?: string[];
  /** Inline tool definitions available on every completion. */
  tools?: Array<{
    name: string;
    description: string;
    input_schema?: Record<string, unknown>;
  }>;
  /** Default mode override for all completions (default: "auto"). */
  defaultMode?: ChatMode;
  /** Default temperature for all completions. */
  defaultTemperature?: number;
  /** Metadata attached to every completion for tracking/attribution. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Typed record shapes for list/get endpoints
// ---------------------------------------------------------------------------

/** Compact conversation metadata returned by `GET /api/v1/conversations`. */
export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
}

/** Message record attached to a conversation detail response. */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  mode?: ChatMode;
  resolvedMode?: ChatMode;
  model?: { id: string; label: string; engine?: string };
  tools?: Array<{ id?: string; toolName: string; status: string; description?: string }>;
  artifacts?: unknown[];
  followUps?: Array<{ label: string; prompt: string }>;
  status?: string;
  errorMessage?: string;
  costCents?: number;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

/** Cursor-paginated response from `GET /api/v1/conversations`. */
export interface ConversationListResponse {
  conversations: ConversationSummary[];
  has_more: boolean;
  next_cursor: string | null;
}

/** Skill summary returned by `GET /api/v1/skills`. */
export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  isPublic: boolean;
  installCount: number;
  version: string;
  toolDefinitions?: unknown;
  requiredPermissions?: unknown;
  configSchema?: unknown;
  setupGuide?: string | null;
  comingSoon?: boolean;
  readme?: string | null;
  authorUserId?: string | null;
  orgScopeId?: string | null;
}

/** Tool definition returned by `GET /api/v1/tools`. */
export interface SdkToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissionLevel: "user" | "org_member" | "org_admin" | "system";
  requiresApproval: boolean;
  skillId?: string | null;
  category?: string;
}

/** Workflow record returned by `GET /api/v1/workflows`. */
export interface WorkflowRecord {
  id: string;
  userId?: string;
  name: string;
  triggerType: "schedule" | "event" | "manual";
  triggerConfig: Record<string, unknown>;
  steps: unknown[];
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "paused";
  stepsCompleted?: number;
  error?: string | null;
  startedAt?: string;
  completedAt?: string | null;
}

/** Skill submission record for marketplace review. */
export interface SubmissionRecord {
  id: string;
  status: string;
  reviewTier: string;
  autoApproved: boolean;
  skillId?: string | null;
  manifestVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Published version record for a skill. */
export interface SkillVersion {
  id: string;
  version: string;
  createdAt: string;
  changelog?: string | null;
}

/** Webhook endpoint record. */
export interface WebhookRecord {
  id: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Only returned on creation — never again. Store it immediately. */
  signingSecret?: string;
}

/** Webhook delivery attempt record. */
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  statusCode: number | null;
  responseBody?: string | null;
  attemptCount: number;
  deliveredAt: string | null;
  error?: string | null;
}

/** Hook record (autonomous skill trigger). */
export interface HookRecord {
  id: string;
  userId?: string;
  hookPresetId?: string | null;
  eventPattern?: string | null;
  skillSlug: string;
  enabled: boolean;
  cooldownMinutes?: number | null;
  createdAt?: string;
}

export interface HookExecution {
  id: string;
  hookId: string;
  status: string;
  eventId?: string;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

/** Domain event acknowledgement returned by `POST /api/v1/events`. */
export interface EventAck {
  id: string;
  accepted: boolean;
  matchedHooks?: number;
  matchedWebhooks?: number;
}

/** Aggregated usage report from `GET /api/v1/usage`. */
export interface UsageReport {
  period: { from: string; to: string };
  totals: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_cents: number;
  };
  by_mode?: Record<string, { requests: number; cost_cents: number }>;
  by_model?: Record<string, { requests: number; cost_cents: number }>;
}

/** Result of `theo.verify()` — first-run connectivity + auth diagnostic. */
export interface VerifyResult {
  healthy: boolean;
  authenticated: boolean;
  baseUrl: string;
  latencyMs: number;
  modelCount?: number;
  version?: string;
  error?: string;
  /** Human-friendly remediation hint when `healthy` or `authenticated` is false. */
  hint?: string;
}

// --- Client config ---

export interface TheoConfig {
  apiKey: string;
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30_000). */
  timeoutMs?: number;
  /** Max retry attempts on 429/5xx errors (default: 2). */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class Theo {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: TheoConfig) {
    this.apiKey = config.apiKey;
    // Default to the canonical `www` host. The apex `hitheo.ai` currently
    // 307-redirects to `www`; most HTTP clients (including `fetch`) strip
    // the `Authorization` header on 3xx responses, which produced a
    // confusing 401 on the very first call. Hitting `www` directly avoids
    // the redirect entirely. Set `baseUrl` explicitly if you need to
    // override (e.g. a staging host).
    this.baseUrl = (config.baseUrl ?? "https://www.hitheo.ai").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  // ── Completions ──

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const res = await this.fetch("/api/v1/completions", {
      method: "POST",
      body: JSON.stringify({ ...request, stream: false }),
    });
    const body = (await res.json()) as CompletionResponse;
    const headerRequestId = res.headers.get("x-request-id");
    if (headerRequestId && !body.request_id) {
      body.request_id = headerRequestId;
    }
    return body;
  }

  /**
   * Stream a completion via SSE. Returns a `TheoStream` that you can
   * `for await` over, cancel mid-flight, and read final metadata
   * (`conversationId`, `usage`, `model`, `requestId`) from once the
   * stream completes.
   */
  stream(request: CompletionRequest): TheoStream {
    return new TheoStream((signal) =>
      this.fetch("/api/v1/completions", {
        method: "POST",
        body: JSON.stringify({ ...request, stream: true }),
        signal,
      }),
    );
  }

  // ── Verify (first-run connectivity + auth diagnostic) ──

  /**
   * First-run diagnostic: checks `/health` and an authenticated
   * `/models` call. Returns a structured diagnosis with actionable
   * hints on failure (redirect-related 401, invalid API key, wrong
   * `baseUrl`, network down, etc.).
   */
  async verify(): Promise<VerifyResult> {
    const start = Date.now();
    let health: HealthResponse | null = null;
    try {
      health = await this.health();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        healthy: false,
        authenticated: false,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - start,
        error: msg,
        hint:
          `Could not reach ${this.baseUrl}/api/v1/health. Check that you can resolve the host from this machine, ` +
          `and confirm the SDK \`baseUrl\` matches an API-serving origin (not a 3xx redirect target).`,
      };
    }
    try {
      const models = await this.models();
      return {
        healthy: health.status !== "down",
        authenticated: true,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - start,
        modelCount: models.length,
        version: health.version,
      };
    } catch (err) {
      const apiErr = err as TheoApiError;
      const status = typeof apiErr.status === "number" ? apiErr.status : 0;
      let hint: string | undefined;
      if (status === 401) {
        hint =
          "Authentication failed. Confirm your API key starts with `theo_sk_` and is not revoked. " +
          "If the baseUrl 3xx-redirects to another host, some fetch clients strip the Authorization " +
          "header — use an API-serving host directly (the SDK now defaults to https://www.hitheo.ai).";
      } else if (status === 403) {
        hint = "Key authenticated but missing the `completions` scope. Re-issue the key with the required scopes.";
      } else if (status === 0) {
        hint = "Network error. Is a proxy, firewall, or VPN blocking outbound HTTPS?";
      }
      return {
        healthy: health.status !== "down",
        authenticated: false,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - start,
        version: health.version,
        error: apiErr.message ?? String(err),
        hint,
      };
    }
  }

  // ── Models ──

  async models(): Promise<ModelInfo[]> {
    const res = await this.fetch("/api/v1/models");
    const data = await res.json();
    return data.models;
  }

  // ── Skills ──

  async skills(filter?: "installed" | "marketplace"): Promise<SkillSummary[]> {
    const params = filter ? `?filter=${encodeURIComponent(filter)}` : "";
    const res = await this.fetch(`/api/v1/skills${params}`);
    const data = (await res.json()) as { skills: SkillSummary[] };
    return data.skills;
  }

  async installSkill(skillId: string): Promise<void> {
    await this.fetch("/api/v1/skills", {
      method: "POST",
      body: JSON.stringify({ skillId }),
    });
  }

  async uninstallSkill(skillId: string): Promise<void> {
    await this.fetch("/api/v1/skills", {
      method: "DELETE",
      body: JSON.stringify({ skillId }),
    });
  }

  async createSkill(input: {
    name: string;
    slug: string;
    category: string;
    system_prompt_ext: string;
    description?: string;
    tool_definitions?: unknown[];
    is_public?: boolean;
  }): Promise<SkillSummary> {
    const res = await this.fetch("/api/v1/skills/create", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as { skill: SkillSummary };
    return data.skill;
  }

  /**
   * Submit a skill manifest for marketplace review.
   * Returns the submission record with its review status.
   */
  async submitSkill(manifest: SkillManifest): Promise<SubmissionRecord> {
    const res = await this.fetch("/api/v1/skills/submit", {
      method: "POST",
      body: JSON.stringify({ manifest }),
    });
    const data = (await res.json()) as { submission: SubmissionRecord };
    return data.submission;
  }

  /** List the authenticated user's skill submissions. */
  async submissions(status?: string): Promise<SubmissionRecord[]> {
    const params = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await this.fetch(`/api/v1/skills/submissions${params}`);
    const data = (await res.json()) as { submissions: SubmissionRecord[] };
    return data.submissions;
  }

  /** Get version history for a published skill. */
  async skillVersions(skillId: string): Promise<SkillVersion[]> {
    const res = await this.fetch(`/api/v1/skills/${encodeURIComponent(skillId)}/versions`);
    const data = (await res.json()) as { versions: SkillVersion[] };
    return data.versions;
  }

  // ── Workflows ──

  async workflows(): Promise<WorkflowRecord[]> {
    const res = await this.fetch("/api/v1/workflows");
    const data = (await res.json()) as { workflows: WorkflowRecord[] };
    return data.workflows;
  }

  async createWorkflow(input: {
    name: string;
    triggerType: "schedule" | "event" | "manual";
    triggerConfig?: Record<string, unknown>;
    steps: Array<{ type: string; name: string; config: Record<string, unknown> }>;
  }): Promise<WorkflowRecord> {
    const res = await this.fetch("/api/v1/workflows", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as { workflow: WorkflowRecord };
    return data.workflow;
  }

  async triggerWorkflow(
    workflowId: string,
    triggerData?: Record<string, unknown>,
  ): Promise<WorkflowRunRecord> {
    const res = await this.fetch(`/api/v1/workflows/${encodeURIComponent(workflowId)}/run`, {
      method: "POST",
      body: JSON.stringify({ triggerData }),
    });
    const data = (await res.json()) as { run: WorkflowRunRecord };
    return data.run;
  }

  // ── Images ──

  async images(request: ImageRequest): Promise<ImageResponse> {
    const res = await this.fetch("/api/v1/images", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return res.json();
  }

  // ── Video (async) ──

  async video(request: VideoRequest): Promise<AsyncJobResponse> {
    const res = await this.fetch("/api/v1/video", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return res.json();
  }

  // ── Code ──

  async code(request: CodeRequest): Promise<CodeResponse> {
    const res = await this.fetch("/api/v1/code", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return res.json();
  }

  // ── Research (async) ──

  async research(request: ResearchRequest): Promise<AsyncJobResponse> {
    const res = await this.fetch("/api/v1/research", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return res.json();
  }

  // ── Documents ──

  async documents(request: DocumentRequest): Promise<DocumentResponse> {
    const res = await this.fetch("/api/v1/documents", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return res.json();
  }

  // ── Audio ──

  async tts(request: TtsRequest): Promise<ArrayBuffer> {
    const res = await this.fetch("/api/v1/audio/tts", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return res.arrayBuffer();
  }

  async stt(file: Blob, language?: string): Promise<SttResponse> {
    const form = new FormData();
    form.append("file", file);
    if (language) form.append("language", language);

    const res = await this.fetchRaw("/api/v1/audio/stt", {
      method: "POST",
      body: form,
    });
    return res.json();
  }

  // ── Jobs (poll async results) ──

  async job(jobId: string): Promise<JobStatus> {
    const res = await this.fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    const data = await res.json();
    return data.job;
  }

  /**
   * Poll a job until it completes or fails.
   * Returns the final job status.
   */
  async waitForJob(jobId: string, intervalMs = 2000, maxWaitMs = 300_000): Promise<JobStatus> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const status = await this.job(jobId);
      if (status.status === "completed" || status.status === "failed") return status;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new TheoApiError(408, "Job polling timed out.", `/api/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  // ── Tools ──

  async tools(): Promise<SdkToolDefinition[]> {
    const res = await this.fetch("/api/v1/tools");
    const data = (await res.json()) as { tools: SdkToolDefinition[] };
    return data.tools;
  }

  // ── Theo Browser (headless browser sessions) ──

  /**
   * Theo Browser — managed headless browser sessions with an
   * iframe-embeddable live view and a full multi-step agent surface
   * (navigate, act, extract, observe, screenshot).
   *
   * Sessions are scoped to the caller's API key. End sessions explicitly
   * with `end(id)` to stop billing — otherwise they are auto-closed at
   * the idle timeout / hard cap.
   *
   * @example
   * ```typescript
   * const session = await theo.browser.create({ url: "https://example.com" });
   * console.log(session.live_view_url);   // iframe this
   * console.log(session.embed_url);       // or iframe this for branded chrome
   *
   * // After the embedded live view signals a disconnect, refetch:
   * const refreshed = await theo.browser.live(session.session_id, { force: true });
   *
   * await theo.browser.end(session.session_id);
   * ```
   */
  readonly browser = {
    /** Create a new managed browser session. Returns an iframe-ready URL. */
    create: async (
      request: BrowserCreateRequest = {},
    ): Promise<BrowserSessionHandle> => {
      const res = await this.fetch("/api/v1/browser/sessions", {
        method: "POST",
        body: JSON.stringify(request),
      });
      return res.json();
    },

    /** List the caller's active browser sessions. */
    list: async (): Promise<BrowserSessionSnapshot[]> => {
      const res = await this.fetch("/api/v1/browser/sessions");
      const data = (await res.json()) as { sessions: BrowserSessionSnapshot[] };
      return data.sessions;
    },

    /** Fetch metadata for a single session (last URL, status, timestamps). */
    get: async (id: string): Promise<BrowserSessionSnapshot> => {
      const res = await this.fetch(
        `/api/v1/browser/sessions/${encodeURIComponent(id)}`,
      );
      return res.json();
    },

    /**
     * Refresh the live view URL for an active session. Pass
     * `{ force: true }` after the embedded live view signals a
     * disconnect so the returned URL targets the new CDP page id
     * immediately instead of waiting out the 60s cache.
     */
    live: async (
      id: string,
      options: { force?: boolean } = {},
    ): Promise<BrowserLiveView> => {
      const qs = options.force ? "?force=1" : "";
      const res = await this.fetch(
        `/api/v1/browser/sessions/${encodeURIComponent(id)}/live${qs}`,
      );
      return res.json();
    },

    /** End the session. Returns duration + proxy bytes billed. */
    end: async (id: string): Promise<BrowserEndResult> => {
      const res = await this.fetch(
        `/api/v1/browser/sessions/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      return res.json();
    },
  };

  // ── Health ──

  async health(): Promise<HealthResponse> {
    const res = await this.fetch("/api/v1/health");
    return res.json();
  }

  // ── Conversations ──

  async conversations(): Promise<ConversationSummary[]> {
    const res = await this.fetch("/api/v1/conversations");
    const data = (await res.json()) as { conversations: ConversationSummary[] };
    return data.conversations;
  }

  async conversation(id: string): Promise<ConversationDetail> {
    const res = await this.fetch(`/api/v1/conversations/${encodeURIComponent(id)}`);
    const data = (await res.json()) as { conversation: ConversationDetail };
    return data.conversation;
  }

  // ── Usage ──

  /**
   * Fetch aggregated usage + balance for the authenticated caller.
   *
   * When `scope: "org"` is passed, the response reflects the caller's
   * active organization (team billing pool). Requires the `viewUsage`
   * permission in that team — otherwise the server returns 403.
   * Defaults to team scope when the caller is inside an active org and
   * falls back to personal scope otherwise.
   */
  async usage(params?: {
    from?: string;
    to?: string;
    scope?: "user" | "org";
  }): Promise<UsageReport> {
    const search = new URLSearchParams();
    if (params?.from) search.set("from", params.from);
    if (params?.to) search.set("to", params.to);
    if (params?.scope) search.set("scope", params.scope);
    const qs = search.toString() ? `?${search.toString()}` : "";
    const res = await this.fetch(`/api/v1/usage${qs}`);
    return (await res.json()) as UsageReport;
  }

  // ── Billing ──

  /**
   * Start a credit top-up. When `scope: "org"` is passed (or when the
   * caller is inside a team with `manageBilling`), the checkout funds
   * the team credit pool; otherwise it funds the caller's personal
   * balance. Returns `{ checkout_url, scope }`.
   */
  async billingCheckout(input: {
    amount_cents: number;
    scope?: "user" | "org";
    success_url?: string;
  }): Promise<{ checkout_url: string; scope: "user" | "org" }> {
    const res = await this.fetch("/api/v1/billing/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return res.json() as Promise<{ checkout_url: string; scope: "user" | "org" }>;
  }

  /**
   * Open the billing portal for the caller (default) or the team when
   * `scope: "org"` is passed. Team portals require `manageBilling` AND
   * a funded team payment method (otherwise the server returns 409
   * `team_billing_setup_required`).
   */
  async billingPortal(input?: {
    scope?: "user" | "org";
  }): Promise<{ portal_url: string; scope: "user" | "org" }> {
    const res = await this.fetch("/api/v1/billing/portal", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
    return res.json() as Promise<{ portal_url: string; scope: "user" | "org" }>;
  }

  // ── Webhooks ──

  /** List webhooks for the caller's org. */
  async listWebhooks(): Promise<WebhookRecord[]> {
    const res = await this.fetch("/api/v1/webhooks");
    const data = (await res.json()) as { webhooks: WebhookRecord[] };
    return data.webhooks;
  }

  /** Create a webhook endpoint. Returns the webhook with signing_secret (shown once). */
  async createWebhook(input: {
    url: string;
    event_types: string[];
    secret?: string;
    description?: string;
  }): Promise<WebhookRecord> {
    const res = await this.fetch("/api/v1/webhooks", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return (await res.json()) as WebhookRecord;
  }

  /** Update a webhook. */
  async updateWebhook(id: string, input: {
    url?: string;
    event_types?: string[];
    enabled?: boolean;
    description?: string;
  }): Promise<void> {
    await this.fetch(`/api/v1/webhooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  /** Delete a webhook. */
  async deleteWebhook(id: string): Promise<void> {
    await this.fetch(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** Send a test event to a webhook endpoint. */
  async testWebhook(id: string): Promise<void> {
    await this.fetch(`/api/v1/webhooks/${encodeURIComponent(id)}/test`, { method: "POST" });
  }

  /** Get recent delivery attempts for a webhook. */
  async webhookDeliveries(id: string): Promise<WebhookDelivery[]> {
    const res = await this.fetch(`/api/v1/webhooks/${encodeURIComponent(id)}/deliveries`);
    const data = (await res.json()) as { deliveries: WebhookDelivery[] };
    return data.deliveries;
  }

  // ── Hooks (event-driven skill triggers) ──

  /** List the user's installed hooks. */
  async listHooks(): Promise<HookRecord[]> {
    const res = await this.fetch("/api/v1/hooks");
    const data = (await res.json()) as { hooks: HookRecord[] };
    return data.hooks;
  }

  /** Install a hook (preset or custom event pattern). */
  async createHook(input: {
    hook_preset_id?: string;
    event_pattern?: string;
    skill_slug: string;
    cooldown_minutes?: number;
  }): Promise<HookRecord> {
    const res = await this.fetch("/api/v1/hooks", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return (await res.json()) as HookRecord;
  }

  /** Update a hook's config, enable/disable, or cooldown. */
  async updateHook(id: string, input: {
    enabled?: boolean;
    cooldown_minutes?: number;
    config?: Record<string, unknown>;
  }): Promise<void> {
    await this.fetch(`/api/v1/hooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  /** Delete a hook. */
  async deleteHook(id: string): Promise<void> {
    await this.fetch(`/api/v1/hooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** Get execution history for a hook. */
  async hookExecutions(id: string): Promise<HookExecution[]> {
    const res = await this.fetch(`/api/v1/hooks/${encodeURIComponent(id)}/executions`);
    const data = (await res.json()) as { executions: HookExecution[] };
    return data.executions;
  }

  // ── Events (domain event ingestion) ──

  /** Publish a domain event. Triggers matching hooks and webhooks. */
  async publishEvent(input: {
    orgId: string;
    eventType: string;
    payload: unknown;
    sourceConnector?: string;
  }): Promise<EventAck> {
    const res = await this.fetch("/api/v1/events", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return (await res.json()) as EventAck;
  }

  // ── E.V.I. Canvas ──

  /** List the authenticated user's E.V.I. canvases. */
  async canvases(): Promise<CanvasRecord[]> {
    const res = await this.fetch("/api/v1/evi/canvases");
    const data = await res.json();
    return data.canvases;
  }

  /** Get a single E.V.I. canvas by ID. */
  async canvas(id: string): Promise<CanvasRecord> {
    const res = await this.fetch(`/api/v1/evi/canvases/${encodeURIComponent(id)}`);
    const data = await res.json();
    return data.canvas;
  }

  /** Create a new E.V.I. canvas. */
  async createCanvas(input: CreateCanvasInput): Promise<CanvasRecord> {
    const res = await this.fetch("/api/v1/evi/canvases", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const data = await res.json();
    return data.canvas;
  }

  /** Update an existing E.V.I. canvas. */
  async updateCanvas(id: string, input: UpdateCanvasInput): Promise<CanvasRecord> {
    const res = await this.fetch(`/api/v1/evi/canvases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    const data = await res.json();
    return data.canvas;
  }

  /** Delete an E.V.I. canvas. */
  async deleteCanvas(id: string): Promise<void> {
    await this.fetch(`/api/v1/evi/canvases/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** Compile an E.V.I. canvas into a SkillManifest + WorkflowSteps. */
  async compileCanvas(id: string): Promise<CanvasCompileResult> {
    const res = await this.fetch(`/api/v1/evi/canvases/${encodeURIComponent(id)}/compile`, {
      method: "POST",
    });
    return res.json();
  }

  /** Test an E.V.I. canvas with a sandbox message. */
  async testCanvas(
    id: string,
    message: string,
    history?: Array<{ role: string; content: string }>,
  ): Promise<CanvasTestResult> {
    const res = await this.fetch(`/api/v1/evi/canvases/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({ message, history }),
    });
    return res.json();
  }

  /** Publish an E.V.I. canvas as a skill. */
  async publishCanvas(id: string, input: PublishCanvasInput): Promise<CanvasPublishResult> {
    const res = await this.fetch(`/api/v1/evi/canvases/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return res.json();
  }

  // ── E.V.I. (Embedded Virtual Intelligence) ──

  /**
   * Create an E.V.I. instance — Theo embedded in your product with a custom
   * persona, pre-configured skills, and inline tools.
   *
   * Every completion made through the E.V.I. automatically includes the
   * configured persona, skills, and tools without repeating them per call.
   *
   * @example
   * ```typescript
   * const evi = theo.evi({
   *   persona: "You are Nova, an AI assistant for WarehouseOS...",
   *   skills: ["inventory-check", "data-extraction"],
   *   tools: [{ name: "check_stock", description: "Look up stock levels" }],
   * });
   *
   * const res = await evi.complete({ prompt: "Check stock levels" });
   * const stream = evi.stream({ prompt: "Draft a report" });
   * ```
   */
  evi(config: EviConfig): EviInstance {
    return new EviInstance(this, config);
  }

  // ── Internal fetch (with retry + timeout) ──

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    return this._fetchWithRetry(path, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  }

  /** Fetch without auto Content-Type (for FormData uploads). */
  private async fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    return this._fetchWithRetry(path, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        ...init?.headers,
      },
    });
  }

  private async _fetchWithRetry(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    let lastError: TheoApiError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // Exponential backoff on retries
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        await new Promise((r) => setTimeout(r, delay));
      }

      // Compose a per-attempt timeout signal with any caller-supplied
      // signal (e.g. TheoStream.cancel()) so both can abort the fetch.
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const signal = init.signal
        ? anySignal([init.signal, timeoutSignal])
        : timeoutSignal;

      try {
        const res = await fetch(url, { ...init, signal });

        if (res.ok) return res;

        const body = await res.text();
        lastError = TheoApiError.fromResponse(res.status, body, url);

        // Only retry on rate limits and server errors
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) throw lastError;

        // Respect Retry-After header on 429
        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after");
          if (retryAfter) {
            const waitMs = parseInt(retryAfter, 10) * 1000;
            if (!isNaN(waitMs) && waitMs > 0 && waitMs <= 60_000) {
              await new Promise((r) => setTimeout(r, waitMs));
            }
          }
        }
      } catch (err) {
        if (err instanceof TheoApiError) {
          lastError = err;
          // Don't retry client errors
          if (err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
        } else if ((err as Error).name === "AbortError" && init.signal?.aborted) {
          // Caller explicitly cancelled — don't retry.
          throw new TheoApiError(0, "Request was cancelled.", url);
        } else {
          // Network error or timeout - retryable
          lastError = new TheoApiError(0, (err as Error).message, url);
        }
      }
    }

    throw lastError ?? new TheoApiError(0, "Request failed after retries.", url);
  }
}

// ---------------------------------------------------------------------------
// E.V.I. Instance
// ---------------------------------------------------------------------------

/**
 * An E.V.I. (Embedded Virtual Intelligence) instance — a pre-configured
 * Theo client with a custom persona, skills, and tools baked in.
 *
 * Created via `theo.evi(config)`. Every completion automatically includes
 * the E.V.I.'s persona, skills, and tools.
 */
export class EviInstance {
  private client: Theo;
  private config: EviConfig;

  constructor(client: Theo, config: EviConfig) {
    this.client = client;
    this.config = config;
  }

  /** Run a completion through this E.V.I. */
  async complete(request: Omit<CompletionRequest, "persona" | "skills" | "tools"> & {
    /** Additional skills to activate for this specific request (merged with E.V.I. defaults). */
    skills?: string[];
    /** Additional tools for this specific request (merged with E.V.I. defaults). */
    tools?: CompletionRequest["tools"];
  }): Promise<CompletionResponse> {
    return this.client.complete(this.mergeRequest(request));
  }

  /** Stream a completion through this E.V.I. */
  stream(request: Omit<CompletionRequest, "persona" | "skills" | "tools" | "stream"> & {
    skills?: string[];
    tools?: CompletionRequest["tools"];
  }): TheoStream {
    return this.client.stream(this.mergeRequest({ ...request, stream: true }));
  }

  /** Get the current E.V.I. configuration. */
  getConfig(): Readonly<EviConfig> {
    return { ...this.config };
  }

  private mergeRequest(request: Record<string, unknown>): CompletionRequest {
    const mergedSkills = [
      ...(this.config.skills ?? []),
      ...((request.skills as string[] | undefined) ?? []),
    ];

    const mergedTools = [
      ...(this.config.tools ?? []),
      ...((request.tools as CompletionRequest["tools"] | undefined) ?? []),
    ];

    return {
      ...(request as unknown as CompletionRequest),
      persona: { system_prompt: this.config.persona },
      skills: mergedSkills.length > 0 ? mergedSkills : undefined,
      tools: mergedTools.length > 0 ? mergedTools : undefined,
      mode: (request.mode as ChatMode | undefined) ?? this.config.defaultMode ?? "auto",
      temperature: (request.temperature as number | undefined) ?? this.config.defaultTemperature,
      metadata: {
        ...(this.config.metadata ?? {}),
        ...((request.metadata as Record<string, unknown> | undefined) ?? {}),
        _evi: true,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Project Config (for theo.config.ts)
// ---------------------------------------------------------------------------

/**
 * Configuration for a Theo-powered project.
 *
 * Create a `theo.config.ts` (or `.json` / `.js`) at the project root.
 * The Theo MCP server reads this automatically and injects persona,
 * skills, and tools into every IDE agent interaction.
 *
 * Usage:
 *   // theo.config.ts
 *   import { defineConfig } from "@hitheo/sdk";
 *   export default defineConfig({
 *     persona: "You are a backend engineer assistant...",
 *     skills: ["deep-research"],
 *     defaultMode: "code",
 *   });
 */
export interface TheoProjectConfig {
  /** Custom persona prompt injected into every completion. */
  persona?: string;
  /** Skill slugs activated on every completion. */
  skills?: string[];
  /** Default execution mode. */
  defaultMode?: ChatMode;
  /** Inline tool definitions available on every completion. */
  tools?: Array<{
    name: string;
    description: string;
    input_schema?: Record<string, unknown>;
  }>;
  /** Default temperature for completions. */
  temperature?: number;
  /** Metadata attached to every request for tracking. */
  metadata?: Record<string, unknown>;
}

/**
 * Type-safe helper for creating a `theo.config.ts` file.
 *
 * @example
 * ```typescript
 * import { defineConfig } from "@hitheo/sdk";
 * export default defineConfig({
 *   persona: "You are Nova, an operations assistant for WarehouseOS...",
 *   skills: ["inventory-check", "data-extraction"],
 *   defaultMode: "auto",
 * });
 * ```
 */
export function defineConfig(config: TheoProjectConfig): TheoProjectConfig {
  return config;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TheoApiError extends Error {
  status: number;
  body: string;
  url: string;
  /** Parsed error details from the API response body, if available. */
  details: { message: string; type: string; code: string; request_id: string | null } | null;

  constructor(status: number, body: string, url: string) {
    super(`Theo API error ${status}: ${body}`);
    this.name = "TheoApiError";
    this.status = status;
    this.body = body;
    this.url = url;
    this.details = null;
  }

  /** Create from a response, attempting to parse the structured error body. */
  static fromResponse(status: number, body: string, url: string): TheoApiError {
    const err = new TheoApiError(status, body, url);
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error?.message) {
        err.details = parsed.error;
        err.message = `Theo API error ${status}: ${parsed.error.message}`;
      }
    } catch {
      // Body wasn't JSON - keep raw text
    }
    return err;
  }
}

// ---------------------------------------------------------------------------
// TheoStream — async-iterable streaming handle with cancel + final metadata
// ---------------------------------------------------------------------------

/**
 * An active SSE completion stream. Use with `for await` to consume
 * events, call `cancel()` to abort generation mid-flight, and read
 * `conversationId` / `usage` / `model` / `requestId` once the stream
 * has finished (populated from the `meta` and `done` events).
 *
 * @example
 * ```typescript
 * const stream = theo.stream({ prompt: "Explain TCP" });
 *
 * // Cancel after 3s if the user clicks "Stop generating"
 * setTimeout(() => stream.cancel(), 3000);
 *
 * for await (const event of stream) {
 *   if (event.type === "token") process.stdout.write(event.token);
 * }
 *
 * console.log("Conversation:", stream.conversationId);
 * console.log("Usage:", stream.usage);
 * console.log("Request ID:", stream.requestId);
 * ```
 */
export class TheoStream implements AsyncIterable<StreamEvent> {
  /** Server-assigned request id (from `X-Request-Id` header). */
  requestId: string | null = null;
  /** Model info from the `meta` event. */
  model: { id: string; label: string; engine: string } | null = null;
  /** Resolved mode (after intent classification / routing). */
  resolvedMode: ChatMode | null = null;
  /** Server-side conversation id, if this response resolved to one. */
  conversationId: string | null = null;
  /** Final usage (populated after the stream's `done` event). */
  usage: CompletionUsage | null = null;
  /** Cumulative text content (populated as tokens stream in). */
  content = "";

  private readonly requestFactory: (signal: AbortSignal) => Promise<Response>;
  private readonly abortController = new AbortController();
  private cancelled = false;

  constructor(requestFactory: (signal: AbortSignal) => Promise<Response>) {
    this.requestFactory = requestFactory;
  }

  /**
   * Abort the underlying HTTP connection, ending the stream. Already-
   * emitted events are delivered to the consumer; subsequent tokens
   * will not arrive. Safe to call multiple times.
   */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    try {
      this.abortController.abort();
    } catch {
      // AbortController.abort() is spec-safe to call repeatedly; swallow
      // any environmental oddities (older Node polyfills, etc.).
    }
  }

  /** True once `cancel()` has been invoked. */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    return this.iterate();
  }

  private async *iterate(): AsyncGenerator<StreamEvent, void, unknown> {
    const res = await this.requestFactory(this.abortController.signal);
    this.requestId = res.headers.get("x-request-id");

    if (!res.body) {
      throw new TheoApiError(0, "No response body for streaming request.", res.url);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (this.cancelled) {
          await reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            let data: unknown;
            try {
              data = JSON.parse(raw);
            } catch {
              continue; // skip malformed SSE data lines
            }
            const event = toStreamEvent(currentEvent, data);
            if (!event) continue;
            this.captureMetadata(event);
            yield event;
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // reader may already be released
      }
    }
  }

  private captureMetadata(event: StreamEvent): void {
    switch (event.type) {
      case "meta": {
        this.model = event.data.model;
        this.resolvedMode = event.data.resolved_mode;
        if (event.data.conversation_id !== undefined) {
          this.conversationId = event.data.conversation_id ?? null;
        }
        if (event.data.request_id) {
          this.requestId = event.data.request_id;
        }
        break;
      }
      case "token": {
        this.content += event.token;
        break;
      }
      case "done": {
        this.usage = event.data.usage;
        if (event.data.conversation_id !== undefined) {
          this.conversationId = event.data.conversation_id ?? null;
        }
        if (event.data.request_id) {
          this.requestId = event.data.request_id;
        }
        if (event.data.content) {
          this.content = event.data.content;
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Merge multiple AbortSignals into one that fires when any source fires.
 * Used to let the SDK combine its per-attempt timeout with a caller-
 * supplied cancellation signal from `TheoStream.cancel()`.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
    for (const s of signals) s.removeEventListener("abort", handle);
  };
  const handle = function (this: AbortSignal) {
    onAbort(this.reason);
  };
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", handle, { once: true });
  }
  return controller.signal;
}

function toStreamEvent(eventName: string, data: unknown): StreamEvent | null {
  switch (eventName) {
    case "meta":
      return { type: "meta", data: data as StreamMetaData };
    case "token": {
      const payload = data as StreamTokenData;
      return { type: "token", data: payload, token: payload.token };
    }
    case "tool":
      return { type: "tool", data: data as StreamToolData };
    case "artifact":
      return { type: "artifact", data: data as Record<string, unknown> };
    case "genui_meta":
      return { type: "genui_meta", data: data as GenUIMetaEvent };
    case "skills":
      return { type: "skills", data: data as StreamSkillsData };
    case "done":
      return { type: "done", data: data as StreamDoneData };
    case "error":
      return { type: "error", data: data as StreamErrorData };
    default:
      return null; // Ignore `thinking` heartbeat + any unknown event types.
  }
}
