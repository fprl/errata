export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** Resolves the error message for a code, optionally using its typed details. */
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

export type CodesRecord = Record<string, CodeConfig<any>>
export type CodeOf<TCodes extends CodesRecord> = Extract<keyof TCodes, string>

type ExtractDetails<T> = T extends CodeConfig<infer D>
  ? D extends void | undefined ? unknown : D
  : unknown

export type DetailsOf<
  TCodes extends CodesRecord,
  TCode extends CodeOf<TCodes>,
> = ExtractDetails<TCodes[TCode]>

export type CodesOf<T extends { _codesBrand?: any }> = NonNullable<T['_codesBrand']>

// ─── Pattern Matching Types ───────────────────────────────────────────────────

type DotPrefixes<S extends string> = S extends `${infer Head}.${infer Tail}`
  ? Head | `${Head}.${DotPrefixes<Tail>}`
  : never

/**
 * A pattern is either an exact code or a wildcard pattern ending with `.*`.
 * Wildcard patterns match any code starting with the prefix.
 * Examples: `'auth.invalid_token'` (exact), `'auth.*'` (wildcard)
 */
export type Pattern<TCodes extends CodesRecord>
  = | CodeOf<TCodes>
    | `${DotPrefixes<CodeOf<TCodes>>}.*`

/**
 * Given a pattern P, resolve which codes from TCodes it matches.
 * - If P is an exact code, returns that code literal.
 * - If P is `'Prefix.*'`, returns a union of all codes starting with `'Prefix.'`.
 */
export type MatchingCodes<
  TCodes extends CodesRecord,
  P extends string,
> = P extends `${infer Prefix}.*`
  ? Extract<CodeOf<TCodes>, `${Prefix}.${string}`>
  : Extract<CodeOf<TCodes>, P>

/**
 * Resolve matching codes from a pattern or array of patterns.
 */
export type ResolveMatchingCodes<
  TCodes extends CodesRecord,
  P,
> = P extends readonly (infer U)[]
  ? U extends string ? MatchingCodes<TCodes, U> : never
  : P extends string ? MatchingCodes<TCodes, P> : never

/**
 * Helper type that distributes over a code union.
 * For each code C in the union, creates an AppError with that specific code and its details.
 */
type DistributeAppError<
  TCodes extends CodesRecord,
  C extends CodeOf<TCodes>,
> = C extends unknown ? import('./app-error').AppError<C, DetailsOf<TCodes, C>> : never

/**
 * Creates a union of AppError types for each matching code.
 * Uses distributive conditional types to properly correlate code with its details.
 */
export type MatchingAppError<
  TCodes extends CodesRecord,
  P,
> = DistributeAppError<TCodes, ResolveMatchingCodes<TCodes, P>>

/**
 * Helper type that distributes over a code union for ClientAppError.
 * For each code C in the union, creates a ClientAppError with that specific code and its details.
 */
type DistributeClientAppError<
  TCodes extends CodesRecord,
  C extends CodeOf<TCodes>,
> = C extends unknown ? import('./client').ClientAppError<C, DetailsOf<TCodes, C>> : never

/**
 * Creates a union of ClientAppError types for each matching code.
 * Uses distributive conditional types to properly correlate code with its details.
 */
export type MatchingClientAppError<
  TCodes extends CodesRecord,
  P,
> = DistributeClientAppError<TCodes, ResolveMatchingCodes<TCodes, P>>

/**
 * Extracts the prefix from a wildcard pattern (e.g., 'auth.*' -> 'auth').
 * Returns never for non-wildcard patterns.
 */
export type ExtractPrefix<P extends string> = P extends `${infer Prefix}.*` ? Prefix : never
