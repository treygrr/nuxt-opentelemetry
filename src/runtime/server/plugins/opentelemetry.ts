import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType, type RPCMetadata } from '@opentelemetry/core';
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

/**
 * The event that handles each HTTP request. Requests Nitro makes to itself while handling one,
 * like `$fetch('/api/…')` during server rendering, run in the same async context and so see
 * the same RPC metadata; only the event that claimed it first may name the span.
 */
const owners = new WeakMap<RPCMetadata, H3Event>();

/** The request's RPC metadata, if `event` is the one handling that request */
const ownMetadata = (event: H3Event) => {
    const rpcMetadata = getRPCMetadata(context.active());
    if (rpcMetadata?.type !== RPCType.HTTP || owners.get(rpcMetadata) !== event) return undefined;
    return rpcMetadata;
};

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('request', (event) => {
        const rpcMetadata = getRPCMetadata(context.active());
        if (rpcMetadata?.type === RPCType.HTTP && !owners.has(rpcMetadata)) owners.set(rpcMetadata, event);
    });

    // The HTTP instrumentation reads the route from the request's RPC metadata when the response
    // finishes: it sets `http.route`, names the span `GET /route` and adds the route to the metrics.
    nitroApp.hooks.hook('beforeResponse', (event) => {
        const rpcMetadata = ownMetadata(event);
        if (!rpcMetadata || rpcMetadata.route) return;
        rpcMetadata.route = getRoute(event);
    });

    // Nitro sends error responses before `beforeResponse` runs, so the route is set here too.
    nitroApp.hooks.hook('error', (error, { event }) => {
        if (!event) return;
        const rpcMetadata = ownMetadata(event);
        if (!rpcMetadata) return;
        rpcMetadata.route ??= getRoute(event);
        const statusCode: number = (error as { statusCode?: number }).statusCode ?? 500;
        if (statusCode >= 500) rpcMetadata.span.recordException(error);
    });

    // Nitro calls this on SIGTERM/SIGINT, so spans still queued are sent before the process exits.
    nitroApp.hooks.hook('close', async () => {
        await (globalThis as Record<symbol, NodeSDK | undefined>)[SDK_KEY]?.shutdown();
    });
});
