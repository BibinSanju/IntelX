import { createHash } from 'node:crypto';

export type ProviderPoolName = 'google' | 'groq' | 'groq-audio';

export interface ProviderPoolLimits {
  quotaScope: 'shared' | 'per-project' | 'per-organization';
  requestsPerMinute: number;
  tokensPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
  concurrency: number;
  maxAttempts: number;
  maxQueueWaitMs: number;
  baseCooldownMs: number;
  minuteWindowMs?: number;
  dayWindowMs?: number;
}

export interface ProviderPoolSnapshot {
  provider: ProviderPoolName;
  configuredKeys: number;
  availableKeys: number;
  coolingKeys: number;
  disabledKeys: number;
  providerCooldownMs: number;
  activeRequests: number;
  queuedRequests: number;
  limits: Omit<ProviderPoolLimits, 'minuteWindowMs' | 'dayWindowMs'>;
}

interface KeyState {
  value: string;
  id: string;
  cooldownUntil: number;
  disabled: boolean;
  consecutiveFailures: number;
  minuteEvents: UsageEvent[];
  dayEvents: UsageEvent[];
}

interface UsageEvent {
  at: number;
  tokens: number;
}

interface ClassifiedError {
  status?: number;
  retryable: boolean;
  disableKey: boolean;
  retryAfterMs?: number;
}

export interface PoolExecutionOptions {
  estimatedTokens?: number;
  operation?: string;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers?: Headers | Record<string, string>,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export class ProviderPoolExhaustedError extends Error {
  constructor(
    public readonly provider: ProviderPoolName,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderPoolExhaustedError';
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<(release: () => void) => void> = [];

  constructor(private readonly maximum: number) {}

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.maximum) {
      this.active += 1;
      return this.makeRelease();
    }
    return new Promise(resolve => this.waiters.push(resolve));
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next(this.makeRelease());
      } else {
        this.active = Math.max(0, this.active - 1);
      }
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function keyId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 10);
}

function cleanKey(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

function parseKeyValue(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(item => cleanKey(String(item))).filter(Boolean);
    } catch {
      throw new Error('API key pool must be a JSON array or a comma/newline/semicolon-separated string.');
    }
  }
  return trimmed.split(/[\r\n,;]+/).map(cleanKey).filter(Boolean);
}

export function loadProviderKeys(provider: ProviderPoolName, env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = provider === 'google'
    ? [env.GOOGLE_API_KEYS, env.GEMINI_API_KEYS, env.GOOGLE_AI_STUDIO_API_KEYS, env.GOOGLE_API_KEY, env.GEMINI_API_KEY, env.GOOGLE_AI_STUDIO_API_KEY]
    : [env.GROQ_API_KEYS, env.GROQ_API_KEY];
  return [...new Set(raw.flatMap(parseKeyValue))];
}

function envNumber(value: string | undefined, fallback: number, minimum = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function loadProviderLimits(provider: ProviderPoolName, env: NodeJS.ProcessEnv = process.env): ProviderPoolLimits {
  const shared = {
    maxQueueWaitMs: envNumber(env.PROVIDER_MAX_QUEUE_WAIT_MS, 120_000, 1),
    baseCooldownMs: envNumber(env.PROVIDER_BASE_COOLDOWN_MS, 2_000, 1),
  };

  if (provider === 'google') {
    const configuredScope = env.GOOGLE_QUOTA_SCOPE?.trim().toLowerCase();
    return {
      // Conservative shared profile applied independently to each Google
      // project: 90% headroom below the current 5 RPM / 250K TPM / 20 RPD
      // Gemini 3.8 Flash free-tier values visible in AI Studio.
      requestsPerMinute: envNumber(env.GOOGLE_RPM, 4),
      tokensPerMinute: envNumber(env.GOOGLE_TPM, 225_000),
      requestsPerDay: envNumber(env.GOOGLE_RPD, 18),
      tokensPerDay: envNumber(env.GOOGLE_TPD, 0),
      concurrency: envNumber(env.GOOGLE_CONCURRENCY, 1, 1),
      // This deployment uses one Google key per independent free-tier project.
      // Operators can explicitly choose `shared` if they later add multiple
      // credentials that belong to the same Google project.
      quotaScope: configuredScope === 'shared' ? 'shared' : 'per-project',
      maxAttempts: envNumber(env.GOOGLE_MAX_ATTEMPTS ?? env.PROVIDER_MAX_ATTEMPTS, 20, 1),
      ...shared,
    };
  }

  if (provider === 'groq-audio') {
    const configuredScope = env.GROQ_QUOTA_SCOPE?.trim().toLowerCase();
    return {
      requestsPerMinute: envNumber(env.GROQ_AUDIO_RPM, 18),
      tokensPerMinute: 0,
      requestsPerDay: envNumber(env.GROQ_AUDIO_RPD, 1_800),
      tokensPerDay: 0,
      concurrency: envNumber(env.GROQ_AUDIO_CONCURRENCY, 1, 1),
      quotaScope: configuredScope === 'shared' ? 'shared' : 'per-organization',
      maxAttempts: envNumber(env.GROQ_MAX_ATTEMPTS ?? env.PROVIDER_MAX_ATTEMPTS, 20, 1),
      ...shared,
    };
  }

  // Ten-percent safety headroom below the published free-plan limits for
  // openai/gpt-oss-120b: 30 RPM, 1K RPD, 8K TPM, and 200K TPD.
  const configuredScope = env.GROQ_QUOTA_SCOPE?.trim().toLowerCase();
  return {
    requestsPerMinute: envNumber(env.GROQ_RPM, 27),
    tokensPerMinute: envNumber(env.GROQ_TPM, 7_200),
    requestsPerDay: envNumber(env.GROQ_RPD, 900),
    tokensPerDay: envNumber(env.GROQ_TPD, 180_000),
    concurrency: envNumber(env.GROQ_CONCURRENCY, 1, 1),
    // One personal key is expected per independent Groq organization.
    // Explicitly use `shared` if multiple keys belong to the same account.
    quotaScope: configuredScope === 'shared' ? 'shared' : 'per-organization',
    maxAttempts: envNumber(env.GROQ_MAX_ATTEMPTS ?? env.PROVIDER_MAX_ATTEMPTS, 20, 1),
    ...shared,
  };
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) || undefined;
  }
  if (typeof headers === 'object') {
    const match = Object.entries(headers as Record<string, unknown>)
      .find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match && typeof match[1] === 'string') return match[1];
  }
  return undefined;
}

function parseRetryAfterMs(error: any): number | undefined {
  const value = readHeader(error?.headers, 'retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function classifyError(error: any): ClassifiedError {
  const rawStatus = error?.status ?? error?.statusCode ?? error?.code;
  const status = Number.isFinite(Number(rawStatus)) ? Number(rawStatus) : undefined;
  const retryAfterMs = parseRetryAfterMs(error);

  if (status === 401 || status === 403) {
    return { status, retryable: true, disableKey: true };
  }
  if (status === 429) {
    return { status, retryable: true, disableKey: false, retryAfterMs };
  }
  if (status === 408 || status === 409 || (status !== undefined && status >= 500)) {
    return { status, retryable: true, disableKey: false, retryAfterMs };
  }
  if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET') {
    return { status, retryable: true, disableKey: false };
  }
  return { status, retryable: false, disableKey: false };
}

export class ProviderKeyPool {
  private readonly keys: KeyState[];
  private readonly semaphore: Semaphore;
  private readonly minuteEvents: UsageEvent[] = [];
  private readonly dayEvents: UsageEvent[] = [];
  private cursor = 0;
  private providerCooldownUntil = 0;
  private quotaGate: Promise<void> = Promise.resolve();
  private readonly minuteWindowMs: number;
  private readonly dayWindowMs: number;

  constructor(
    public readonly provider: ProviderPoolName,
    keyValues: string[],
    public readonly limits: ProviderPoolLimits,
  ) {
    const unique = [...new Set(keyValues.map(cleanKey).filter(Boolean))];
    if (!unique.length) {
      throw new Error(`No ${provider} API keys configured.`);
    }
    this.keys = unique.map(value => ({
      value,
      id: keyId(value),
      cooldownUntil: 0,
      disabled: false,
      consecutiveFailures: 0,
      minuteEvents: [],
      dayEvents: [],
    }));
    this.semaphore = new Semaphore(Math.max(1, Math.floor(limits.concurrency)));
    this.minuteWindowMs = limits.minuteWindowMs ?? 60_000;
    this.dayWindowMs = limits.dayWindowMs ?? 86_400_000;
  }

  snapshot(now = Date.now()): ProviderPoolSnapshot {
    return {
      provider: this.provider,
      configuredKeys: this.keys.length,
      availableKeys: this.keys.filter(key => !key.disabled && key.cooldownUntil <= now).length,
      coolingKeys: this.keys.filter(key => !key.disabled && key.cooldownUntil > now).length,
      disabledKeys: this.keys.filter(key => key.disabled).length,
      providerCooldownMs: Math.max(0, this.providerCooldownUntil - now),
      activeRequests: this.semaphore.activeCount,
      queuedRequests: this.semaphore.queuedCount,
      limits: {
        requestsPerMinute: this.limits.requestsPerMinute,
        quotaScope: this.limits.quotaScope,
        tokensPerMinute: this.limits.tokensPerMinute,
        requestsPerDay: this.limits.requestsPerDay,
        tokensPerDay: this.limits.tokensPerDay,
        concurrency: this.limits.concurrency,
        maxAttempts: this.limits.maxAttempts,
        maxQueueWaitMs: this.limits.maxQueueWaitMs,
        baseCooldownMs: this.limits.baseCooldownMs,
      },
    };
  }

  async execute<T>(
    operation: (apiKey: string) => Promise<T>,
    options: PoolExecutionOptions = {},
  ): Promise<T> {
    const release = await this.semaphore.acquire();
    let lastError: unknown;
    const attempts = Math.max(1, Math.min(this.limits.maxAttempts, this.keys.length + 1));

    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const key = await this.nextAvailableKey();
        await this.reserveQuota(key, options.estimatedTokens || 0);

        try {
          const result = await operation(key.value);
          key.consecutiveFailures = 0;
          return result;
        } catch (error) {
          lastError = error;
          const classified = classifyError(error);
          if (!classified.retryable) throw error;

          key.consecutiveFailures += 1;
          if (classified.disableKey) {
            key.disabled = true;
            console.warn(`[KeyPool:${this.provider}] Disabled rejected credential ${key.id}; rotating.`);
          } else {
            const exponential = this.limits.baseCooldownMs * (2 ** Math.min(key.consecutiveFailures - 1, 6));
            const jitter = Math.floor(Math.random() * Math.max(250, this.limits.baseCooldownMs / 2));
            const cooldown = Math.max(classified.retryAfterMs || 0, exponential + jitter);
            key.cooldownUntil = Date.now() + cooldown;
            if (classified.status === 429 && this.limits.quotaScope === 'shared') {
              // Quotas are normally project/organization scoped, so a 429 also
              // pauses the aggregate provider pool before another key is tried.
              this.providerCooldownUntil = Math.max(this.providerCooldownUntil, key.cooldownUntil);
            }
            console.warn(`[KeyPool:${this.provider}] ${classified.status || 'transient'} response for credential ${key.id}; cooling for ${cooldown}ms and rotating.`);
          }
        }
      }
    } finally {
      release();
    }

    const message = lastError instanceof Error ? lastError.message : 'All configured credentials are unavailable.';
    const now = Date.now();
    const retryAfterMs = this.keys
      .filter(key => !key.disabled && key.cooldownUntil > now)
      .map(key => key.cooldownUntil - now)
      .sort((a, b) => a - b)[0];
    throw new ProviderPoolExhaustedError(
      this.provider,
      `${this.provider} provider pool exhausted after ${attempts} bounded attempts: ${message}`,
      retryAfterMs,
    );
  }

  private async nextAvailableKey(): Promise<KeyState> {
    while (true) {
      const now = Date.now();
      const providerWaitMs = this.providerCooldownUntil - now;
      if (providerWaitMs > 0) {
        if (providerWaitMs > this.limits.maxQueueWaitMs) {
          throw new ProviderPoolExhaustedError(
            this.provider,
            `${this.provider} provider quota is cooling down; retry later.`,
            providerWaitMs,
          );
        }
        await sleep(providerWaitMs);
        continue;
      }
      for (let offset = 0; offset < this.keys.length; offset += 1) {
        const index = (this.cursor + offset) % this.keys.length;
        const key = this.keys[index];
        if (!key.disabled && key.cooldownUntil <= now) {
          this.cursor = (index + 1) % this.keys.length;
          return key;
        }
      }

      const cooling = this.keys.filter(key => !key.disabled);
      if (!cooling.length) {
        throw new ProviderPoolExhaustedError(this.provider, `Every configured ${this.provider} credential was rejected.`);
      }
      const waitMs = Math.max(1, Math.min(...cooling.map(key => key.cooldownUntil)) - now);
      if (waitMs > this.limits.maxQueueWaitMs) {
        throw new ProviderPoolExhaustedError(
          this.provider,
          `All ${this.provider} credentials are cooling down; retry later.`,
          waitMs,
        );
      }
      await sleep(waitMs);
    }
  }

  private async reserveQuota(key: KeyState, estimatedTokens: number): Promise<void> {
    const previous = this.quotaGate;
    let release!: () => void;
    this.quotaGate = new Promise<void>(resolve => { release = resolve; });
    await previous;

    try {
      const started = Date.now();
      while (true) {
        const now = Date.now();
        const quotaIsIndependent = this.limits.quotaScope !== 'shared';
        const minuteEvents = quotaIsIndependent ? key.minuteEvents : this.minuteEvents;
        const dayEvents = quotaIsIndependent ? key.dayEvents : this.dayEvents;
        this.pruneUsage(now, minuteEvents, dayEvents);
        const minuteTokens = minuteEvents.reduce((sum, event) => sum + event.tokens, 0);
        const dayTokens = dayEvents.reduce((sum, event) => sum + event.tokens, 0);
        const reservedTokens = Math.max(0, Math.floor(estimatedTokens));
        const minuteReservation = this.limits.tokensPerMinute > 0
          ? Math.min(reservedTokens, this.limits.tokensPerMinute)
          : reservedTokens;
        const dayReservation = this.limits.tokensPerDay > 0
          ? Math.min(reservedTokens, this.limits.tokensPerDay)
          : reservedTokens;

        const minuteRequestBlocked = this.limits.requestsPerMinute > 0 && minuteEvents.length >= this.limits.requestsPerMinute;
        const minuteTokenBlocked = this.limits.tokensPerMinute > 0 && minuteTokens + minuteReservation > this.limits.tokensPerMinute;
        const dayRequestBlocked = this.limits.requestsPerDay > 0 && dayEvents.length >= this.limits.requestsPerDay;
        const dayTokenBlocked = this.limits.tokensPerDay > 0 && dayTokens + dayReservation > this.limits.tokensPerDay;

        if (!minuteRequestBlocked && !minuteTokenBlocked && !dayRequestBlocked && !dayTokenBlocked) {
          minuteEvents.push({ at: now, tokens: minuteReservation });
          dayEvents.push({ at: now, tokens: dayReservation });
          return;
        }

        const waits: number[] = [];
        if ((minuteRequestBlocked || minuteTokenBlocked) && minuteEvents.length) {
          waits.push(minuteEvents[0].at + this.minuteWindowMs - now + 1);
        }
        if ((dayRequestBlocked || dayTokenBlocked) && dayEvents.length) {
          waits.push(dayEvents[0].at + this.dayWindowMs - now + 1);
        }
        const waitMs = Math.max(1, Math.min(...waits));
        if (Date.now() - started + waitMs > this.limits.maxQueueWaitMs) {
          throw new ProviderPoolExhaustedError(
            this.provider,
            `${this.provider} safety budget is exhausted; request was stopped before exceeding configured limits.`,
            waitMs,
          );
        }
        await sleep(waitMs);
      }
    } finally {
      release();
    }
  }

  private pruneUsage(now: number, minuteEvents: UsageEvent[], dayEvents: UsageEvent[]): void {
    while (minuteEvents[0] && minuteEvents[0].at <= now - this.minuteWindowMs) minuteEvents.shift();
    while (dayEvents[0] && dayEvents[0].at <= now - this.dayWindowMs) dayEvents.shift();
  }
}

const cachedPools = new Map<ProviderPoolName, { signature: string; pool: ProviderKeyPool }>();

export function getProviderPool(provider: ProviderPoolName): ProviderKeyPool {
  const keys = loadProviderKeys(provider);
  const limits = loadProviderLimits(provider);
  const signature = JSON.stringify({ ids: keys.map(keyId), limits });
  const cached = cachedPools.get(provider);
  if (cached?.signature === signature) return cached.pool;
  const pool = new ProviderKeyPool(provider, keys, limits);
  cachedPools.set(provider, { signature, pool });
  return pool;
}

export function getProviderPoolSnapshots(): ProviderPoolSnapshot[] {
  const providers: ProviderPoolName[] = ['google', 'groq', 'groq-audio'];
  return providers.map(provider => {
    const cached = cachedPools.get(provider)?.pool;
    if (cached) return cached.snapshot();
    const limits = loadProviderLimits(provider);
    return {
      provider,
      configuredKeys: loadProviderKeys(provider).length,
      availableKeys: loadProviderKeys(provider).length,
      coolingKeys: 0,
      disabledKeys: 0,
      providerCooldownMs: 0,
      activeRequests: 0,
      queuedRequests: 0,
      limits: {
        requestsPerMinute: limits.requestsPerMinute,
        quotaScope: limits.quotaScope,
        tokensPerMinute: limits.tokensPerMinute,
        requestsPerDay: limits.requestsPerDay,
        tokensPerDay: limits.tokensPerDay,
        concurrency: limits.concurrency,
        maxAttempts: limits.maxAttempts,
        maxQueueWaitMs: limits.maxQueueWaitMs,
        baseCooldownMs: limits.baseCooldownMs,
      },
    };
  });
}

export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(text.length / 4));
}

