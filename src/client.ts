import type { SerializedError } from './app-error'
import type { BetterErrorsInstance } from './better-errors'
import type {
  CodeOf,
  CodesRecord,
  CodesWithTag,
  DetailsOf,
  MatchingClientAppError,
  Pattern,
  PatternInput,
} from './types'

import { findBestMatchingPattern, matchesPattern } from './utils/pattern-matching'

// ─── Client Types ─────────────────────────────────────────────────────────────

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

// ─── Match Handler Types ──────────────────────────────────────────────────────

/**
 * Client match handlers object type.
 */
export type ClientMatchHandlers<TCodes extends CodesRecord, R> = {
  [K in Pattern<TCodes>]?: (e: MatchingClientAppError<TCodes, K>) => R
} & {
  default?: (e: ClientAppError<CodeOf<TCodes>>) => R
}

/**
 * Client-side surface derived from a server `errors` type.
 */
export interface ErrorClient<TCodes extends CodesRecord> {
  /** Client-side AppError constructor for instanceof checks. */
  AppError: new (
    payload: SerializedError<CodeOf<TCodes>, any>
  ) => ClientAppError<CodeOf<TCodes>, any>
  /** Turn a serialized payload into a client error instance. */
  deserialize: <C extends CodeOf<TCodes>>(
    json: SerializedError<C, DetailsOf<TCodes, C>>,
  ) => ClientAppError<C, DetailsOf<TCodes, C>>
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
  hasTag: (err: unknown, tag: string) => boolean
}

type InferCodes<T> = T extends BetterErrorsInstance<infer TCodes>
  ? TCodes
  : CodesRecord

/**
 * Create a client that understands the server codes (type-only).
 */
export function createErrorClient<TServer extends BetterErrorsInstance<any>>(): ErrorClient<
  InferCodes<TServer>
> {
  type TCodes = InferCodes<TServer>
  type Code = CodeOf<TCodes>
  type TaggedClientAppError<TTag extends string>
    = CodesWithTag<TCodes, TTag> extends infer C
      ? C extends Code
        ? MatchingClientAppError<TCodes, C>
        : never
      : never

  /** Turn a serialized payload into a client error instance. */
  const deserialize = <C extends Code>(
    json: SerializedError<C, DetailsOf<TCodes, C>>,
  ): ClientAppError<C, DetailsOf<TCodes, C>> => {
    return new ClientAppError<C, DetailsOf<TCodes, C>>(json)
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

  return {
    AppError: ClientAppError,
    deserialize,
    is,
    match,
    hasTag,
  }
}
