import type { SerializedError } from './app-error'
import type {
  BetterErrorsConfig,
  BetterErrorsContext,
  BetterErrorsPlugin,
  CodeOf,
  CodesForTag,
  CodesRecord,
  DetailsArg,
  DetailsOf,
  LogLevel,
  MatchingAppError,
  MergePluginCodes,
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

// ─── Plugin Code Merging ──────────────────────────────────────────────────────

/**
 * Merges user codes with plugin codes.
 * Plugin codes are added after user codes, allowing plugins to extend the registry.
 */
type MergedCodes<
  TUserCodes extends CodesRecord,
  TPlugins extends readonly BetterErrorsPlugin<any>[],
> = TUserCodes & MergePluginCodes<TPlugins>

export interface BetterErrorsOptions<
  TCodes extends CodesRecord,
  TPlugins extends readonly BetterErrorsPlugin<any>[] = [],
> {
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
  /** Optional lifecycle plugins (logging, error mapping, monitoring). */
  plugins?: TPlugins
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
 * - Supports plugins for code injection, error mapping, and side effects.
 */
export function betterErrors<
  TCodes extends CodesRecord,
  TPlugins extends readonly BetterErrorsPlugin<any>[] = [],
>({
  app,
  env,
  codes,
  defaultStatus = 500,
  defaultExpose = false,
  defaultRetryable = false,
  plugins = [] as unknown as TPlugins,
  captureStack = true,
}: BetterErrorsOptions<TCodes, TPlugins>): BetterErrorsInstance<MergedCodes<TCodes, TPlugins>> {
  type AllCodes = MergedCodes<TCodes, TPlugins>
  type AllCodeOf = CodeOf<AllCodes>

  const defaultLogLevel: LogLevel = 'error'

  // Merge user codes with plugin codes
  let mergedCodes = { ...codes } as AllCodes
  const pluginNames = new Set<string>()

  // Validate and merge plugin codes
  for (const plugin of plugins) {
    // Check for duplicate plugin names
    if (pluginNames.has(plugin.name)) {
      console.warn(`better-errors: Duplicate plugin name "${plugin.name}" detected`)
    }
    pluginNames.add(plugin.name)

    // Merge plugin codes
    if (plugin.codes) {
      for (const code of Object.keys(plugin.codes)) {
        if (code in mergedCodes) {
          console.warn(`better-errors: Plugin "${plugin.name}" defines code "${code}" which already exists`)
        }
      }
      mergedCodes = { ...mergedCodes, ...plugin.codes } as AllCodes
    }
  }

  const fallbackCode = Object.keys(mergedCodes)[0] as AllCodeOf | undefined

  // Build the config object for plugin context
  const config: BetterErrorsConfig = {
    app,
    env,
    defaultStatus,
    defaultExpose,
    defaultRetryable,
  }

  // Forward declarations for mutual recursion (ensure needs create, create runs hooks)
  let createFn: BetterErrorsInstance<AllCodes>['create']
  let ensureFn: BetterErrorsInstance<AllCodes>['ensure']

  // Build the plugin context (lazy to avoid circular refs during init)
  const getContext = (): BetterErrorsContext<AllCodes> => ({
    create: (code, details) => createFn(code as any, details),
    ensure: (err, fallback) => ensureFn(err, fallback as any),
    config,
  })

  /** Create an AppError for a known code, with typed details. */
  createFn = <C extends AllCodeOf>(
    code: C,
    ...[details]: DetailsParam<AllCodes, C>
  ): AppErrorFor<AllCodes, C> => {
    const codeConfig = mergedCodes[code]
    if (!codeConfig) {
      throw new Error(`Unknown error code: ${String(code)}`)
    }

    const resolvedDetails = (
      details === undefined ? codeConfig.details : details
    ) as DetailsOf<AllCodes, C>

    const error = new AppError<C, DetailsOf<AllCodes, C>>({
      app,
      env,
      code,
      message: resolveMessage(codeConfig.message, resolvedDetails as any),
      status: codeConfig.status ?? defaultStatus,
      expose: codeConfig.expose ?? defaultExpose,
      retryable: codeConfig.retryable ?? defaultRetryable,
      logLevel: codeConfig.logLevel ?? defaultLogLevel,
      tags: codeConfig.tags ?? [],
      details: resolvedDetails,
      captureStack,
    })

    // Run onCreate hooks for all plugins (side effects are independent)
    const ctx = getContext()
    for (const plugin of plugins) {
      if (plugin.onCreate) {
        try {
          plugin.onCreate(error, ctx as any)
        }
        catch (hookError) {
          console.error(`better-errors: plugin "${plugin.name}" crashed in onCreate`, hookError)
        }
      }
    }

    return error
  }

  /** Create and throw an AppError for a known code. */
  const throwFn = <C extends AllCodeOf>(
    code: C,
    ...details: DetailsParam<AllCodes, C>
  ): never => {
    // create() already runs onCreate hooks
    const err = createFn(code, ...(details as DetailsParam<AllCodes, C>))
    throw err
  }

  /** Serialize an AppError for transport (server → client). */
  const serialize = <C extends AllCodeOf>(
    err: AppErrorFor<AllCodes, C>,
  ): SerializedError<C, DetailsOf<AllCodes, C>> => {
    const base = err.toJSON()
    const json: SerializedError<C, DetailsOf<AllCodes, C>> = { ...base }

    // Omit details when the code isn't marked as exposable.
    if (!err.expose) {
      delete (json as any).details
    }

    return json
  }

  /** Deserialize a payload back into an AppError (server context). */
  const deserialize = <C extends AllCodeOf>(
    json: SerializedError<C, DetailsOf<AllCodes, C>>,
  ): AppErrorFor<AllCodes, C> => {
    const payload = json
    const codeConfig = mergedCodes[payload.code as AllCodeOf]
    const message
      = payload.message
        ?? (codeConfig
          ? resolveMessage(codeConfig.message, payload.details as any)
          : String(payload.code))

    return new AppError<C, DetailsOf<AllCodes, C>>({
      app: payload.app ?? app,
      code: payload.code,
      message,
      status: payload.status ?? codeConfig?.status ?? defaultStatus,
      expose: codeConfig?.expose ?? defaultExpose,
      retryable: payload.retryable ?? codeConfig?.retryable ?? defaultRetryable,
      logLevel: (payload.logLevel as LogLevel | undefined)
        ?? codeConfig?.logLevel
        ?? defaultLogLevel,
      tags: payload.tags ?? codeConfig?.tags ?? [],
      details: payload.details as DetailsOf<AllCodes, C>,
      captureStack,
    })
  }

  /** Normalize unknown errors into AppError, using an optional fallback code. */
  ensureFn = (
    err: unknown,
    fallback?: AllCodeOf,
  ): AppErrorFor<AllCodes, AllCodeOf> => {
    // If already an AppError, return as-is
    if (err instanceof AppError) {
      return err as AppErrorFor<AllCodes, AllCodeOf>
    }

    // Try plugin onEnsure hooks (first non-null wins)
    const ctx = getContext()
    for (const plugin of plugins) {
      if (plugin.onEnsure) {
        try {
          const result = plugin.onEnsure(err, ctx as any)
          if (result !== null) {
            // If result is already an AppError, return it
            if (result instanceof AppError) {
              return result as AppErrorFor<AllCodes, AllCodeOf>
            }
            // Otherwise it's { code, details } - create an AppError
            return createFn(result.code as AllCodeOf, result.details)
          }
        }
        catch (hookError) {
          console.error(`better-errors: plugin "${plugin.name}" crashed in onEnsure`, hookError)
        }
      }
    }

    // Check for serialized errors
    if (isSerializedError(err)) {
      return deserialize(err as SerializedError<AllCodeOf, any>)
    }

    // Fallback to default handling
    const code = fallback ?? fallbackCode
    if (!code) {
      throw err
    }

    return createFn(code, { cause: err } as any)
  }

  // Alias for the public interface
  const create = createFn as BetterErrorsInstance<AllCodes>['create']
  const ensure = ensureFn as BetterErrorsInstance<AllCodes>['ensure']

  /** Promise helper that returns a `[data, error]` tuple without try/catch. */
  const safe = async <T>(
    promise: Promise<T>,
  ): Promise<
    [data: T, error: null] | [data: null, error: AppErrorFor<AllCodes, AllCodeOf>]
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
  const is = <P extends PatternInput<AllCodes> | readonly PatternInput<AllCodes>[]>(
    err: unknown,
    pattern: P,
  ): err is MatchingAppError<AllCodes, P> => {
    if (!(err instanceof AppError))
      return false

    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    return patterns.some(p => matchesPattern(err.code, p as string))
  }

  /** Pattern matcher with priority: exact match > longest wildcard > default. */
  const match = <R>(
    err: unknown,
    handlers: MatchHandlers<AllCodes, R>,
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
  ): err is TaggedAppError<AllCodes, TTag> => {
    if (!(err instanceof AppError))
      return false
    return (err.tags ?? []).includes(tag)
  }

  const http = {
    /** Convert unknown errors to HTTP-friendly `{ status, body: { error } }`. */
    from(
      err: unknown,
      fallback?: AllCodeOf,
    ): { status: number, body: { error: SerializedError<AllCodeOf> } } {
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
    _codesBrand: undefined as unknown as AllCodeOf,
  }
}
