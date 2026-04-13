import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installUiExceptionTracing,
  reportUiException,
} from '$lib/client/exception-tracing';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('client exception tracing', () => {
  it('dedupes repeated exception reports and prefers sendBeacon', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetchMock = vi.fn();

    vi.stubGlobal('navigator', {
      sendBeacon,
      userAgent: 'Vitest Browser',
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: {
        href: 'http://local.test/search',
      },
    });

    reportUiException({
      kind: 'window-error',
      message: 'Boom',
      stack: 'stack trace',
      source: 'SearchView.svelte',
      line: 12,
      column: 9,
      routeId: '/search',
      status: null,
    });
    reportUiException({
      kind: 'window-error',
      message: 'Boom',
      stack: 'stack trace',
      source: 'SearchView.svelte',
      line: 12,
      column: 9,
      routeId: '/search',
      status: null,
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    const [, blob] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(await blob.text()).toContain('"message":"Boom"');
  });

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('navigator', {
      userAgent: 'Vitest Browser',
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: {
        href: 'http://local.test/queue',
      },
    });

    reportUiException({
      kind: 'unhandled-rejection',
      message: 'Promise exploded',
      stack: null,
      source: null,
      line: null,
      column: null,
      routeId: '/queue',
      status: null,
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/client-errors',
      expect.objectContaining({
        body: expect.stringContaining('"message":"Promise exploded"'),
        keepalive: true,
        method: 'POST',
      }),
    );
  });

  it('registers and removes global UI exception listeners', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const listeners = new Map<string, EventListenerOrEventListenerObject>();
    const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      },
    );

    vi.stubGlobal('navigator', {
      sendBeacon,
      userAgent: 'Vitest Browser',
    });
    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      location: {
        href: 'http://local.test/search',
      },
    });

    const dispose = installUiExceptionTracing();

    expect(addEventListener).toHaveBeenCalledTimes(2);
    const errorListener = listeners.get('error');
    expect(errorListener).toBeDefined();
    if (typeof errorListener !== 'function') {
      throw new Error('Expected function error listener');
    }

    errorListener({
      message: 'Window exploded',
      error: new Error('Window exploded'),
      filename: 'SearchView.svelte',
      lineno: 22,
      colno: 7,
    } as ErrorEvent);

    expect(sendBeacon).toHaveBeenCalledTimes(1);

    dispose();

    expect(removeEventListener).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(0);
  });
});
