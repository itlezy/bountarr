import type { Handle } from '@sveltejs/kit';
import { ensureAcquisitionWorkers } from '$lib/server/acquisition-service';
import { ensureRuntimeBootLog } from '$lib/server/runtime';

ensureRuntimeBootLog();
ensureAcquisitionWorkers();

export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};
