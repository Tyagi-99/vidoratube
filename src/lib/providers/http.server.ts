/** Shared outbound HTTP helper: timeout, bounded retry with backoff, readable errors. */

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = 45_000, retries = 2, ...rest } = init;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return res;

      const body = await res.text().catch(() => "");
      // Only 429/5xx are worth retrying.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt;
        await sleep(wait + Math.random() * 250);
        continue;
      }
      throw new ProviderError(provider, res.status, humanise(res.status, body));
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof ProviderError) throw error;
      lastError = error;
      if (attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : "request failed";
  throw new ProviderError(provider, 0, message.includes("abort") ? "request timed out" : message);
}

function humanise(status: number, body: string): string {
  const snippet = body.slice(0, 300).replace(/\s+/g, " ").trim();
  if (status === 401 || status === 403) return `invalid or unauthorised API key (${status}) ${snippet}`;
  if (status === 402) return `provider credits exhausted (402) ${snippet}`;
  if (status === 429) return `rate limited (429) ${snippet}`;
  return `request failed (${status}) ${snippet}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Masks a key for display: sk_xxxx********1234 */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key.length <= 10) return "********";
  return `${key.slice(0, 5)}********${key.slice(-4)}`;
}
