## better-errors – Design

A throw-based, typed, full-stack error model for TypeScript apps.

- Keep async/await + `throw` (Rails/Laravel/Laravel-ish).
- Central, typed **error codes registry**.
- Same error model on **server and client**.
- Optional **typed zones** (`scoped`, `safe`) when you want stronger guarantees.
- Zero runtime dependencies.

> API shape & DX are inspired by **better-auth**: one server factory, a light client, strong typing, minimal ceremony.

---

## 1. Core model

### 1.1 Codes registry (heart of the lib)

Primary, “blessed” shape: **flat map of string codes**.

```ts
// shared/error-config.ts
import { defineCodes } from 'better-errors'

export const codes = defineCodes({
  'auth.invalid_token': {
    status: 401,
    message: 'Your session expired',
    expose: true,
    retryable: false,
    tags: ['auth'],
  },
  'billing.payment_failed': {
    status: 402,
    message: 'Payment failed',
    expose: true,
    retryable: true,
    tags: ['billing'],
  },
} as const)

export type ErrorCode = keyof typeof codes
```

Key points:

- `ErrorCode = keyof typeof codes` → `"auth.invalid_token" | "billing.payment_failed" | ...`.
- All public APIs that accept a code are constrained by `ErrorCode` (no untyped magic strings).
- Runtime representation is simple strings (good for logs/transport).

#### 1.1.1 Optional nested syntax

Sugar: nested groups that flatten to `"domain.code"`.

```ts
const codes = defineCodes({
  auth: {
    invalid_token: {
      status: 401,
      message: 'Your session expired',
      tags: ['auth'],
    },
  },
  billing: {
    payment_failed: {
      status: 402,
      message: 'Payment failed',
      tags: ['billing'],
    },
  },
} as const)
```

Internal normalization:

- `auth.invalid_token`
- `billing.payment_failed`

The rest of the system only sees the flattened `ErrorCode` union.

#### 1.1.2 Per-code config

Minimal initial fields:

```ts
interface CodeConfig {
  status?: number
  message: string | ((ctx: { details: unknown }) => string)
  expose?: boolean
  retryable?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  tags?: string[]
  // future: typed details / schema
}
```

- Field semantics:
  - `status` – optional numeric code. In HTTP apps this is usually the HTTP status; in other environments it can be ignored or used as a generic classification/exit code.
  - `details` – structured payload for the code, typed per code. Attach domain data (IDs, validation issues, provider codes, etc.). The library passes it through unchanged.
  - `expose` – whether the error is safe to show directly to end users; advisory for boundaries.
  - `retryable` – hint about whether retrying makes sense; no retries are performed automatically.
  - `logLevel` – suggested log severity. Core does not log; plugins/callers may.
  - `tags` – free-form labels for grouping/matching (e.g. `auth`, `billing`, `stripe`, `infra`).
  - `env` – server-side metadata only (e.g. `development`, `staging`, `production`); intentionally not serialized to clients unless explicitly added.

---

## 2. Server instance: `betterErrors(...)`

Factory that creates the **server-side** error instance.

```ts
// server/errors.ts
import { betterErrors } from 'better-errors'
import { codes } from '../shared/error-config'

export const errors = betterErrors({
  app: 'coollab',
  env: process.env.NODE_ENV,
  defaultStatus: 500,
  defaultExpose: false,
  codes,
  plugins: [
    // e.g. sentryPlugin(), consoleLoggerPlugin()
  ],
  redactKeys: ['password', 'cardNumber'],
  captureStack: process.env.NODE_ENV !== 'production',
})

export type Errors = typeof errors // 👈 for the client (type-only)
```

Notes:
- `env` is server-side metadata for logging/plugins; it is not serialized to clients unless you add it yourself.
- `status` is a generic numeric code (often the HTTP status in web apps, otherwise a classification/exit code).

### 2.1 `BetterErrorsInstance` shape (server)

Internal interface (simplified):

```ts
export interface BetterErrorsInstance<TCode extends string> {
  // base class
  AppError: new (...args: any[]) => AppError<TCode>

  // creation / throwing
  create: <C extends TCode>(code: C, details?: unknown) => AppError<C>
  throw: <C extends TCode>(code: C, details?: unknown) => never

  // normalization
  ensure: (err: unknown, fallbackCode?: TCode) => AppError<TCode>

  // inspection
  is: <C extends TCode>(err: unknown, code: C | readonly C[]) => err is AppError<C>
  match: <R>(
    err: unknown,
    cases: {
      [C in TCode]?: (e: AppError<C>) => R;
    } & { default: (e: AppError<TCode>) => R }
  ) => R
  hasTag: (err: unknown, tag: string) => boolean

  // transport / HTTP
  serialize: (err: AppError<TCode>) => SerializedError<TCode>
  deserialize: (json: SerializedError<TCode>) => AppError<TCode>
  http: {
    from: (err: unknown) => { status: number, body: unknown }
  }

  // plugins run against this
  // ...

  /** type-only code brand for client-side typing */
  _codesBrand?: TCode
}
```

### 2.2 `AppError`

Single runtime error type for the app.

```ts
export class AppError<C extends string = string> extends Error {
  readonly name = 'AppError'
  readonly app?: string
  readonly code: C
  readonly status: number
  readonly expose: boolean
  readonly retryable: boolean
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  readonly tags: string[]
  readonly details: unknown
  readonly cause?: unknown

  toJSON(): SerializedError<C>
}
```

Apps may optionally subclass:

```ts
export class MyAppError<
  C extends ErrorCode = ErrorCode,
> extends errors.AppError<C> {}
```

…but main DX is **code-based**, not class-based.

### 2.3 Serialized form

Used over the wire:

```ts
export interface SerializedError<C extends string = string> {
  __brand: 'better-errors'
  app?: string
  code: C
  message: string
  status?: number
  retryable?: boolean
  logLevel?: string
  tags?: string[]
  details?: unknown // redacted as per config
}
```

---

## 3. Client error client (type-only handshake)

We **do not** share runtime config; client only sees types.

### 3.1 Type plumbing

Helper types:

```ts
export type CodesOf<T extends { _codesBrand?: any }> = NonNullable<
  T['_codesBrand']
>
```

`betterErrors` must set `_codesBrand`:

```ts
function betterErrors<TCode extends string>(options: {
  codes: CodesDefinition<TCode> /* ... */
}): BetterErrorsInstance<TCode> {
  // ...
  const instance: BetterErrorsInstance<TCode> = {
    // ...
    _codesBrand: undefined as any as TCode,
  }
  return instance
}
```

### 3.2 Client-side types & factory

Client error type:

```ts
export class ClientAppError<C extends string = string> extends Error {
  code: C
  status?: number
  retryable?: boolean
  tags?: string[]
  details?: unknown

  constructor(payload: SerializedError<C>) {
    super(payload.message)
    this.name = 'AppError'
    this.code = payload.code
    this.status = payload.status
    this.retryable = payload.retryable
    this.tags = payload.tags
    this.details = payload.details
  }
}
```

Client surface:

```ts
export interface ErrorClient<TCode extends string> {
  AppError: new (payload: SerializedError<TCode>) => ClientAppError<TCode>

  deserialize: (json: SerializedError<TCode>) => ClientAppError<TCode>

  is: <C extends TCode>(
    err: unknown,
    code: C | readonly C[]
  ) => err is ClientAppError<C>

  match: <R>(
    err: unknown,
    cases: {
      [C in TCode]?: (e: ClientAppError<C>) => R;
    } & { default: (e: ClientAppError<TCode>) => R }
  ) => R

  hasTag: (err: unknown, tag: string) => boolean
}
```

Factory (`better-errors/client`):

```ts
export function createErrorClient<
  TServer extends BetterErrorsInstance<string>,
>(): ErrorClient<CodesOf<TServer>> {
  type Code = CodesOf<TServer>

  return {
    AppError: ClientAppError<Code>,
    deserialize(json) {
      return new ClientAppError<Code>(json)
    },
    is(err, codeOrCodes) {
      if (!(err instanceof ClientAppError))
        return false
      const codes = Array.isArray(codeOrCodes) ? codeOrCodes : [codeOrCodes]
      return codes.includes(err.code as Code)
    },
    match(err, cases) {
      const e = err instanceof ClientAppError ? err : undefined
      if (!e)
        return cases.default(err as any)
      const handler = (cases as any)[e.code] ?? cases.default
      return handler(e)
    },
    hasTag(err, tag) {
      if (!(err instanceof ClientAppError))
        return false
      return (err.tags ?? []).includes(tag)
    },
  }
}
```

### 3.3 Usage pattern

**Server:**

```ts
// server/errors.ts
import { betterErrors } from 'better-errors'
import { codes } from '../shared/error-config'

export const errors = betterErrors({
  app: 'coollab',
  env: process.env.NODE_ENV,
  codes,
  plugins: [
    // server-only plugins
  ],
})

export type Errors = typeof errors
```

**Client:**

```ts
// client/error-client.ts
import type { Errors } from '../server/errors'
import { createErrorClient } from 'better-errors/client'

export const errorClient = createErrorClient<Errors>()
```

**Client usage:**

```ts
const res = await fetch('/api/me')

if (!res.ok) {
  const { error } = await res.json()
  throw errorClient.deserialize(error)
}

try {
  await fetchMe()
}
catch (err) {
  if (errorClient.is(err, 'auth.invalid_token')) {
    // e.g. redirect to login
  }
  else {
    // generic handling
  }
}
```

Note: `Errors` is imported with `import type` → **no server code** in the client bundle.

---

## 4. Typed zones (optional)

### 4.1 `scoped`: declare allowed codes per function

```ts
export interface ScopedErrors<C extends string> {
  throw: <T extends C>(code: T, details?: unknown) => never
  create: <T extends C>(code: T, details?: unknown) => AppError<T>
  is: (err: unknown, code: C | readonly C[]) => err is AppError<C>
}

export type FnWithErrorCodes<F, C extends string> = F & {
  errorCodes: readonly C[]
}

function scoped<C extends ErrorCode, R>(
  codes: readonly C[],
  fn: (e: ScopedErrors<C>) => R
): FnWithErrorCodes<() => R, C> {
  // runtime: wrap `errors` with narrowed codes;
  // attach `errorCodes` = codes
}
```

Usage:

```ts
export const getUser = errors.scoped(
  ['user.not_found', 'infra.db_error'] as const,
  async (e) => {
    const row = await repo.findUserById(id)
    if (!row)
      e.throw('user.not_found', { id })
    return row
  }
)

type GetUserCodes = (typeof getUser)['errorCodes'][number]
// "user.not_found" | "infra.db_error"
```

Inside the function, `e.throw('billing.payment_failed')` is a **TS error**.

### 4.2 `safe`: convert throws to no-throw result

```ts
type SafeResult<T, C extends string>
  = | { ok: true, value: T }
    | { ok: false, error: AppError<C> }

function safe<T, C extends ErrorCode>(
  fn: () => Promise<T> | T,
  codes?: readonly C[]
): Promise<SafeResult<T, C>> {
  // try/catch + ensure + runtime validation vs codes
}
```

Usage:

```ts
const res = await errors.safe(() => getUser(id), getUser.errorCodes)

// res.error is AppError<"user.not_found" | "infra.db_error">
```

These are **opt-in**; default DX is just `throw` + global error handler.

---

## 5. Plugins

Plugin interface:

```ts
interface BetterErrorsPlugin {
  onCreate?: (err: AppError<any>) => void | Promise<void>
  onThrow?: (err: AppError<any>) => void | Promise<void>
  onSerialize?: (err: AppError<any>, json: SerializedError) => SerializedError
  onDeserialize?: (json: SerializedError) => SerializedError
}
```

Use cases:

- Logging (console, structured logs).
- Sentry / error trackers.
- Custom redaction.

Plugins only run on the **server instance**.

---

## 6. Dependencies & package layout

- **Runtime deps**: none (pure TS/JS).
- **Dev deps**: TypeScript, test runner, bundler (tsup/rollup/etc).

Suggested package layout:

- `better-errors`
  - `index.ts` → `betterErrors`, `defineCodes`, types, `AppError`, etc. (server / isomorphic core)
  - `client.ts` → `createErrorClient`, `ClientAppError`, `ErrorClient` (client-only helper)

- Future optional packages:
  - `better-errors-sentry`
  - `better-errors-hono`
  - etc.

Core remains framework-agnostic and dependency-free.
