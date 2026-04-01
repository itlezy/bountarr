import { getConfigStatus } from '$lib/server/arr';

export const load = async () => {
  return {
    config: getConfigStatus()
  };
};
