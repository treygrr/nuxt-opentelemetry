/** Where instrumentation.ts keeps the started NodeSDK, so the Nitro plugin can shut it down. */
export const SDK_KEY = Symbol.for('@treygrr/nuxt-opentelemetry/sdk');
