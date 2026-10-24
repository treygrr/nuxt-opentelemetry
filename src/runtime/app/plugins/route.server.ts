import { defineNuxtPlugin, useRequestEvent, useRouter } from '#app';

/** Nuxt writes params as `:slug()`; span names use the plain `:slug` form. */
const toRouteTemplate = (path: string) => path.replace(/\(\)/g, '');

export default defineNuxtPlugin((nuxtApp) => {
    const event = useRequestEvent();
    if (!event) return;
    const router = useRouter();
    nuxtApp.hooks.hook('app:rendered', () => {
        const record = router.currentRoute.value.matched.at(-1);
        if (record) event.context.opentelemetryRoute = toRouteTemplate(record.path);
    });
});
