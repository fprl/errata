import type { SerializedError } from './app-error'
import type {
  CodeOf,
  CodesForTag,
  CodesRecord,
  DetailsArg,
  DetailsOf,
  LogLevel,
  MatchingAppError,
  Pattern,
  PatternInput,
} from './types'

import { AppError, isSerializedError, resolveMessage } from './app-error'
import { findBestMatchingPattern, matchesPattern } from './utils/pattern-matching'

type AppErrorFor<TCodes extends CodesRecord, C extends CodeOf<TCodes>> = AppError<
  C,
  DetailsOf<TCodes, C>
>

type DetailsParam<TCodes extends CodesRecord, C extends CodeOf<TCodes>>
  = undefined extends DetailsArg<TCodes, C>
    ? [details?: DetailsArg<TCodes, C>]
    : [details: DetailsArg<TCodes, C>]

type TaggedAppError<
  TCodes extends CodesRecord,
  TTag extends string,
> = MatchingAppError<TCodes, Extract<CodesForTag<TCodes, TTag>, CodeOf<TCodes>>>

// ─── Match Handler Types ──────────────────────────────────────────────────────

/**
 * Match handlers object type.
 * Keys are exact codes or wildcard patterns.
 * Values are callbacks receiving the narrowed error type.
 */
export type MatchHandlers<TCodes extends CodesRecord, R> = {
  [K in Pattern<TCodes>]?: (e: MatchingAppError<TCodes, K>) => R
} & {
  default?: (e: AppErrorFor<TCodes, CodeOf<TCodes>>) => R
}

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
    ...details: DetailsParam<TCodes, C>
  ) => AppErrorFor<TCodes, C>
  /** Create and throw an AppError for a known code. */
  throw: <C extends CodeOf<TCodes>>(
    code: C,
    ...details: DetailsParam<TCodes, C>
  ) => never
  /** Normalize unknown errors into AppError, using an optional fallback code. */
  ensure: (
    err: unknown,
    fallbackCode?: CodeOf<TCodes>,
  ) => AppErrorFor<TCodes, CodeOf<TCodes>>
  /** Promise helper that returns a `[data, error]` tuple without try/catch. */
  safe: <T>(
    promise: Promise<T>,
  ) => Promise<
    [data: T, error: null] | [data: null, error: AppErrorFor<TCodes, CodeOf<TCodes>>]
  >
  /**
   * Type-safe pattern check; supports exact codes, wildcard patterns (`'auth.*'`),
   * and arrays of patterns. Returns a type guard narrowing the error type.
   */
  is: <P extends PatternInput<TCodes> | readonly PatternInput<TCodes>[]>(
    err: unknown,
    pattern: P,
  ) => err is MatchingAppError<TCodes, P>
  /**
   * Pattern matcher over codes with priority: exact match > longest wildcard > default.
   * Supports exact codes, wildcard patterns (`'auth.*'`), and a `default` handler.
   */
  match: <R>(
    err: unknown,
    handlers: MatchHandlers<TCodes, R>,
  ) => R | undefined
  /** Check whether an error carries a given tag. */
  hasTag: <TTag extends string>(
    err: unknown,
    tag: TTag,
  ) => err is TaggedAppError<TCodes, TTag>
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
    ...[details]: DetailsParam<TCodes, C>
  ): AppErrorFor<TCodes, C> => {
    const config = codes[code]
    if (!config) {
      throw new Error(`Unknown error code: ${String(code)}`)
    }

    const resolvedDetails = (
      details === undefined ? config.details : details
    ) as DetailsOf<TCodes, C>

    const error = new AppError<C, DetailsOf<TCodes, C>>({
      app,
      env,
      code,
      message: resolveMessage(config.message, resolvedDetails),
      status: config.status ?? defaultStatus,
      expose: config.expose ?? defaultExpose,
      retryable: config.retryable ?? defaultRetryable,
      logLevel: config.logLevel ?? defaultLogLevel,
      tags: config.tags ?? [],
      details: resolvedDetails,
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
    ...details: DetailsParam<TCodes, C>
  ): never => {
    const err = create(code, ...(details as DetailsParam<TCodes, C>))
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

    // Omit details when the code isn't marked as exposable.
    if (!err.expose) {
      delete (json as any).details
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
      return deserialize(err as SerializedError<CodeOf<TCodes>, any>)
    }

    const code = fallback ?? fallbackCode
    if (!code) {
      throw err
    }

    return create(code, { cause: err } as any)
  }

  /** Promise helper that returns a `[data, error]` tuple without try/catch. */
  const safe = async <T>(
    promise: Promise<T>,
  ): Promise<
    [data: T, error: null] | [data: null, error: AppErrorFor<TCodes, CodeOf<TCodes>>]
  > => {
    try {
      const data = await promise
      return [data, null]
    }
    catch (err) {
      return [null, ensure(err)]
    }
  }

  /** Type-safe pattern check; supports exact codes, wildcard patterns, and arrays. */
  const is = <P extends PatternInput<TCodes> | readonly PatternInput<TCodes>[]>(
    err: unknown,
    pattern: P,
  ): err is MatchingAppError<TCodes, P> => {
    if (!(err instanceof AppError))
      return false

    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    return patterns.some(p => matchesPattern(err.code, p as string))
  }

  /** Pattern matcher with priority: exact match > longest wildcard > default. */
  const match = <R>(
    err: unknown,
    handlers: MatchHandlers<TCodes, R>,
  ): R | undefined => {
    const appErr = err instanceof AppError ? err : ensure(err)
    const handlerKeys = Object.keys(handlers).filter(k => k !== 'default')

    const matchedPattern = findBestMatchingPattern(appErr.code, handlerKeys)
    const handler = matchedPattern
      ? (handlers as any)[matchedPattern]
      : (handlers as any).default

    return handler ? handler(appErr) : undefined
  }

  /** Check whether an error carries a given tag. */
  const hasTag = <TTag extends string>(
    err: unknown,
    tag: TTag,
  ): err is TaggedAppError<TCodes, TTag> => {
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
    /** Promise helper that returns a `[data, error]` tuple without try/catch. */
    safe,
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
