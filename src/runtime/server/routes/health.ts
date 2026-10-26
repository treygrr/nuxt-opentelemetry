import { defineEventHandler, setResponseHeader } from 'h3';

/** For load balancers' and Kubernetes' probes: the server is up and answering requests. */
export default defineEventHandler((event) => {
    setResponseHeader(event, 'cache-control', 'no-store');
    return 'ok';
});
