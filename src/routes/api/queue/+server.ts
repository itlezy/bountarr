import { json } from '@sveltejs/kit';
import { getQueue } from '$lib/server/arr';

export const GET = async () => {
  return json(await getQueue());
};
