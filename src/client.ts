import type { SerializedError } from './app-error'
import type { BetterErrorsInstance } from './better-errors'
import type { CodeOf, CodesRecord, DetailsOf } from './types'

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
