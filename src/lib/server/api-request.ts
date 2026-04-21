import { error } from '@sveltejs/kit';

export async function readJsonRecord(
  request: Request,
  invalidMessage = 'Request body must be a valid JSON object.',
): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw error(400, invalidMessage);
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw error(400, invalidMessage);
  }

  return payload as Record<string, unknown>;
}
