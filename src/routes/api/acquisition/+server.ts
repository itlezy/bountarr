import { json } from '@sveltejs/kit';
import { getAcquisitionJobs } from '$lib/server/arr';

export const GET = async () => {
  return json(await getAcquisitionJobs());
};
