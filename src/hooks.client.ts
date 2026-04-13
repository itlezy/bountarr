import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { reportUiException } from '$lib/client/exception-tracing';

export const init: ClientInit = async () => undefined;

export const handleError: HandleClientError = ({ error, event, message, status }) => {
  reportUiException({
    kind: 'sveltekit-handle-error',
    message,
    stack: error instanceof Error ? error.stack ?? null : null,
    source: event.url.toString(),
    line: null,
    column: null,
    routeId: event.route.id ?? null,
    status,
  });

  return {
    message,
  };
};
