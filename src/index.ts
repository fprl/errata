type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Resolves the error message for a code, optionally using its typed details.
 */
export type MessageResolver<TDetails>
  = | string
    | ((ctx: { details: TDetails }) => string)

export interface CodeConfig<TDetails = unknown> {
  /** Optional numeric code; usually HTTP status in web apps, otherwise a generic classification/exit code. */
  status?: number
  /** String or resolver using the typed `details`. */
  message: MessageResolver<TDetails>
  /** Structured payload typed per code; passed through unchanged. */
  details?: TDetails
  /** Whether it is safe to show to end users (advisory for boundaries). */
  expose?: boolean
  /** Hint about whether retrying makes sense; no retries performed. */
  retryable?: boolean
  /** Suggested log severity; core does not log. */
  logLevel?: LogLevel
  /** Free-form labels for grouping/matching (e.g. `auth`, `billing`, `stripe`). */
  tags?: string[]
}

type CodesRecord = Record<string, CodeConfig<any>>
type CodeOf<TCodes extends CodesRecord> = Extract<keyof TCodes, string>

type FlattenCodes<
  TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
> = {
  [K in keyof TInput & string as TInput[K] extends CodeConfig<any> ? K : never]: Extract<
    TInput[K],
    CodeConfig<any>
  >;
} & {
  [K in keyof TInput & string as TInput[K] extends Record<string, CodeConfig<any>>
    ? `${K}.${keyof TInput[K] & string}`
    : never]: TInput[K] extends Record<string, CodeConfig<any>>
    ? TInput[K][keyof TInput[K] & string]
    : never;
}

type FlattenedCodes<
  TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
>
  = FlattenCodes<TInput> extends CodesRecord ? FlattenCodes<TInput> : CodesRecord

export type DetailsOf<
  TCodes extends CodesRecord,
  TCode extends CodeOf<TCodes>,
> = TCodes[TCode]['details'] extends undefined ? unknown : TCodes[TCode]['details']

function isCodeConfig(value: unknown): value is CodeConfig {
  return !!value && typeof value === 'object' && 'message' in value
}

function flattenCodes(input: Record<string, any>, prefix = ''): CodesRecord {
  const result: CodesRecord = {}

  for (const [key, value] of Object.entries(input)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isCodeConfig(value)) {
      result[fullKey] = value
      continue
    }

    if (value && typeof value === 'object') {
      Object.assign(result, flattenCodes(value, fullKey))
    }
  }

  return result
}

/**
 * Define your codes registry (flat or one-level nested).
 * Returns a flattened, typed map of codes to config.
 */
export function defineCodes<
  TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
>(input: TInput): FlattenedCodes<TInput> {
  return flattenCodes(input) as FlattenedCodes<TInput>
}

/**
 * Structured wire format for errors.
 * - `status`: optional numeric code; usually HTTP status in web apps, otherwise a classification/exit code.
 * - `details`: structured payload for this code; passed through unchanged.
 */
export interface SerializedError<C extends string = string, D = unknown> {
  __brand: 'better-errors'
  app?: string
  code: C
  message: string
  status?: number
  retryable?: boolean
  logLevel?: LogLevel
  tags?: string[]
  details?: D
}

export class AppError<C extends string = string, D = unknown> extends Error {
  readonly name = 'AppError'
  readonly app?: string
  readonly env?: string
  readonly code: C
  readonly status: number
  readonly expose: boolean
  readonly retryable: boolean
  readonly logLevel: LogLevel
  readonly tags: string[]
  readonly details: D
  readonly cause?: unknown

  constructor(args: {
    app?: string
    env?: string
    code: C
    message: string
    status: number
    expose: boolean
    retryable: boolean
    logLevel: LogLevel
    tags: string[]
    details: D
    cause?: unknown
    captureStack?: boolean
  }) {
    super(args.message)
    Object.setPrototypeOf(this, new.target.prototype)
    this.app = args.app
    this.env = args.env
    this.code = args.code
    this.status = args.status
    this.expose = args.expose
    this.retryable = args.retryable
    this.logLevel = args.logLevel
    this.tags = args.tags
    this.details = args.details
    this.cause = args.cause

    if (args.captureStack !== false && Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target)
    }
  }

  toJSON(): SerializedError<C, D> {
    return {
      __brand: 'better-errors',
      app: this.app,
      // env is intentionally server-only; omitted from serialized shape
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      logLevel: this.logLevel,
      tags: this.tags,
      details: this.details,
    }
  }
}

type AppErrorFor<TCodes extends CodesRecord, C extends CodeOf<TCodes>> = AppError<
  C,
  DetailsOf<TCodes, C>
>

export interface BetterErrorsPlugin {
  onCreate?: (err: AppError<any>) => void | Promise<void>
  onThrow?: (err: AppError<any>) => void | Promise<void>
  onSerialize?: (err: AppError<any>, json: SerializedError) => SerializedError
  onDeserialize?: (json: SerializedError) => SerializedError
}

export interface BetterErrorsOptions<TCodes extends CodesRecord> {
  /** Optional app identifier for logging/observability. */
  app?: string
  /** Server-only environment label (e.g. dev/staging/prod); not serialized unless a plugin adds it. */
  env?: string
  /** Default numeric status (HTTP or generic classification) when none is provided per-code. */
  defaultStatus?: number
  /** Default advisory flag for user-facing exposure. */
  defaultExpose?: boolean
  /** Default hint for retry-worthiness. */
  defaultRetryable?: boolean
  /** Required codes registry (flat or one-level nested). */
  codes: TCodes
  /** Optional lifecycle hooks (logging, redaction, transports). */
  plugins?: BetterErrorsPlugin[]
  /** Optional list of keys to redact via plugins/adapters. */
  redactKeys?: string[]
  /** Control stack capture; defaults on except production if you pass env. */
  captureStack?: boolean
}

/** Server-side better-errors instance surface. */
export interface BetterErrorsInstance<TCodes extends CodesRecord> {
  /** Base AppError constructor for instanceof checks and extension. */
  AppError: typeof AppError
  /** Create an AppError for a known code, with typed details. */
  create: <C extends CodeOf<TCodes>>(
    code: C,
    details?: DetailsOf<TCodes, C>,
  ) => AppErrorFor<TCodes, C>
  /** Create and throw an AppError for a known code. */
  throw: <C extends CodeOf<TCodes>>(
    code: C,
    details?: DetailsOf<TCodes, C>,
  ) => never
  /** Normalize unknown errors into AppError, using an optional fallback code. */
  ensure: (
    err: unknown,
    fallbackCode?: CodeOf<TCodes>,
  ) => AppErrorFor<TCodes, CodeOf<TCodes>>
  /** Type-safe code check; supports single code or list. */
  is: <C extends CodeOf<TCodes>>(
    err: unknown,
    code: C | readonly C[],
  ) => err is AppErrorFor<TCodes, C>
  /** Exhaustive-ish matcher over codes, with a required default. */
  match: <R>(
    err: unknown,
    cases: {
      [C in CodeOf<TCodes>]?: (e: AppErrorFor<TCodes, C>) => R;
    } & { default: (e: AppErrorFor<TCodes, CodeOf<TCodes>>) => R },
  ) => R
  /** Check whether an error carries a given tag. */
  hasTag: (err: unknown, tag: string) => boolean
  /** Serialize an AppError for transport (server → client). */
  serialize: <C extends CodeOf<TCodes>>(
    err: AppErrorFor<TCodes, C>,
  ) => SerializedError<C, DetailsOf<TCodes, C>>
  /** Deserialize a payload back into an AppError (server context). */
  deserialize: <C extends CodeOf<TCodes>>(
    json: SerializedError<C, DetailsOf<TCodes, C>>,
  ) => AppErrorFor<TCodes, C>
  /** HTTP helpers (status + `{ error }` body). */
  http: {
    /** Convert unknown errors to HTTP-friendly `{ status, body: { error } }`. */
    from: (
      err: unknown,
      fallbackCode?: CodeOf<TCodes>,
    ) => { status: number, body: { error: SerializedError<CodeOf<TCodes>> } }
  }
  /** Type-only brand for inferring codes on the client. */
  _codesBrand?: CodeOf<TCodes>
}

function resolveMessage<TDetails>(message: MessageResolver<TDetails>, details: TDetails): string {
  return typeof message === 'function' ? message({ details }) : message
}

function isSerializedError(value: unknown): value is SerializedError<string, unknown> {
  return (
    !!value
    && typeof value === 'object'
    && (value as SerializedError).__brand === 'better-errors'
  )
}

/**
 * Create the server-side better-errors instance.
 * - Attaches typed helpers (create/throw/ensure/is/match) and HTTP/serialization helpers.
 * - Accepts per-code configs plus defaults; `env` stays server-side and is not serialized unless a plugin adds it.
 */
export function betterErrors<TCodes extends CodesRecord>({
  app,
  env,
  codes,
  defaultStatus = 500,
  defaultExpose = false,
  defaultRetryable = false,
  plugins = [],
  captureStack = true,
}: BetterErrorsOptions<TCodes>): BetterErrorsInstance<TCodes> {
  const defaultLogLevel: LogLevel = 'error'
  const fallbackCode = Object.keys(codes)[0] as CodeOf<TCodes> | undefined

  /** Create an AppError for a known code, with typed details. */
  const create = <C extends CodeOf<TCodes>>(
    code: C,
    details?: DetailsOf<TCodes, C>,
  ): AppErrorFor<TCodes, C> => {
    const config = codes[code]
    if (!config) {
      throw new Error(`Unknown error code: ${String(code)}`)
    }

    const error = new AppError<C, DetailsOf<TCodes, C>>({
      app,
      env,
      code,
      message: resolveMessage(config.message, details as DetailsOf<TCodes, C>),
      status: config.status ?? defaultStatus,
      expose: config.expose ?? defaultExpose,
      retryable: config.retryable ?? defaultRetryable,
      logLevel: config.logLevel ?? defaultLogLevel,
      tags: config.tags ?? [],
      details: details as DetailsOf<TCodes, C>,
      captureStack,
    })

    for (const plugin of plugins) {
      plugin.onCreate?.(error)
    }

    return error
  }

  /** Create and throw an AppError for a known code. */
  const throwFn = <C extends CodeOf<TCodes>>(
    code: C,
    details?: DetailsOf<TCodes, C>,
  ): never => {
    const err = create(code, details)
    for (const plugin of plugins) {
      plugin.onThrow?.(err)
    }
    throw err
  }

  /** Serialize an AppError for transport (server → client). */
  const serialize = <C extends CodeOf<TCodes>>(
    err: AppErrorFor<TCodes, C>,
  ): SerializedError<C, DetailsOf<TCodes, C>> => {
    const base = err.toJSON()
    let json: SerializedError<C, DetailsOf<TCodes, C>> = { ...base }

    for (const plugin of plugins) {
      json = (plugin.onSerialize?.(err, json) as typeof json) ?? json
    }

    return json
  }

  /** Deserialize a payload back into an AppError (server context). */
  const deserialize = <C extends CodeOf<TCodes>>(
    json: SerializedError<C, DetailsOf<TCodes, C>>,
  ): AppErrorFor<TCodes, C> => {
    let payload = json
    for (const plugin of plugins) {
      payload = (plugin.onDeserialize?.(payload) as typeof payload) ?? payload
    }

    const config = codes[payload.code as CodeOf<TCodes>]
    const message
      = payload.message
        ?? (config
          ? resolveMessage(config.message, payload.details as any)
          : String(payload.code))

    return new AppError<C, DetailsOf<TCodes, C>>({
      app: payload.app ?? app,
      code: payload.code,
      message,
      status: payload.status ?? config?.status ?? defaultStatus,
      expose: config?.expose ?? defaultExpose,
      retryable: payload.retryable ?? config?.retryable ?? defaultRetryable,
      logLevel: (payload.logLevel as LogLevel | undefined)
        ?? config?.logLevel
        ?? defaultLogLevel,
      tags: payload.tags ?? config?.tags ?? [],
      details: payload.details as DetailsOf<TCodes, C>,
      captureStack,
    })
  }

  /** Normalize unknown errors into AppError, using an optional fallback code. */
  const ensure = (
    err: unknown,
    fallback?: CodeOf<TCodes>,
  ): AppErrorFor<TCodes, CodeOf<TCodes>> => {
    if (err instanceof AppError) {
      return err as AppErrorFor<TCodes, CodeOf<TCodes>>
    }

    if (isSerializedError(err)) {
      return deserialize(err as SerializedError<CodeOf<TCodes>>)
    }

    const code = fallback ?? fallbackCode
    if (!code) {
      throw err
    }

    return create(code, { cause: err } as any)
  }

  /** Type-safe code check; supports single code or list. */
  const is = <C extends CodeOf<TCodes>>(
    err: unknown,
    codeOrCodes: C | readonly C[],
  ): err is AppErrorFor<TCodes, C> => {
    if (!(err instanceof AppError))
      return false
    const codesToCheck = Array.isArray(codeOrCodes)
      ? codeOrCodes
      : [codeOrCodes]
    return codesToCheck.includes(err.code as C)
  }

  /** Code-based matcher with required default. */
  const match = <R>(
    err: unknown,
    cases: {
      [C in CodeOf<TCodes>]?: (e: AppErrorFor<TCodes, C>) => R;
    } & { default: (e: AppErrorFor<TCodes, CodeOf<TCodes>>) => R },
  ): R => {
    const appErr = err instanceof AppError ? err : ensure(err)
    const handler = (cases as any)[appErr.code] ?? cases.default
    return handler(appErr)
  }

  /** Check whether an error carries a given tag. */
  const hasTag = (err: unknown, tag: string): boolean => {
    if (!(err instanceof AppError))
      return false
    return (err.tags ?? []).includes(tag)
  }

  const http = {
    /** Convert unknown errors to HTTP-friendly `{ status, body: { error } }`. */
    from(
      err: unknown,
      fallback?: CodeOf<TCodes>,
    ): { status: number, body: { error: SerializedError<CodeOf<TCodes>> } } {
      const normalized = ensure(err, fallback)
      return {
        status: normalized.status,
        body: { error: serialize(normalized) },
      }
    },
  }

  return {
    AppError,
    create,
    /** Create and throw an AppError for a known code. */
    throw: throwFn,
    /** Normalize unknown errors into AppError, using an optional fallback code. */
    ensure,
    /** Type-safe code check; supports single code or list. */
    is,
    /** Code-based matcher with required default. */
    match,
    /** Check whether an error carries a given tag. */
    hasTag,
    /** Serialize an AppError for transport (server → client). */
    serialize,
    /** Deserialize a payload back into an AppError (server context). */
    deserialize,
    /** HTTP helpers (status + `{ error }` body). */
    http,
    _codesBrand: undefined as unknown as CodeOf<TCodes>,
  }
}

export class ClientAppError<C extends string = string, D = unknown> extends Error {
  readonly name = 'AppError'
  readonly code: C
  readonly status?: number
  readonly retryable?: boolean
  readonly tags?: string[]
  readonly details?: D

  constructor(payload: SerializedError<C, D>) {
    super(payload.message)
    Object.setPrototypeOf(this, new.target.prototype)
    this.code = payload.code
    this.status = payload.status
    this.retryable = payload.retryable
    this.tags = payload.tags
    this.details = payload.details
  }
}

type InferCodes<T> = T extends BetterErrorsInstance<infer TCodes>
  ? TCodes
  : CodesRecord

/**
 * Client-side surface derived from a server `errors` type.
 */
/** Client-side surface derived from a server `errors` type. */
export interface ErrorClient<TCodes extends CodesRecord> {
  /** Client-side AppError constructor for instanceof checks. */
  AppError: new (
    payload: SerializedError<CodeOf<TCodes>, any>
  ) => ClientAppError<CodeOf<TCodes>, any>
  /** Turn a serialized payload into a client error instance. */
  deserialize: <C extends CodeOf<TCodes>>(
    json: SerializedError<C, DetailsOf<TCodes, C>>,
  ) => ClientAppError<C, DetailsOf<TCodes, C>>
  /** Type-safe code check; supports single code or list. */
  is: <C extends CodeOf<TCodes>>(
    err: unknown,
    code: C | readonly C[],
  ) => err is ClientAppError<C, DetailsOf<TCodes, C>>
  /** Code-based matcher with required default. */
  match: <R>(
    err: unknown,
    cases: {
      [C in CodeOf<TCodes>]?: (e: ClientAppError<C, DetailsOf<TCodes, C>>) => R;
    } & { default: (e: ClientAppError<CodeOf<TCodes>>) => R },
  ) => R
  /** Check whether an error carries a given tag. */
  hasTag: (err: unknown, tag: string) => boolean
}

export type CodesOf<T extends { _codesBrand?: any }> = NonNullable<T['_codesBrand']>

/**
 * Create a client that understands the server codes (type-only).
 */
export function createErrorClient<TServer extends BetterErrorsInstance<any>>(): ErrorClient<
  InferCodes<TServer>
> {
  type TCodes = InferCodes<TServer>
  type Code = CodeOf<TCodes>

  /** Turn a serialized payload into a client error instance. */
  const deserialize = <C extends Code>(
    json: SerializedError<C, DetailsOf<TCodes, C>>,
  ): ClientAppError<C, DetailsOf<TCodes, C>> => {
    return new ClientAppError<C, DetailsOf<TCodes, C>>(json)
  }

  /** Type-safe code check; supports single code or list. */
  const is = <C extends Code>(
    err: unknown,
    code: C | readonly C[],
  ): err is ClientAppError<C, DetailsOf<TCodes, C>> => {
    if (!(err instanceof ClientAppError))
      return false
    const codesToCheck = Array.isArray(code) ? code : [code]
    return codesToCheck.includes(err.code as C)
  }

  /** Code-based matcher with required default. */
  const match = <R>(
    err: unknown,
    cases: {
      [C in Code]?: (e: ClientAppError<C, DetailsOf<TCodes, C>>) => R;
    } & { default: (e: ClientAppError<Code>) => R },
  ): R => {
    if (!(err instanceof ClientAppError))
      return cases.default(err as any)
    const handler = (cases as any)[err.code] ?? cases.default
    return handler(err)
  }

  /** Check whether an error carries a given tag. */
  const hasTag = (err: unknown, tag: string): boolean => {
    if (!(err instanceof ClientAppError))
      return false
    return (err.tags ?? []).includes(tag)
  }

  return {
    AppError: ClientAppError,
    /** Turn a serialized payload into a client error instance. */
    deserialize,
    /** Type-safe code check; supports single code or list. */
    is,
    /** Code-based matcher with required default. */
    match,
    /** Check whether an error carries a given tag. */
    hasTag,
  }
}
