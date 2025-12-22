import type { ErrataInstance } from './errata'
import type { SerializedError } from './errata-error'
import type {
  ClientConfig,
  ClientContext,
  CodeOf,
  CodesForTag,
  CodesRecord,
  ErrataClientErrorForCodes,
  ErrataClientPlugin,
  InternalCode,
  InternalDetails,
  MatchingErrataClientErrorForCodes,
  PatternForCodes,
  PatternInputForCodes,
} from './types'

import { LIB_NAME } from './types'
import { findBestMatchingPattern, matchesPattern } from './utils/pattern-matching'

// ─── Client Types ─────────────────────────────────────────────────────────────

type ClientCode<TCodes extends CodesRecord> = CodeOf<TCodes> | InternalCode

export class ErrataClientError<C extends string = string, D = unknown> extends Error {
  override readonly name = 'ErrataClientError'
  readonly code: C
  readonly status?: number
  readonly retryable?: boolean
  readonly tags?: readonly string[]
  readonly details?: D

  constructor(payload: SerializedError<C, D>) {
    super(payload.message)
    Object.setPrototypeOf(this, new.target.prototype)
    this.code = payload.code
    this.status = payload.status
    this.retryable = payload.retryable
    this.tags = payload.tags
    this.details = payload.details
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target)
    }
  }
}

// ─── Match Handler Types ──────────────────────────────────────────────────────

/**
 * Client match handlers object type.
 */
type ClientMatchHandlersForUnion<
  TCodes extends CodesRecord,
  TUnion extends string,
  R,
> = {
  [K in PatternForCodes<TUnion>]?: (e: MatchingErrataClientErrorForCodes<TCodes, TUnion, K>) => R
} & {
  default?: (e: ErrataClientErrorForCodes<TCodes, TUnion>) => R
}

export type ClientMatchHandlers<TCodes extends CodesRecord, R> = ClientMatchHandlersForUnion<
  TCodes,
  ClientCode<TCodes>,
  R
>

/**
 * Client-side surface derived from a server `errors` type.
 */
export interface ErrorClient<TCodes extends CodesRecord> {
  /** Client-side ErrataError constructor for instanceof checks. */
  ErrataError: new (
    payload: SerializedError<ClientCode<TCodes>, any>
  ) => ErrataClientErrorForCodes<TCodes, ClientCode<TCodes>>
  /** Turn a serialized payload into a client error instance. */
  deserialize: (
    payload: unknown,
  ) => ErrataClientErrorForCodes<TCodes, ClientCode<TCodes>>
  /** Normalize unknown errors into ErrataClientError. */
  ensure: (
    err: unknown,
  ) => ErrataClientErrorForCodes<TCodes, ClientCode<TCodes>>
  /**
   * Type-safe pattern check; supports exact codes, wildcard patterns (`'auth.*'`),
   * and arrays of patterns. Returns a type guard narrowing the error type.
   */
  is: {
    <C extends ClientCode<TCodes>, P extends PatternInputForCodes<C> | readonly PatternInputForCodes<C>[]>(
      err: ErrataClientErrorForCodes<TCodes, C>,
      pattern: P,
    ): err is MatchingErrataClientErrorForCodes<TCodes, C, P>
    (
      err: unknown,
      pattern: PatternInputForCodes<ClientCode<TCodes>> | readonly PatternInputForCodes<ClientCode<TCodes>>[],
    ): boolean
  }
  /**
   * Pattern matcher over codes with priority: exact match > longest wildcard > default.
   * Supports exact codes, wildcard patterns (`'auth.*'`), and a `default` handler.
   */
  match: {
    <C extends ClientCode<TCodes>, R>(
      err: ErrataClientErrorForCodes<TCodes, C>,
      handlers: ClientMatchHandlersForUnion<TCodes, C, R>,
    ): R | undefined
    <R>(
      err: unknown,
      handlers: ClientMatchHandlersForUnion<TCodes, ClientCode<TCodes>, R>,
    ): R | undefined
  }
  /** Check whether an error carries a given tag. */
  hasTag: <TTag extends string>(
    err: unknown,
    tag: TTag,
  ) => err is MatchingErrataClientErrorForCodes<
    TCodes,
    CodeOf<TCodes>,
    Extract<CodesForTag<TCodes, TTag>, CodeOf<TCodes>>
  >
  /** Promise helper that returns a tuple without try/catch. */
  safe: <T>(
    promise: Promise<T>,
  ) => Promise<
    [data: T, error: null] | [data: null, error: ErrataClientErrorForCodes<TCodes, ClientCode<TCodes>>]
  >
}

type InferCodes<T> = T extends ErrataInstance<infer TCodes>
  ? TCodes
  : CodesRecord

export interface ErrorClientOptions {
  /** Optional app identifier for debugging. */
  app?: string
  /** Optional lifecycle plugins (payload adaptation, logging). */
  plugins?: ErrataClientPlugin[]
  /**
   * Called when normalizing unknown values that are not recognized as serialized errors.
   * Return a code (string) to map it; return null/undefined to fall back to errata.unknown_error.
   */
  onUnknown?: (
    error: unknown,
    ctx: ClientContext,
  ) => string | null | undefined
}

/**
 * Create a client that understands the server codes (type-only).
 * @param options - Optional configuration including plugins.
 */
export function createErrorClient<TServer extends ErrataInstance<any>>(
  options: ErrorClientOptions = {},
): ErrorClient<InferCodes<TServer>> {
  const { app, plugins = [], onUnknown } = options

  type TCodes = InferCodes<TServer>
  type Code = CodeOf<TCodes>
  type ClientBoundaryCode = ClientCode<TCodes>
  type TaggedErrataClientError<TTag extends string> = MatchingErrataClientErrorForCodes<
    TCodes,
    Code,
    Extract<CodesForTag<TCodes, TTag>, Code>
  >

  // Validate plugin names for duplicates
  const pluginNames = new Set<string>()
  for (const plugin of plugins) {
    if (pluginNames.has(plugin.name)) {
      console.warn(`${LIB_NAME} client: Duplicate plugin name "${plugin.name}" detected`)
    }
    pluginNames.add(plugin.name)
  }

  // Build the config object for plugin context
  const config: ClientConfig = { app }

  // Build the plugin context
  const getContext = (): ClientContext => ({ config })

  const internal = (
    code: InternalCode,
    raw: unknown,
  ): ErrataClientErrorForCodes<TCodes, InternalCode> => {
    return new ErrataClientError<InternalCode, InternalDetails>({
      __brand: LIB_NAME,
      code,
      message: code,
      details: { raw },
      tags: [],
    }) as ErrataClientErrorForCodes<TCodes, InternalCode>
  }

  /** Run onCreate hooks for all plugins (side effects are independent). */
  const runOnCreateHooks = (error: ErrataClientError<any, any>): void => {
    const ctx = getContext()
    for (const plugin of plugins) {
      if (plugin.onCreate) {
        try {
          plugin.onCreate(error, ctx)
        }
        catch (hookError) {
          console.error(`${LIB_NAME} client: plugin "${plugin.name}" crashed in onCreate`, hookError)
        }
      }
    }
  }

  /** Turn an unknown payload into a client error instance with defensive checks. */
  const deserialize = (
    payload: unknown,
  ): ErrataClientErrorForCodes<TCodes, ClientBoundaryCode> => {
    // Try plugin onDeserialize hooks (first non-null wins)
    const ctx = getContext()
    for (const plugin of plugins) {
      if (plugin.onDeserialize) {
        try {
          const result = plugin.onDeserialize(payload, ctx)
          if (result !== null) {
            runOnCreateHooks(result)
            return result
          }
        }
        catch (hookError) {
          console.error(`${LIB_NAME} client: plugin "${plugin.name}" crashed in onDeserialize`, hookError)
        }
      }
    }

    // Standard deserialization logic
    let error: ErrataClientErrorForCodes<TCodes, ClientBoundaryCode>
    if (payload && typeof payload === 'object') {
      const withCode = payload as { code?: unknown }
      if (typeof withCode.code === 'string') {
        error = new ErrataClientError(withCode as SerializedError<ClientBoundaryCode, any>)
      }
      else if (onUnknown) {
        const mapped = onUnknown(payload, getContext())
        if (mapped) {
          error = new ErrataClientError({
            __brand: LIB_NAME,
            code: mapped as ClientBoundaryCode,
            message: String(mapped),
            details: payload as any,
            tags: [],
          })
          runOnCreateHooks(error)
          return error
        }
        error = internal('errata.unknown_error', payload)
      }
      else {
        error = internal('errata.unknown_error', payload)
      }
    }
    else if (onUnknown) {
      const mapped = onUnknown(payload, getContext())
      if (mapped) {
        error = new ErrataClientError({
          __brand: LIB_NAME,
          code: mapped as ClientBoundaryCode,
          message: String(mapped),
          details: payload as any,
          tags: [],
        })
        runOnCreateHooks(error)
        return error
      }
      error = internal('errata.unknown_error', payload)
    }
    else {
      error = internal('errata.unknown_error', payload)
    }

    runOnCreateHooks(error)
    return error
  }

  /** Normalize unknown input into a client error (plugin-first). */
  const ensure = (
    err: unknown,
  ): ErrataClientErrorForCodes<TCodes, ClientBoundaryCode> => {
    // Pass through existing client errors
    if (err instanceof ErrataClientError) {
      return err
    }

    // Normalize via deserialize pipeline (includes onUnknown)
    return deserialize(err)
  }

  /** Type-safe pattern check; supports exact codes, wildcard patterns, and arrays. */
  const is = ((
    err: unknown,
    pattern: PatternInputForCodes<ClientBoundaryCode> | readonly PatternInputForCodes<ClientBoundaryCode>[],
  ): boolean => {
    if (!(err instanceof ErrataClientError))
      return false

    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    return patterns.some(p => matchesPattern(err.code, p as string))
  }) as ErrorClient<TCodes>['is']

  /** Pattern matcher with priority: exact match > longest wildcard > default. */
  const match = ((
    err: unknown,
    handlers: ClientMatchHandlersForUnion<TCodes, ClientBoundaryCode, any>,
  ): any => {
    const errataErr = err instanceof ErrataClientError ? err : ensure(err)

    const handlerKeys = Object.keys(handlers).filter(k => k !== 'default')
    const matchedPattern = findBestMatchingPattern(errataErr.code, handlerKeys)
    const handler = matchedPattern
      ? (handlers as any)[matchedPattern]
      : (handlers as any).default

    return handler ? handler(errataErr) : undefined
  }) as ErrorClient<TCodes>['match']

  /** Check whether an error carries a given tag. */
  const hasTag = <TTag extends string>(
    err: unknown,
    tag: TTag,
  ): err is TaggedErrataClientError<TTag> => {
    if (!(err instanceof ErrataClientError))
      return false
    return (err.tags ?? []).includes(tag)
  }

  /** Promise helper returning a tuple without try/catch at call sites. */
  const safe = async <T>(
    promise: Promise<T>,
  ): Promise<
    [data: T, error: null] | [data: null, error: ErrataClientErrorForCodes<TCodes, ClientBoundaryCode>]
  > => {
    try {
      const data = await promise
      return [data, null]
    }
    catch (err) {
      return [null, ensure(err)]
    }
  }

  return {
    ErrataError: ErrataClientError,
    deserialize,
    ensure,
    is,
    match,
    hasTag,
    safe,
  }
}
