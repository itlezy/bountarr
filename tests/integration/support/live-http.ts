export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${url} failed with ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

export async function pollUntil<T>(
  fetcher: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const value = await fetcher();
      if (value !== null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for integration condition.`);
}
