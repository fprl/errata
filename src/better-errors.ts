import type { SerializedError } from './app-error'
import type { CodeOf, CodesRecord, DetailsOf, LogLevel } from './types'

import { AppError, isSerializedError, resolveMessage } from './app-error'

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
