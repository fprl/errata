import type { SerializedError } from './errata-error'
import type {
  CodeOf,
  CodesForTag,
  CodesRecord,
  DetailsArg,
  // DetailsOf,
  ErrataConfig,
  ErrataContext,
  ErrataErrorForCodes,
  ErrataPlugin,
  InternalCode,
  InternalDetails,
  LogLevel,
  MatchingErrataErrorForCodes,
  MergePluginCodes,
  PatternForCodes,
  PatternInputForCodes,
} from './types'

import { ErrataError, isSerializedError, resolveMessage } from './errata-error'
import { LIB_NAME } from './types'
import { findBestMatchingPattern, matchesPattern } from './utils/pattern-matching'

type ErrataErrorFor<TCodes extends CodesRecord, C extends CodeOf<TCodes>> = ErrataErrorForCodes<
  TCodes,
  C
>
type BoundaryErrataError<
  TCodes extends CodesRecord,
  C extends CodeOf<TCodes> | InternalCode,
> = ErrataErrorForCodes<TCodes, C>

type DetailsParam<TCodes extends CodesRecord, C extends CodeOf<TCodes>>
  = undefined extends DetailsArg<TCodes, C>
    ? [details?: DetailsArg<TCodes, C>]
    : [details: DetailsArg<TCodes, C>]

type TaggedErrataError<
  TCodes extends CodesRecord,
  TTag extends string,
> = MatchingErrataErrorForCodes<TCodes, CodeOf<TCodes>, Extract<CodesForTag<TCodes, TTag>, CodeOf<TCodes>>>

type MatchHandlersForUnion<
  TCodes extends CodesRecord,
  TUnion extends string,
  R,
> = {
  [K in PatternForCodes<TUnion>]?: (e: MatchingErrataErrorForCodes<TCodes, TUnion, K>) => R
} & {
  default?: (e: ErrataErrorForCodes<TCodes, TUnion>) => R
}

// ─── Match Handler Types ──────────────────────────────────────────────────────

/**
 * Match handlers object type.
 * Keys are exact codes or wildcard patterns.
 * Values are callbacks receiving the narrowed error type.
 */
export type MatchHandlers<TCodes extends CodesRecord, R> = MatchHandlersForUnion<TCodes, CodeOf<TCodes>, R>

// ─── Plugin Code Merging ──────────────────────────────────────────────────────

/**
 * Merges user codes with plugin codes.
 * Plugin codes are added after user codes, allowing plugins to extend the registry.
 */
type MergedCodes<
  TUserCodes extends CodesRecord,
  TPlugins extends readonly ErrataPlugin<any>[],
> = TUserCodes & MergePluginCodes<TPlugins>

export interface ErrataOptions<
  TCodes extends CodesRecord,
  TPlugins extends readonly ErrataPlugin<any>[] = [],
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
  /**
   * Called when normalizing an unknown value.
   * Return a known code to map it, or null/undefined to fallback to errata.unknown_error.
   */
  onUnknown?: (
    error: unknown,
    ctx: ErrataContext<MergedCodes<TCodes, TPlugins>>,
  ) => CodeOf<TCodes> | null | undefined
  /** Control stack capture; defaults on except production if you pass env. */
  captureStack?: boolean
}

/** Server-side errata instance surface. */
export interface ErrataInstance<TCodes extends CodesRecord> {
  /** Base ErrataError constructor for instanceof checks and extension. */
  ErrataError: typeof ErrataError
  /** Create an ErrataError for a known code, with typed details. */
  create: <C extends CodeOf<TCodes>>(
    code: C,
    ...details: DetailsParam<TCodes, C>
  ) => ErrataErrorFor<TCodes, C>
  /** Normalize unknown errors into ErrataError, using an optional fallback code. */
  ensure: {
    <C extends CodeOf<TCodes> | InternalCode>(
      err: ErrataErrorForCodes<TCodes, C>,
    ): ErrataErrorForCodes<TCodes, C>
    (
      err: unknown,
      fallbackCode?: CodeOf<TCodes>,
    ): BoundaryErrataError<TCodes, CodeOf<TCodes> | InternalCode>
  }
  /** Promise helper that returns a `[data, error]` tuple without try/catch. */
  safe: {
    <T>(fn: () => T | Promise<T>): Promise<
      [data: T, error: null] | [data: null, error: BoundaryErrataError<TCodes, CodeOf<TCodes> | InternalCode>]
    >
    <T>(promise: Promise<T>): Promise<
      [data: T, error: null] | [data: null, error: BoundaryErrataError<TCodes, CodeOf<TCodes> | InternalCode>]
    >
  }
  /**
   * Type-safe pattern check; supports exact codes, wildcard patterns (`'auth.*'`),
   * and arrays of patterns. Returns a type guard narrowing the error type.
   */
  is: {
    <C extends CodeOf<TCodes> | InternalCode, P extends PatternInputForCodes<C> | readonly PatternInputForCodes<C>[]>(
      err: ErrataErrorForCodes<TCodes, C>,
      pattern: P,
    ): err is MatchingErrataErrorForCodes<TCodes, C, P>
    (
      err: unknown,
      pattern: PatternInputForCodes<CodeOf<TCodes> | InternalCode> | readonly PatternInputForCodes<CodeOf<TCodes> | InternalCode>[],
    ): boolean
  }
  /**
   * Pattern matcher over codes with priority: exact match > longest wildcard > default.
   * Supports exact codes, wildcard patterns (`'auth.*'`), and a `default` handler.
   */
  match: {
    <C extends CodeOf<TCodes> | InternalCode, R>(
      err: ErrataErrorForCodes<TCodes, C>,
      handlers: MatchHandlersForUnion<TCodes, C, R>,
    ): R | undefined
    <R>(
      err: unknown,
      handlers: MatchHandlersForUnion<TCodes, CodeOf<TCodes> | InternalCode, R>,
    ): R | undefined
  }
  /** Check whether an error carries a given tag. */
  hasTag: <TTag extends string>(
    err: unknown,
    tag: TTag,
  ) => err is TaggedErrataError<TCodes, TTag>
  /** Serialize an ErrataError for transport (server → client). */
  serialize: <C extends CodeOf<TCodes> | InternalCode>(
    err: BoundaryErrataError<TCodes, C>,
  ) => SerializedError<C, BoundaryErrataError<TCodes, C>['details']>
  /** Deserialize a payload back into an ErrataError (server context). */
  deserialize: <C extends CodeOf<TCodes> | InternalCode>(
    json: SerializedError<C, BoundaryErrataError<TCodes, C>['details']>,
  ) => BoundaryErrataError<TCodes, C>
  /** HTTP helpers (status + `{ error }` body). */
  http: {
    /** Convert unknown errors to HTTP-friendly `{ status, body: { error } }`. */
    from: (
      err: unknown,
      fallbackCode?: CodeOf<TCodes>,
    ) => { status: number, body: { error: SerializedError<CodeOf<TCodes> | InternalCode> } }
  }
  /** Type-only brand for inferring codes on the client. */
  _codesBrand?: CodeOf<TCodes>
}

/**
 * Create the server-side errata instance.
 * - Attaches typed helpers (create/throw/ensure/is/match) and HTTP/serialization helpers.
 * - Accepts per-code configs plus defaults; `env` stays server-side and is not serialized unless a plugin adds it.
 * - Supports plugins for code injection, error mapping, and side effects.
 */
export function errata<
  TCodes extends CodesRecord,
  TPlugins extends readonly ErrataPlugin<any>[] = [],
>({
  app,
  env,
  codes,
  defaultStatus = 500,
  defaultExpose = false,
  defaultRetryable = false,
  plugins = [] as unknown as TPlugins,
  onUnknown,
  captureStack = true,
}: ErrataOptions<TCodes, TPlugins>): ErrataInstance<MergedCodes<TCodes, TPlugins>> {
  type AllCodes = MergedCodes<TCodes, TPlugins>
  type AllCodeOf = CodeOf<AllCodes>
  type BoundaryCode = AllCodeOf | InternalCode

  const defaultLogLevel: LogLevel = 'error'
  const internalCodeSet: Record<InternalCode, true> = {
    'errata.unknown_error': true,
  }

  // Merge user codes with plugin codes
  let mergedCodes = { ...codes } as AllCodes
  const pluginNames = new Set<string>()

  // Validate and merge plugin codes
  for (const plugin of plugins) {
    // Check for duplicate plugin names
    if (pluginNames.has(plugin.name)) {
      console.warn(`${LIB_NAME}: Duplicate plugin name "${plugin.name}" detected`)
    }
    pluginNames.add(plugin.name)

    // Merge plugin codes
    if (plugin.codes) {
      for (const code of Object.keys(plugin.codes)) {
        if (code in mergedCodes) {
          console.warn(`${LIB_NAME}: Plugin "${plugin.name}" defines code "${code}" which already exists`)
        }
      }
      mergedCodes = { ...mergedCodes, ...plugin.codes } as AllCodes
    }
  }

  // Build the config object for plugin context
  const config: ErrataConfig = {
    app,
    env,
    defaultStatus,
    defaultExpose,
    defaultRetryable,
  }

  // Forward declarations for mutual recursion (ensure needs create, create runs hooks)
  let createFn: ErrataInstance<AllCodes>['create']
  let ensureFn: ErrataInstance<AllCodes>['ensure']

  // Build the plugin context (lazy to avoid circular refs during init)
  const getContext = (): ErrataContext<AllCodes> => ({
    create: (code, details) => createFn(code as any, details),
    ensure: (err, fallback) => ensureFn(err, fallback as any),
    config,
  })

  const createInternalError = (
    code: InternalCode,
    raw: unknown,
    cause?: unknown,
  ): BoundaryErrataError<AllCodes, InternalCode> => {
    return new ErrataError<InternalCode, InternalDetails>({
      app,
      env,
      code,
      message: code,
      status: defaultStatus,
      expose: false,
      retryable: defaultRetryable,
      logLevel: defaultLogLevel,
      tags: [],
      details: { raw },
      cause,
      captureStack,
    }) as BoundaryErrataError<AllCodes, InternalCode>
  }

  /** Create an ErrataError for a known code, with typed details. */
  createFn = <C extends AllCodeOf>(
    code: C,
    ...[details]: DetailsParam<AllCodes, C>
  ): ErrataErrorFor<AllCodes, C> => {
    const codeConfig = mergedCodes[code]
    if (!codeConfig) {
      throw new Error(`Unknown error code: ${String(code)}`)
    }

    const resolvedDetails = (
      details === undefined ? codeConfig.details : details
    ) as ErrataErrorFor<AllCodes, C>['details']

    const error = new ErrataError<C, ErrataErrorFor<AllCodes, C>['details']>({
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
    }) as ErrataErrorFor<AllCodes, C>

    // Run onCreate hooks for all plugins (side effects are independent)
    const ctx = getContext()
    for (const plugin of plugins) {
      if (plugin.onCreate) {
        try {
          plugin.onCreate(error, ctx as any)
        }
        catch (hookError) {
          console.error(`${LIB_NAME}: plugin "${plugin.name}" crashed in onCreate`, hookError)
        }
      }
    }

    return error
  }

  const createBoundaryError = <C extends BoundaryCode>(
    code: C,
    details?: any,
    cause?: unknown,
  ): BoundaryErrataError<AllCodes, C> => {
    if (internalCodeSet[code as InternalCode]) {
      const raw = (details as InternalDetails | undefined)?.raw ?? details
      return createInternalError(code as InternalCode, raw, cause) as BoundaryErrataError<AllCodes, C>
    }

    return createFn(code as AllCodeOf, details as any) as BoundaryErrataError<AllCodes, C>
  }

  /** Create and throw an ErrataError for a known code. */
  /** Serialize an ErrataError for transport (server → client). */
  const serialize = <C extends BoundaryCode>(
    err: BoundaryErrataError<AllCodes, C>,
  ): SerializedError<C, BoundaryErrataError<AllCodes, C>['details']> => {
    const base = err.toJSON()
    let json: SerializedError<C, BoundaryErrataError<AllCodes, C>['details']> = { ...base }

    // Omit details when the code isn't marked as exposable.
    if (!err.expose) {
      delete (json as any).details
    }

    // Allow plugins to adapt the serialized payload
    const ctx = getContext()
    for (const plugin of plugins) {
      if (plugin.onSerialize) {
        try {
          json = plugin.onSerialize(json, err, ctx as any) as typeof json
        }
        catch (hookError) {
          console.error(`${LIB_NAME}: plugin "${plugin.name}" crashed in onSerialize`, hookError)
        }
      }
    }

    return json
  }

  /** Deserialize a payload back into an ErrataError (server context). */
  const deserialize = <C extends BoundaryCode>(
    json: SerializedError<C, BoundaryErrataError<AllCodes, C>['details']>,
  ): BoundaryErrataError<AllCodes, C> => {
    const payload = json
    const isInternal = internalCodeSet[payload.code as InternalCode] === true
    const codeConfig = mergedCodes[payload.code as AllCodeOf]
    const message
      = payload.message
        ?? (codeConfig
          ? resolveMessage(codeConfig.message, payload.details as any)
          : String(payload.code))

    return new ErrataError<C, BoundaryErrataError<AllCodes, C>['details']>({
      app: payload.app ?? app,
      code: payload.code,
      message,
      status: payload.status ?? codeConfig?.status ?? defaultStatus,
      expose: isInternal ? false : codeConfig?.expose ?? defaultExpose,
      retryable: payload.retryable ?? codeConfig?.retryable ?? defaultRetryable,
      logLevel: (payload.logLevel as LogLevel | undefined)
        ?? codeConfig?.logLevel
        ?? defaultLogLevel,
      tags: isInternal ? [] : payload.tags ?? codeConfig?.tags ?? [],
      details: payload.details as BoundaryErrataError<AllCodes, C>['details'],
      captureStack,
    }) as BoundaryErrataError<AllCodes, C>
  }

  /** Normalize unknown errors into ErrataError, using an optional fallback code. */
  ensureFn = (
    err: unknown,
    fallback?: AllCodeOf,
  ): BoundaryErrataError<AllCodes, BoundaryCode> => {
    // If already an ErrataError, return as-is
    if (err instanceof ErrataError) {
      return err as BoundaryErrataError<AllCodes, BoundaryCode>
    }

    // User onUnknown hook (takes precedence)
    if (onUnknown) {
      try {
        const mapped = onUnknown(err, getContext())
        if (mapped) {
          return createFn(mapped, { raw: err } as any) as BoundaryErrataError<AllCodes, BoundaryCode>
        }
      }
      catch (hookError) {
        console.error(`${LIB_NAME}: onUnknown crashed`, hookError)
      }
    }

    // Try plugin onUnknown hooks (first non-null wins)
    const ctx = getContext()
    for (const plugin of plugins) {
      if (plugin.onUnknown) {
        try {
          const result = plugin.onUnknown(err, ctx as any)
          if (result !== null) {
            if (result instanceof ErrataError) {
              return result as BoundaryErrataError<AllCodes, BoundaryCode>
            }

            return createBoundaryError(result.code as BoundaryCode, result.details)
          }
        }
        catch (hookError) {
          console.error(`${LIB_NAME}: plugin "${plugin.name}" crashed in onUnknown`, hookError)
        }
      }
    }

    // Check for serialized errors
    if (isSerializedError(err)) {
      return deserialize(err as SerializedError<BoundaryCode, any>)
    }

    if (fallback) {
      return createBoundaryError(fallback, { cause: err } as any)
    }

    return createInternalError('errata.unknown_error', err, err)
  }

  // Alias for the public interface
  const create = createFn as ErrataInstance<AllCodes>['create']
  const ensure = ensureFn as ErrataInstance<AllCodes>['ensure']

  /** Promise helper that returns a `[data, error]` tuple without try/catch. */
  const safe = (async <T>(
    input: Promise<T> | (() => T | Promise<T>),
  ): Promise<
    [data: T, error: null] | [data: null, error: BoundaryErrataError<AllCodes, BoundaryCode>]
  > => {
    const promise = typeof input === 'function'
      ? new Promise<T>(resolve => resolve((input as () => T | Promise<T>)()))
      : input

    try {
      const data = await promise
      return [data, null]
    }
    catch (err) {
      return [null, ensure(err)]
    }
  }) as ErrataInstance<AllCodes>['safe']

  /** Type-safe pattern check; supports exact codes, wildcard patterns, and arrays. */
  const is = ((
    err: unknown,
    pattern: PatternInputForCodes<BoundaryCode> | readonly PatternInputForCodes<BoundaryCode>[],
  ): boolean => {
    if (!(err instanceof ErrataError))
      return false

    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    return patterns.some(p => matchesPattern(err.code, p as string))
  }) as ErrataInstance<AllCodes>['is']

  /** Pattern matcher with priority: exact match > longest wildcard > default. */
  const match = ((
    err: unknown,
    handlers: MatchHandlersForUnion<AllCodes, BoundaryCode, any>,
  ): any => {
    const errataErr = err instanceof ErrataError ? err : ensure(err as any)
    const handlerKeys = Object.keys(handlers).filter(k => k !== 'default')

    const matchedPattern = findBestMatchingPattern(errataErr.code, handlerKeys)
    const handler = matchedPattern
      ? (handlers as any)[matchedPattern]
      : (handlers as any).default

    return handler ? handler(errataErr) : undefined
  }) as ErrataInstance<AllCodes>['match']

  /** Check whether an error carries a given tag. */
  const hasTag = <TTag extends string>(
    err: unknown,
    tag: TTag,
  ): err is TaggedErrataError<AllCodes, TTag> => {
    if (!(err instanceof ErrataError))
      return false
    return (err.tags ?? []).includes(tag)
  }

  const http = {
    /** Convert unknown errors to HTTP-friendly `{ status, body: { error } }`. */
    from(
      err: unknown,
      fallback?: AllCodeOf,
    ): { status: number, body: { error: SerializedError<BoundaryCode> } } {
      const normalized = ensure(err, fallback)
      return {
        status: normalized.status,
        body: { error: serialize(normalized) },
      }
    },
  }

  return {
    ErrataError,
    create,
    /** Normalize unknown errors into ErrataError, using an optional fallback code. */
    ensure,
    /** Promise helper that returns a `[data, error]` tuple without try/catch. */
    safe,
    /** Type-safe code check; supports single code or list. */
    is,
    /** Code-based matcher with required default. */
    match,
    /** Check whether an error carries a given tag. */
    hasTag,
    /** Serialize an ErrataError for transport (server → client). */
    serialize,
    /** Deserialize a payload back into an ErrataError (server context). */
    deserialize,
    /** HTTP helpers (status + `{ error }` body). */
    http,
    _codesBrand: undefined as unknown as AllCodeOf,
  }
}
