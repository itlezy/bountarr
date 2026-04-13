import type { Page, Request, Route } from '@playwright/test';
import {
  buildRequestResponse,
  buildSelectedManualReleaseList,
  buildQueueResponse,
  configStatusFixture,
  emptyDashboardResponse,
  emptyQueueResponse,
  manualReleaseListFixture,
  movieSearchItem,
  searchResultsForQuery,
  seriesSearchItem,
} from './fixtures';

type SearchResponseResolver = (url: URL) => unknown;
type RequestResponseResolver = (body: Record<string, unknown>) => unknown;
type RequestAwareResolver = (request: Request, url: URL) => unknown;
type ManualReleaseResponseResolver = (jobId: string, request: Request, url: URL) => unknown;
type SelectManualReleaseResponseResolver = (
  jobId: string,
  body: Record<string, unknown>,
  request: Request,
  url: URL,
) => MockRouteResult | unknown;

type MockApiOptions = {
  dashboard?: unknown | RequestAwareResolver;
  manualReleaseResponse?: ManualReleaseResponseResolver;
  plexRecent?: unknown;
  queue?: unknown | RequestAwareResolver;
  requestResponse?: RequestResponseResolver;
  searchResponse?: SearchResponseResolver;
  selectManualReleaseResponse?: SelectManualReleaseResponseResolver;
};

export type MockApiController = {
  dashboardRequests: string[];
  manualReleaseRequests: string[];
  queueRequests: string[];
  requestBodies: Record<string, unknown>[];
  searchUrls: string[];
  selectManualReleaseBodies: Array<{ body: Record<string, unknown>; jobId: string }>;
};

type MockRouteResult =
  | {
      delayMs?: number;
      json: unknown;
      status?: number;
    }
  | {
      body: string;
      contentType?: string;
      delayMs?: number;
      status: number;
    };

export function mockJson(json: unknown, delayMs = 0, status = 200): MockRouteResult {
  return {
    delayMs,
    json,
    status,
  };
}

export function mockTextError(body: string, status = 500, delayMs = 0): MockRouteResult {
  return {
    body,
    contentType: 'text/plain; charset=utf-8',
    delayMs,
    status,
  };
}

function isMockRouteResult(value: unknown): value is MockRouteResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (Object.prototype.hasOwnProperty.call(value, 'json') ||
        Object.prototype.hasOwnProperty.call(value, 'body')),
  );
}

async function fulfillResolvedRoute(route: Route, resolved: unknown): Promise<void> {
  if (isMockRouteResult(resolved)) {
    if (resolved.delayMs && resolved.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, resolved.delayMs));
    }

    if ('json' in resolved) {
      await route.fulfill({
        json: resolved.json,
        status: resolved.status ?? 200,
      });
      return;
    }

    await route.fulfill({
      body: resolved.body,
      contentType: resolved.contentType,
      status: resolved.status,
    });
    return;
  }

  await route.fulfill({ json: resolved });
}

function requestedItemFromBody(
  body: Record<string, unknown>,
): typeof movieSearchItem | typeof seriesSearchItem {
  const item =
    body.item && typeof body.item === 'object' && !Array.isArray(body.item)
      ? (body.item as Record<string, unknown>)
      : {};

  if (item.kind === 'series') {
    return {
      ...seriesSearchItem,
      ...item,
    };
  }

  return {
    ...movieSearchItem,
    ...item,
  };
}

export async function mockAppApi(
  page: Page,
  options: MockApiOptions = {},
): Promise<MockApiController> {
  const controller: MockApiController = {
    dashboardRequests: [],
    manualReleaseRequests: [],
    queueRequests: [],
    requestBodies: [],
    searchUrls: [],
    selectManualReleaseBodies: [],
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/config/status') {
      await route.fulfill({ json: configStatusFixture });
      return;
    }

    if (url.pathname === '/api/dashboard' || url.pathname === '/api/dashboard/refresh') {
      controller.dashboardRequests.push(url.toString());
      const payload =
        typeof options.dashboard === 'function'
          ? options.dashboard(request, url)
          : (options.dashboard ?? emptyDashboardResponse);
      await fulfillResolvedRoute(route, payload);
      return;
    }

    if (url.pathname === '/api/queue') {
      controller.queueRequests.push(url.toString());
      const payload =
        typeof options.queue === 'function'
          ? options.queue(request, url)
          : (options.queue ?? emptyQueueResponse);
      await fulfillResolvedRoute(route, payload);
      return;
    }

    const manualReleaseMatch = url.pathname.match(/^\/api\/acquisition\/([^/]+)\/releases$/);
    if (manualReleaseMatch) {
      const jobId = decodeURIComponent(manualReleaseMatch[1] ?? '');
      controller.manualReleaseRequests.push(url.toString());
      const payload =
        options.manualReleaseResponse?.(jobId, request, url) ??
        (jobId === manualReleaseListFixture.jobId
          ? manualReleaseListFixture
          : {
              ...buildSelectedManualReleaseList(),
              jobId,
            });
      await fulfillResolvedRoute(route, payload);
      return;
    }

    const selectManualReleaseMatch = url.pathname.match(/^\/api\/acquisition\/([^/]+)\/select$/);
    if (selectManualReleaseMatch) {
      const jobId = decodeURIComponent(selectManualReleaseMatch[1] ?? '');
      const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
      controller.selectManualReleaseBodies.push({ body, jobId });
      const payload =
        options.selectManualReleaseResponse?.(jobId, body, request, url) ??
        mockJson({
          job: buildQueueResponse().acquisitionJobs[0],
          message: 'Manual release selected.',
        });
      await fulfillResolvedRoute(route, payload);
      return;
    }

    if (url.pathname === '/api/plex/recent') {
      await route.fulfill({ json: options.plexRecent ?? [] });
      return;
    }

    if (url.pathname === '/api/search') {
      controller.searchUrls.push(url.toString());
      const payload =
        options.searchResponse?.(url) ?? searchResultsForQuery(url.searchParams.get('q') ?? '');
      await route.fulfill({ json: payload });
      return;
    }

    if (url.pathname === '/api/request') {
      const body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
      controller.requestBodies.push(body);
      const payload =
        options.requestResponse?.(body) ??
        buildRequestResponse(
          requestedItemFromBody(body),
          Array.isArray(body.seasonNumbers)
            ? body.seasonNumbers.filter((value): value is number => typeof value === 'number')
            : undefined,
        );
      await fulfillResolvedRoute(route, payload);
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      body: `No UI fixture for ${url.pathname}`,
    });
  });

  return controller;
}
