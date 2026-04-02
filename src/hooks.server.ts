import type { Handle } from '@sveltejs/kit';
import { ensureRuntimeBootLog } from '$lib/server/runtime';

ensureRuntimeBootLog();

export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};
