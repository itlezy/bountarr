import { json } from '@sveltejs/kit';
import { getConfigStatus } from '$lib/server/arr';

export const GET = async () => {
  return json(await getConfigStatus());
};
