import { error, json } from '@sveltejs/kit';
import { createAreaLogger } from '$lib/server/logger';

const logger = createAreaLogger('api.client-errors');

type ClientErrorPayload = {
  kind?: string;
  message?: string;
  stack?: string | null;
  url?: string | null;
  source?: string | null;
  line?: number | null;
  column?: number | null;
  routeId?: string | null;
  status?: number | null;
  userAgent?: string | null;
  timestamp?: string | null;
};

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export const POST = async ({ getClientAddress, request, url }) => {
  const payload = (await request.json()) as ClientErrorPayload;
  const message = asStringOrNull(payload.message);
  if (!message) {
    throw error(400, 'A client error message is required.');
  }

  logger.error('UI exception reported by browser', {
    browserUrl: asStringOrNull(payload.url),
    clientAddress: getClientAddress(),
    column: asNumberOrNull(payload.column),
    kind: asStringOrNull(payload.kind) ?? 'unknown',
    line: asNumberOrNull(payload.line),
    routeId: asStringOrNull(payload.routeId),
    source: asStringOrNull(payload.source),
    stack: asStringOrNull(payload.stack),
    status: asNumberOrNull(payload.status),
    timestamp: asStringOrNull(payload.timestamp),
    userAgent: asStringOrNull(payload.userAgent) ?? request.headers.get('user-agent'),
    requestUrl: url.toString(),
    error: message,
  });

  return json({ ok: true });
};
