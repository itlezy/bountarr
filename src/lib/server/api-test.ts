import { vi } from 'vitest';

type ModuleFactory = () => Record<string, unknown>;

function createLoggerModule() {
  return {
    createAreaLogger: () => ({
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
    getErrorMessage: (error: unknown, fallback: string) =>
      error instanceof Error ? error.message : fallback,
    toErrorLogContext: (error: unknown) => ({
      message: error instanceof Error ? error.message : String(error),
    }),
  };
}

export async function loadRouteModule<TModule>(
  routePath: string,
  mocks: Record<string, ModuleFactory>,
): Promise<TModule> {
  vi.resetModules();
  vi.doMock('$lib/server/logger', () => createLoggerModule());

  for (const [moduleId, factory] of Object.entries(mocks)) {
    vi.doMock(moduleId, factory);
  }

  return (await import(routePath)) as TModule;
}

export function createGetEvent(url: string) {
  return {
    url: new URL(url),
  };
}

export function createPostEvent(url: string, body: unknown) {
  return {
    request: new Request(url, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }),
  };
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
