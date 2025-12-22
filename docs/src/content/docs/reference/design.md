---
title: Design & Usage
---

Errata is a throw-first, typed error registry for TypeScript apps.

- Central **codes registry** with `defineCodes` + `code` + `props`
- Same types on **server and client**
- Strong helpers: `create`/`throw`, `is`/`match`, `hasTag`, `serialize`/`deserialize`
- Status is intentionally typed as `number` for framework compatibility
- Tags are metadata; they stay `string[]` at runtime, but `hasTag` narrows when tags are literal

---

## 1. Define codes

Flat or one-level nested map that flattens to `"domain.code"` keys.

```ts
// shared/error-config.ts
import { code, defineCodes, props } from 'errata'

export const codes = defineCodes({
  core: {
    internal_error: { status: 500, message: 'Internal error', tags: ['core'] },
  },
  auth: {
    invalid_token: code({
      status: 401,
      message: 'Invalid token',
      tags: ['auth', 'security'],
      details: props<{ reason: 'expired' | 'revoked' }>(), // strict details
    }),
    rate_limited: code({
      status: 429,
      message: ({ details }) => `Retry after ${details.retryAfter}s`,
      tags: ['auth'],
      details: props({ retryAfter: 60 }), // defaults, details optional at call-site
    }),
  },
} as const)

export type ErrorCode = keyof typeof codes
```

Notes:
- `code` is a typed identity; no manual generics. Use it when you have `details`. If there are no details, plain objects are fine.
- `props<T>()` = strict required details (runtime `undefined`).
- `props({ ... })` = optional details with defaults.
- Tags are wide (`string[]`) by design; use `as const` if you want `hasTag` narrowing.

---

## 2. Server: `errata(...)`

```ts
import { errata } from 'errata'
import { codes } from './shared/error-config'

export const errors = errata({
  app: 'my-app',
  env: process.env.NODE_ENV,
  defaultStatus: 500,
  defaultExpose: false,
  codes,
})

// Usage
throw errors.create('auth.invalid_token', { reason: 'expired' })
const err = errors.create('auth.rate_limited') // uses default retryAfter

if (errors.hasTag(err, 'auth')) {
  // err is narrowed to auth codes, details are typed
}

errors.match(err, {
  'auth.invalid_token': e => `invalid:${e.details.reason}`,
  'auth.*': e => `auth:${e.code}`,
  'default': e => `fallback:${e.code}`,
})
```

- `status` remains `number` to interop with HTTP frameworks.
- `hasTag` is a type guard when tags are literal (`as const` in the config).
- `serialize`/`deserialize` and `http.from` use the same types.

---

## 3. Client: `createErrorClient(...)`

```ts
import type { errors } from '../server/errors'
import { createErrorClient } from 'errata'

const client = createErrorClient<typeof errors>()

const err = client.deserialize(serverPayload)
if (client.is(err, 'auth.*')) {
  // typed narrowing
}
if (client.hasTag(err, 'auth')) {
  // tag-based narrowing
}
```

The client only needs the serialized payload plus the server type (`typeof errors`) to get matching code/detail types.
