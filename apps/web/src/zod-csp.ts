// Must be the first import of main.tsx. zod 4 compiles object parsers with
// `new Function` unless `jitless` is set, and probes for it while each object schema is
// built, i.e. as soon as @lectern/domain is evaluated. Under `script-src 'self'` that
// probe is refused and reported as a CSP violation even though zod catches it. jitless
// parsing is slower only for very large payloads.

import { z } from "zod";

z.config({ jitless: true });
