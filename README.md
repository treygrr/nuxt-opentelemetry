<p align="center">
  <img src=".github/assets/nuxt-otel.png" alt="Nuxt + OpenTelemetry" width="600">
</p>

<h1 align="center">@treygrr/nuxt-opentelemetry</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@treygrr/nuxt-opentelemetry"><img src="https://img.shields.io/npm/v/@treygrr/nuxt-opentelemetry?color=00DC82&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@treygrr/nuxt-opentelemetry"><img src="https://img.shields.io/npm/dm/@treygrr/nuxt-opentelemetry?color=4f62ad" alt="npm downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@treygrr/nuxt-opentelemetry?color=blue" alt="license"></a>
  <a href="https://nuxt.com"><img src="https://img.shields.io/badge/Nuxt-4.6+-00DC82?logo=nuxt.js&logoColor=white" alt="Nuxt 4.6+"></a>
</p>

<p align="center">
  🔭 OpenTelemetry tracing for your Nuxt server, with spans named after your routes. ✨
</p>

---

Add the module, set a couple of `OTEL_*` env vars, and you get traces. 🎉

It starts the OpenTelemetry Node SDK before Nitro loads, so each request gets an HTTP server span, and names that span
after the Nuxt page or Nitro route that handled it (`GET /items/:id`). Everything else is configured with the standard
`OTEL_*` environment variables.

## ✨ Features

- 🧱 **Built on the OpenTelemetry JS 3.0 SDK** (`@opentelemetry/api` 1.10, `sdk-node` 0.300).
- 🔌 **Loads the Node auto-instrumentations**, so outgoing `fetch` calls, database clients and so on get child spans.
- 🪝 **Uses Node's synchronous module hooks** (`module.registerHooks`) through `import-in-the-middle` 3.
- 🧹 **Flushes queued spans when Nitro shuts down** (SIGTERM), so a pod being replaced doesn't lose its last traces.
- 💓 **Serves a health check route** at `/_health` for load balancers and Kubernetes probes, left out of traces so
  probes polling every few seconds don't bury real requests.

## 🚀 Setup

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

### 📋 Requirements

- **Nuxt 4.6+** with the `node-server` Nitro preset (the default for `nuxt build`).
- **Node `^22.22.3` or `>=24.11.1`**, which can run synchronous module hooks. On older versions the SDK still starts,
  but ESM packages aren't instrumented and a warning is logged.

## 🏷️ Spans

| Request | Span name | `http.route` |
| --- | --- | --- |
| A page, eg `/items/42` | `GET /items/:id` (from the Vue route) | `/items/:id` |
| A Nitro route, eg `/api/items/7` | `GET /api/items/:id` | `/api/items/:id` |
| Nothing matched (404) | `GET` | not set |

Errors with a 5xx status are recorded on the span as an `exception` event. The route is also added to the
`http.server.request.duration` metric.

No spans are created for Nuxt's build assets (`/_nuxt/`), the files in `public/`, the health check route, or the
paths in `ignore`.

## 💓 Health check

`GET /_health` answers `ok` (uncached) while the server is up. Point your probes at it:

```yaml
# A Kubernetes container
readinessProbe:
    httpGet:
        path: /_health
        port: http
```

Probes poll every few seconds, so its requests aren't traced: on `/`, they'd bury every real request in your
tracing backend. Move it, trace it, or turn it off with `healthCheck` below. It's served even with `enabled: false`.

## ⚙️ Options

```ts
export default defineNuxtConfig({
    opentelemetry: {
        // Turn the module off at build time. Use OTEL_SDK_DISABLED=true to turn it off at runtime.
        enabled: true,
        // Requests that get no span: strings match path prefixes, regular expressions are tested against the path.
        ignore: ['/__nuxt', '/_ipx/', '/_fonts/'],
        healthCheck: {
            // Where the health check is served, or false for none.
            route: '/_health',
            // Trace its requests too.
            trace: false
        }
    }
});
```

## 🌱 Environment variables

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

## ⚠️ Limitations

- **Only the built `node-server` output is traced.** `nuxt dev`, prerendering and tests run other presets and don't
  start the SDK.
- **Code Nitro bundles can't be patched.** Auto-instrumentations work on packages Nitro keeps external (in
  `.output/server/node_modules`) and on Node built-ins. To trace a bundled package, add it to
  `nitro.externals.external`.
- **Built for Nitro 2.** The Nitro plugin is registered as the `nitro2` variant (`addNitroPlugin({ nitro2 })`), which
  Nuxt also runs on Nitro v3 hosts through its compatibility layer, but tracing hasn't been tested on Nitro v3. A
  `nitro3` variant could use h3 v2's tracing channels (`h3.request`) instead.

## 🧠 How it works

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

## 🛠️ Development

```bash
pnpm install
pnpm dev:prepare
pnpm test        # builds the module and the playground, then checks the spans the built server sends
pnpm typecheck
pnpm fmt
```

`pnpm release <version>` bumps, commits and tags a version; pushing the tag publishes it from CI.

## 💚 Credits

The idea of naming request spans after the Nuxt route comes from [`@scayle/nuxt-opentelemetry`][scayle] (MIT).

[scayle]: https://github.com/scayle/nuxt-opentelemetry

## 📄 License

[MIT](./LICENSE). Happy tracing! 🔭
