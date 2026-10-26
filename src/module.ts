import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
    addNitroPlugin,
    addPlugin,
    addServerHandler,
    addServerTemplate,
    addTypeTemplate,
    createResolver,
    defineNuxtModule,
    useLogger
} from '@nuxt/kit';

import { findHiddenRequires } from './hidden-requires.ts';

export type ModuleOptions = {
    /**
     * Start the OpenTelemetry SDK in the built server. `OTEL_SDK_DISABLED=true` turns it off at runtime.
     * @default true
     */
    enabled: boolean;
    /**
     * Requests that get no span. Strings match path prefixes, regular expressions are tested against the path.
     * Nuxt's build assets and the files in `public/` are always ignored.
     * @default ['/__nuxt', '/_ipx/', '/_fonts/']
     */
    ignore: (string | RegExp)[];
    /**
     * A route for load balancers' and Kubernetes' probes, answering `GET` with `ok`. Probes poll every few seconds,
     * so it's left out of traces, where it would bury every other request.
     */
    healthCheck: {
        /**
         * Where it's served, or `false` for none. Served even with `enabled: false`, so probes keep working.
         * @default '/_health'
         */
        route: string | false;
        /**
         * Trace its requests too.
         * @default false
         */
        trace: boolean;
    };
};

/** Presets whose entry the module can run the SDK before. */
const SUPPORTED_PRESETS = ['node-server'];

const OPTIONS_ID = '#nuxt-opentelemetry/options';

const logger = useLogger('opentelemetry');

/** Every file in `dir`, as a URL path */
const listFiles = async (dir: string): Promise<string[]> => {
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => `/${relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/')}`);
};

/** Matches exactly `path`, unlike a string matcher, which matches every path starting with it */
const exactly = (path: string) => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

const serializeMatcher = (matcher: string | RegExp) =>
    matcher instanceof RegExp
        ? `new RegExp(${JSON.stringify(matcher.source)}, ${JSON.stringify(matcher.flags)})`
        : JSON.stringify(matcher);

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: '@treygrr/nuxt-opentelemetry',
        configKey: 'opentelemetry',
        compatibility: { nuxt: '^4.6.0' }
    },
    defaults: {
        enabled: true,
        ignore: ['/__nuxt', '/_ipx/', '/_fonts/'],
        healthCheck: { route: '/_health', trace: false }
    },
    setup(options, nuxt) {
        const { resolve } = createResolver(import.meta.url);

        const healthRoute = options.healthCheck.route;
        if (healthRoute) {
            addServerHandler({
                route: healthRoute,
                method: 'get',
                handler: resolve('./runtime/server/routes/health')
            });
        }

        if (!options.enabled) return;

        // Names page-render spans after the Vue route, and request spans after the Nitro route.
        addPlugin({ src: resolve('./runtime/app/plugins/route.server'), mode: 'server' });
        // Written against nitropack v2 and h3 v1, which Nitro v3 hosts also run through their compatibility layer.
        addNitroPlugin({ nitro2: resolve('./runtime/server/plugins/opentelemetry') });

        addServerTemplate({
            filename: OPTIONS_ID,
            getContents: async () => {
                const publicFiles = await listFiles(nuxt.options.dir.public);
                const prefixes = [nuxt.options.app.buildAssetsDir];
                const health = healthRoute && !options.healthCheck.trace ? [exactly(healthRoute)] : [];
                const ignore = [...prefixes, ...health, ...options.ignore];
                return [
                    `export const ignore = [${ignore.map(serializeMatcher).join(', ')}];`,
                    `export const publicFiles = new Set(${JSON.stringify(publicFiles)});`
                ].join('\n');
            }
        });
        addTypeTemplate(
            {
                filename: 'types/nuxt-opentelemetry.d.ts',
                getContents: () =>
                    [
                        `declare module '${OPTIONS_ID}' {`,
                        '    export const ignore: (string | RegExp)[];',
                        '    export const publicFiles: Set<string>;',
                        '}',
                        "declare module 'h3' {",
                        '    interface H3EventContext {',
                        '        /** The route template of the page rendered for this request, eg `/play/:slug` */',
                        '        opentelemetryRoute?: string;',
                        '    }',
                        '}',
                        'export {};'
                    ].join('\n')
            },
            { nitro: true, nuxt: true }
        );

        nuxt.hook('nitro:init', async (nitro) => {
            const { preset, entry } = nitro.options;
            // Prerendering, `nuxt dev` and tests run other presets, so they never start the SDK.
            if (!SUPPORTED_PRESETS.includes(preset)) {
                if (!nitro.options.dev && preset !== 'nitro-prerender') {
                    logger.warn(`Tracing only runs on the ${SUPPORTED_PRESETS.join(', ')} preset, not ${preset}.`);
                }
                return;
            }
            // The SDK must patch modules before the app imports them, so the entry loads it first.
            nitro.options.virtual['#nuxt-opentelemetry/entry'] = [
                `await import(${JSON.stringify(resolve('./runtime/instrumentation'))});`,
                `await import(${JSON.stringify(entry)});`
            ].join('\n');
            nitro.options.entry = '#nuxt-opentelemetry/entry';

            nitro.options.externals.traceInclude = [
                ...(nitro.options.externals.traceInclude ?? []),
                ...(await findHiddenRequires(resolve('..')))
            ];
        });
    }
});
