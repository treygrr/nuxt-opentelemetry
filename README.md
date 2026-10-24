# @treygrr/nuxt-opentelemetry

OpenTelemetry tracing for Nuxt servers. It starts the OpenTelemetry Node SDK before Nitro loads, so each request gets an
HTTP server span, and names that span after the Nuxt page or Nitro route that handled it (`GET /items/:id`).
Everything else is configured with the standard `OTEL_*` environment variables.

- Built on the OpenTelemetry JS 3.0 SDK (`@opentelemetry/api` 1.10, `sdk-node` 0.300).
- Loads the Node auto-instrumentations, so outgoing `fetch` calls, database clients and so on get child spans.
- Uses Node's synchronous module hooks (`module.registerHooks`) through `import-in-the-middle` 3.
- Flushes queued spans when Nitro shuts down (SIGTERM), so a pod being replaced doesn't lose its last traces.

## Setup

```bash
pnpm add @treygrr/nuxt-opentelemetry
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    modules: ['@treygrr/nuxt-opentelemetry']
});
```

Then point the built server at an OTLP endpoint:

```bash
OTEL_SERVICE_NAME=my-app \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
node .output/server/index.mjs
```

Requirements:

- **Nuxt 4** with the `node-server` Nitro preset (the default for `nuxt build`).
- **Node `^22.22.3` or `>=24.11.1`**, which can run synchronous module hooks. On older versions the SDK still starts,
  but ESM packages aren't instrumented and a warning is logged.

## Spans

| Request | Span name | `http.route` |
| --- | --- | --- |
| A page, eg `/items/42` | `GET /items/:id` (from the Vue route) | `/items/:id` |
| A Nitro route, eg `/api/items/7` | `GET /api/items/:id` | `/api/items/:id` |
| Nothing matched (404) | `GET` | not set |

Errors with a 5xx status are recorded on the span as an `exception` event. The route is also added to the
`http.server.request.duration` metric.

No spans are created for Nuxt's build assets (`/_nuxt/`), the files in `public/`, or the paths in `ignore`.

## Options

```ts
export default defineNuxtConfig({
    opentelemetry: {
        // Turn the module off at build time. Use OTEL_SDK_DISABLED=true to turn it off at runtime.
        enabled: true,
        // Requests that get no span: strings match path prefixes, regular expressions are tested against the path.
        ignore: ['/__nuxt', '/_ipx/', '/_fonts/', /^\/healthz$/]
    }
});
```

## Environment variables

These are read by the OpenTelemetry SDK, so the [standard documentation][env] applies. The common ones:

| Variable | Description |
| --- | --- |
| `OTEL_SERVICE_NAME` | The `service.name` resource attribute. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The collector, eg `http://localhost:4318`. Defaults to `http://localhost:4318`. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default), `http/json` or `grpc`. |
| `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` | `otlp` (default) or `none`, among others. |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes, eg `deployment.environment.name=production`. |
| `OTEL_NODE_DISABLED_INSTRUMENTATIONS` | Auto-instrumentations to skip, eg `fs,dns,net`. |
| `OTEL_NODE_ENABLED_INSTRUMENTATIONS` | Only load these auto-instrumentations. |
| `OTEL_SDK_DISABLED` | `true` starts the server without the SDK. |
| `OTEL_LOG_LEVEL` | SDK diagnostics, eg `debug`. |

[env]: https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/

## Limitations

- **Only the built `node-server` output is traced.** `nuxt dev`, prerendering and tests run other presets and don't
  start the SDK.
- **Code Nitro bundles can't be patched.** Auto-instrumentations work on packages Nitro keeps external (in
  `.output/server/node_modules`) and on Node built-ins. To trace a bundled package, add it to
  `nitro.externals.external`.
- **Nitro v3 isn't supported yet.** It has its own tracing channels (`h3.request`), which a later version can use.

## How it works

- At build time the module replaces Nitro's entry with one that first imports `runtime/instrumentation`, then the
  server. That file registers `import-in-the-middle`'s synchronous hooks and starts `NodeSDK` with the auto-
  instrumentations.
- The HTTP instrumentation creates the server span. A Nitro plugin sets the route on the request's `RPCMetadata`, the
  same mechanism the Express instrumentation uses, and the HTTP instrumentation then names the span and sets
  `http.route`. A server-only Nuxt plugin supplies the Vue route for page renders.
- Workarounds for current upstream issues:
    - The OpenTelemetry 3.0 packages are built with rolldown, whose ESM output loads some dependencies through
      `createRequire` (eg `forwarded-parse`). Nitro's file tracer doesn't see those, so the module finds them and adds
      them to `nitro.externals.traceInclude`.
    - The SDK's exporters load `http` before the HTTP instrumentation's require hook exists, so `http` would only be
      patched on its next `require`, after Nitro created its server, and the first request would get no span. The SDK
      file requires `http` and `https` once right after starting.

## Development

```bash
pnpm install
pnpm dev:prepare
pnpm test        # builds the module and the playground, then checks the spans the built server sends
pnpm typecheck
pnpm fmt
```

`pnpm release <version>` bumps, commits and tags a version; pushing the tag publishes it from CI.

## Credits

The idea of naming request spans after the Nuxt route comes from [`@scayle/nuxt-opentelemetry`][scayle] (MIT).

[scayle]: https://github.com/scayle/nuxt-opentelemetry

## License

MIT
