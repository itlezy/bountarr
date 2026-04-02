import type { DashboardResponse, QueueResponse } from '$lib/shared/types';

type DashboardCacheEntry = {
  expiresAt: number;
  value: DashboardResponse;
};

type QueueCacheEntry = {
  expiresAt: number;
  value: QueueResponse;
};

type DefaultsCacheEntry = {
  expiresAt: number;
  value: Record<string, unknown>;
};

export const dashboardCache = new Map<string, DashboardCacheEntry>();
export const defaultsCache = new Map<string, DefaultsCacheEntry>();
export const queueCache = new Map<string, QueueCacheEntry>();
