type UiExceptionKind = 'window-error' | 'unhandled-rejection' | 'sveltekit-handle-error';

export type UiExceptionReport = {
  kind: UiExceptionKind;
  message: string;
  stack: string | null;
  url: string | null;
  source: string | null;
  line: number | null;
  column: number | null;
  routeId: string | null;
  status: number | null;
  userAgent: string | null;
  timestamp: string;
};

const REPORT_ENDPOINT = '/api/client-errors';
const DEDUPE_WINDOW_MS = 30_000;

const recentlyReported = new Map<string, number>();
let installed = false;

function asError(value: unknown): Error | null {
  return value instanceof Error ? value : null;
}

function normalizeMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (value instanceof Error && value.message.trim().length > 0) {
    return value.message.trim();
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized && serialized !== '{}' && serialized !== 'null') {
      return serialized;
    }
  } catch {
    // Ignore serialization failures and fall back to the provided message.
  }

  return fallback;
}

function normalizeStack(value: unknown): string | null {
  return asError(value)?.stack ?? null;
}

function reportFingerprint(report: UiExceptionReport): string {
  return [
    report.kind,
    report.message,
    report.stack ?? '',
    report.url ?? '',
    report.source ?? '',
    report.line ?? '',
    report.column ?? '',
    report.routeId ?? '',
    report.status ?? '',
  ].join('|');
}

function shouldReport(report: UiExceptionReport): boolean {
  const now = Date.now();
  for (const [fingerprint, timestamp] of recentlyReported.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentlyReported.delete(fingerprint);
    }
  }

  const fingerprint = reportFingerprint(report);
  if (recentlyReported.has(fingerprint)) {
    return false;
  }

  recentlyReported.set(fingerprint, now);
  return true;
}

async function postUiException(report: UiExceptionReport): Promise<void> {
  const body = JSON.stringify(report);

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon(
        REPORT_ENDPOINT,
        new Blob([body], { type: 'application/json' }),
      );
      if (sent) {
        return;
      }
    }
  } catch {
    // Fall back to fetch below if sendBeacon is unavailable or fails synchronously.
  }

  await fetch(REPORT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function reportUiException(
  input: Omit<UiExceptionReport, 'timestamp' | 'url' | 'userAgent'> &
    Partial<Pick<UiExceptionReport, 'timestamp' | 'url' | 'userAgent'>>,
): void {
  const report: UiExceptionReport = {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
    url: input.url ?? (typeof window !== 'undefined' ? window.location.href : null),
    userAgent: input.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
  };

  if (!shouldReport(report)) {
    return;
  }

  void postUiException(report);
}

export function installUiExceptionTracing(): () => void {
  if (installed || typeof window === 'undefined') {
    return () => undefined;
  }

  installed = true;

  const handleWindowError = (event: ErrorEvent) => {
    reportUiException({
      kind: 'window-error',
      message: normalizeMessage(event.error ?? event.message, 'Unhandled UI error'),
      stack: normalizeStack(event.error),
      source: event.filename || null,
      line: event.lineno || null,
      column: event.colno || null,
      routeId: null,
      status: null,
    });
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportUiException({
      kind: 'unhandled-rejection',
      message: normalizeMessage(event.reason, 'Unhandled promise rejection'),
      stack: normalizeStack(event.reason),
      source: null,
      line: null,
      column: null,
      routeId: null,
      status: null,
    });
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    installed = false;
  };
}
