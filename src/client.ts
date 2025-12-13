import type { SerializedError } from './app-error'
import type { ErrataInstance } from './errata'
import type {
  ClientConfig,
  ClientContext,
  CodeOf,
  CodesForTag,
  CodesRecord,
  ErrataClientPlugin,
  MatchingClientAppError,
  Pattern,
  PatternInput,
} from './types'

import { LIB_NAME } from './types'
import { findBestMatchingPattern, matchesPattern } from './utils/pattern-matching'

// ─── Client Types ─────────────────────────────────────────────────────────────

type InternalClientCode = 'be.unknown_error' | 'be.deserialization_failed' | 'be.network_error'
type ClientCode<TCodes extends CodesRecord> = CodeOf<TCodes> | InternalClientCode

export class ClientAppError<C extends string = string, D = unknown> extends Error {
  readonly name = 'AppError'
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
export type ClientMatchHandlers<TCodes extends CodesRecord, R> = {
  [K in Pattern<TCodes>]?: (e: MatchingClientAppError<TCodes, K>) => R
} & {
  default?: (e: ClientAppError<ClientCode<TCodes>>) => R
}

/**
 * Client-side surface derived from a server `errors` type.
 */
export interface ErrorClient<TCodes extends CodesRecord> {
  /** Client-side AppError constructor for instanceof checks. */
  AppError: new (
    payload: SerializedError<ClientCode<TCodes>, any>
  ) => ClientAppError<ClientCode<TCodes>, any>
  /** Turn a serialized payload into a client error instance. */
  deserialize: (
    payload: unknown,
  ) => ClientAppError<ClientCode<TCodes>, any>
  /**
   * Type-safe pattern check; supports exact codes, wildcard patterns (`'auth.*'`),
   * and arrays of patterns. Returns a type guard narrowing the error type.
   */
  is: <P extends PatternInput<TCodes> | readonly PatternInput<TCodes>[]>(
    err: unknown,
    pattern: P,
  ) => err is MatchingClientAppError<TCodes, P>
  /**
   * Pattern matcher over codes with priority: exact match > longest wildcard > default.
   * Supports exact codes, wildcard patterns (`'auth.*'`), and a `default` handler.
   */
  match: <R>(
    err: unknown,
    handlers: ClientMatchHandlers<TCodes, R>,
  ) => R | undefined
  /** Check whether an error carries a given tag. */
  hasTag: <TTag extends string>(
    err: unknown,
    tag: TTag,
  ) => err is MatchingClientAppError<
    TCodes,
    Extract<CodesForTag<TCodes, TTag>, CodeOf<TCodes>>
  >
  /** Promise helper that returns a tuple without try/catch. */
  safe: <T>(
    promise: Promise<T>,
  ) => Promise<
    [data: T, error: null] | [data: null, error: ClientAppError<ClientCode<TCodes>, any>]
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
}

/**
 * Create a client that understands the server codes (type-only).
 * @param options - Optional configuration including plugins.
 */
export function createErrorClient<TServer extends ErrataInstance<any>>(
  options: ErrorClientOptions = {},
): ErrorClient<InferCodes<TServer>> {
  const { app, plugins = [] } = options

  type TCodes = InferCodes<TServer>
  type Code = CodeOf<TCodes>
  type ClientCode = Code | 'be.unknown_error' | 'be.deserialization_failed' | 'be.network_error'
  type TaggedClientAppError<TTag extends string> = MatchingClientAppError<
    TCodes,
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
    code: Extract<ClientCode, `be.${string}`>,
    raw: unknown,
  ): ClientAppError<ClientCode, { raw: unknown }> => {
    return new ClientAppError<ClientCode, { raw: unknown }>({
      __brand: LIB_NAME,
      code,
      message: code,
      details: { raw },
      tags: [],
    })
  }

  /** Run onCreate hooks for all plugins (side effects are independent). */
  const runOnCreateHooks = (error: ClientAppError<any, any>): void => {
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
  ): ClientAppError<ClientCode, any> => {
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
    let error: ClientAppError<ClientCode, any>
    if (payload && typeof payload === 'object') {
      const withCode = payload as { code?: unknown }
      if (typeof withCode.code === 'string') {
        error = new ClientAppError(withCode as SerializedError<ClientCode, any>)
      }
      else {
        error = internal('be.deserialization_failed', payload)
      }
    }
    else {
      error = internal('be.unknown_error', payload)
    }

    runOnCreateHooks(error)
    return error
  }

  /** Type-safe pattern check; supports exact codes, wildcard patterns, and arrays. */
  const is = <P extends PatternInput<TCodes> | readonly PatternInput<TCodes>[]>(
    err: unknown,
    pattern: P,
  ): err is MatchingClientAppError<TCodes, P> => {
    if (!(err instanceof ClientAppError))
      return false

    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    return patterns.some(p => matchesPattern(err.code, p as string))
  }

  /** Pattern matcher with priority: exact match > longest wildcard > default. */
  const match = <R>(
    err: unknown,
    handlers: ClientMatchHandlers<TCodes, R>,
  ): R | undefined => {
    if (!(err instanceof ClientAppError)) {
      return (handlers as any).default?.(err)
    }

    const handlerKeys = Object.keys(handlers).filter(k => k !== 'default')
    const matchedPattern = findBestMatchingPattern(err.code, handlerKeys)
    const handler = matchedPattern
      ? (handlers as any)[matchedPattern]
      : (handlers as any).default

    return handler ? handler(err) : undefined
  }

  /** Check whether an error carries a given tag. */
  const hasTag = <TTag extends string>(
    err: unknown,
    tag: TTag,
  ): err is TaggedClientAppError<TTag> => {
    if (!(err instanceof ClientAppError))
      return false
    return (err.tags ?? []).includes(tag)
  }

  /** Promise helper returning a tuple without try/catch at call sites. */
  const safe = async <T>(
    promise: Promise<T>,
  ): Promise<
    [data: T, error: null] | [data: null, error: ClientAppError<ClientCode, any>]
  > => {
    try {
      const data = await promise
      return [data, null]
    }
    catch (err) {
      if (err instanceof ClientAppError) {
        return [null, err]
      }

      if (err instanceof TypeError) {
        return [null, internal('be.network_error', err)]
      }

      if (err && typeof err === 'object') {
        return [null, deserialize(err)]
      }

      return [null, deserialize(err)]
    }
  }

  return {
    AppError: ClientAppError,
    deserialize,
    is,
    match,
    hasTag,
    safe,
  }
}
