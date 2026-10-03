/** Keeps one bounded request deadline active through response-body consumption. */
export async function withNativeRequest<T>(
  input: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  timeoutMs = 60_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await consume(response);
  } finally {
    clearTimeout(timeout);
  }
}
