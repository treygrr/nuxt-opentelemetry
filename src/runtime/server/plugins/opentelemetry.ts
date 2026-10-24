import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { H3Event } from 'h3';
import { defineNitroPlugin } from 'nitropack/runtime';

import { SDK_KEY } from '../../sdk';

/** Nitro serves pages that no server route matches from this catch-all. */
const RENDERER_ROUTE = '/**';

/** The route template for the request, if one is known */
const getRoute = (event: H3Event) => {
    if (event.context.opentelemetryRoute) return event.context.opentelemetryRoute;
    const path: string | undefined = event.context.matchedRoute?.path;
    return path && path !== RENDERER_ROUTE ? path : undefined;
};

export default defineNitroPlugin((nitroApp) => {
    // The HTTP instrumentation reads the route from the request's RPC metadata when the response
    // finishes: it sets `http.route`, names the span `GET /route` and adds the route to the metrics.
    nitroApp.hooks.hook('beforeResponse', (event) => {
        const rpcMetadata = getRPCMetadata(context.active());
        if (rpcMetadata?.type !== RPCType.HTTP || rpcMetadata.route) return;
        rpcMetadata.route = getRoute(event);
    });

    // Nitro sends error responses before `beforeResponse` runs, so the route is set here too.
    nitroApp.hooks.hook('error', (error, { event }) => {
        if (!event) return;
        const rpcMetadata = getRPCMetadata(context.active());
        if (rpcMetadata?.type !== RPCType.HTTP) return;
        rpcMetadata.route ??= getRoute(event);
        const statusCode: number = (error as { statusCode?: number }).statusCode ?? 500;
        if (statusCode >= 500) rpcMetadata.span.recordException(error);
    });

    // Nitro calls this on SIGTERM/SIGINT, so spans still queued are sent before the process exits.
    nitroApp.hooks.hook('close', async () => {
        await (globalThis as Record<symbol, NodeSDK | undefined>)[SDK_KEY]?.shutdown();
    });
});
