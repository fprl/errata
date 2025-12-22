export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export const LIB_NAME = 'errata' as const

export const PROPS_DEFAULT = Symbol(`${LIB_NAME}:props-default`)

interface PropsMarker { [PROPS_DEFAULT]?: 'default' | 'strict' }

export type InternalCode = 'errata.unknown_error'

export interface InternalDetails {
  raw: unknown
}

/**
 * Details tagged with defaults from props().
 * Internal marker is stripped from public helpers.
 */
export type PropsWithDefault<T> = T & { [PROPS_DEFAULT]?: 'default' }
export type PropsStrict<T> = T & { [PROPS_DEFAULT]?: 'strict' }

type StripPropsMarker<T> = T extends any
  ? T extends PropsMarker ? Omit<T, typeof PROPS_DEFAULT> : T
  : never

type RawDetails<T> = T extends CodeConfig<infer D> ? D : unknown

type HasDefaultDetails<D> = D extends { [PROPS_DEFAULT]?: infer Kind }
  ? Extract<Kind, 'default'> extends never ? false : true
  : false

type DetailsOptional<T>
  = 'details' extends keyof T
    ? HasDefaultDetails<RawDetails<T>> extends true
      ? true
      : [RawDetails<T>] extends [void | undefined]
          ? true
          : [undefined extends RawDetails<T> ? true : false] extends [true]
              ? true
              : false
    : true

type NonOptionalDetails<T> = StripPropsMarker<Exclude<RawDetails<T>, undefined>>
type OptionalDetails<T> = StripPropsMarker<RawDetails<T>>

export type DetailsPayload<T> = StripPropsMarker<T>

export type TagsOfConfig<TConfig> = NonNullable<TConfig extends { tags?: readonly (infer T)[] } ? T : never>

export type CodesWithTag<
  TCodes extends CodesRecord,
  TTag extends string,
> = {
  [C in CodeOf<TCodes>]: TTag extends TagsOfConfig<TCodes[C]> ? C : never
}[CodeOf<TCodes>]

export type CodesForTag<
  TCodes extends CodesRecord,
  TTag extends string,
> = CodesWithTag<TCodes, TTag> extends never ? CodeOf<TCodes> : CodesWithTag<TCodes, TTag>

/** Resolves the error message for a code, optionally using its typed details. */
export type MessageResolver<TDetails>
  = | string
    | ((ctx: { details: DetailsPayload<TDetails> }) => string)

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
  tags?: readonly string[]
}

export type CodesRecord = Record<string, CodeConfig<any>>
export type CodeOf<TCodes extends CodesRecord> = Extract<keyof TCodes, string>

type ExtractDetails<T> = T extends CodeConfig<infer D>
  ? StripPropsMarker<D> extends void | undefined ? unknown : StripPropsMarker<D>
  : unknown

type DetailsForCode<
  TCodes extends CodesRecord,
  C extends string,
> = C extends CodeOf<TCodes>
  ? DetailsOf<TCodes, C>
  : C extends InternalCode
    ? InternalDetails
    : unknown

export type DetailsOf<
  TCodes extends CodesRecord,
  TCode extends CodeOf<TCodes>,
> = ExtractDetails<TCodes[TCode]>

export type DetailsArg<
  TCodes extends CodesRecord,
  TCode extends CodeOf<TCodes>,
> = DetailsOptional<TCodes[TCode]> extends true
  ? OptionalDetails<TCodes[TCode]> | undefined
  : NonOptionalDetails<TCodes[TCode]>

export type CodesOf<T extends { _codesBrand?: any }> = NonNullable<T['_codesBrand']>

// ─── Pattern Matching Types ───────────────────────────────────────────────────

/**
 * Extracts dot-separated prefixes from a string type.
 * E.g., 'auth.login.failed' -> 'auth' | 'auth.login'
 */
type DotPrefixes<S extends string> = S extends `${infer Head}.${infer Tail}`
  ? Head | `${Head}.${DotPrefixes<Tail>}`
  : never

/**
 * Valid wildcard patterns derived from actual code prefixes (string unions).
 */
type ValidWildcardsForCodes<TCodes extends string> = `${DotPrefixes<TCodes>}.*`

/**
 * Pattern type for is() - uses ${string}.* to hide wildcards from autocomplete.
 * Type narrowing still works because MatchingCodes handles the pattern at call site.
 */
export type PatternInputForCodes<TCodes extends string>
  = | TCodes
    | `${string}.*`

export type PatternInput<TCodes extends CodesRecord> = PatternInputForCodes<CodeOf<TCodes>>

/**
 * Pattern type for match() handlers - uses enumerated wildcards for proper
 * type narrowing in handler callbacks. Wildcards will appear in autocomplete.
 */
export type PatternForCodes<TCodes extends string>
  = | TCodes
    | ValidWildcardsForCodes<TCodes>

export type Pattern<TCodes extends CodesRecord> = PatternForCodes<CodeOf<TCodes>>

/**
 * Given a pattern P, resolve which codes from TCodes it matches.
 * - If P is an exact code, returns that code literal.
 * - If P is `'Prefix.*'`, returns a union of all codes starting with `'Prefix.'`.
 */
export type MatchingCodesFromUnion<
  TUnion extends string,
  P extends string,
> = P extends `${infer Prefix}.*`
  ? Extract<TUnion, `${Prefix}.${string}`>
  : Extract<TUnion, P>

export type MatchingCodes<
  TCodes extends CodesRecord,
  P extends string,
> = MatchingCodesFromUnion<CodeOf<TCodes>, P>

/**
 * Resolve matching codes from a pattern or array of patterns.
 */
export type ResolveMatchingCodes<
  TCodes extends CodesRecord,
  P,
> = ResolveMatchingCodesFromUnion<CodeOf<TCodes>, P>

export type ResolveMatchingCodesFromUnion<
  TUnion extends string,
  P,
> = P extends readonly (infer U)[]
  ? U extends string ? MatchingCodesFromUnion<TUnion, U> : never
  : P extends string ? MatchingCodesFromUnion<TUnion, P> : never

/**
 * Helper type that distributes over a code union.
 * For each code C in the union, creates an ErrataError with that specific code and its details.
 */
export type ErrataErrorForCodes<
  TCodes extends CodesRecord,
  C extends string,
> = import('./errata-error').ErrataError<C, DetailsForCode<TCodes, C>>

type DistributeErrataErrorForCodes<
  TCodes extends CodesRecord,
  C extends string,
> = C extends unknown ? ErrataErrorForCodes<TCodes, C> : never

/**
 * Creates a union of ErrataError types for each matching code.
 * Uses distributive conditional types to properly correlate code with its details.
 */
export type MatchingErrataError<
  TCodes extends CodesRecord,
  P,
> = DistributeErrataErrorForCodes<TCodes, ResolveMatchingCodes<TCodes, P>>

export type MatchingErrataErrorForCodes<
  TCodes extends CodesRecord,
  TUnion extends string,
  P,
> = DistributeErrataErrorForCodes<TCodes, ResolveMatchingCodesFromUnion<TUnion, P>>

/**
 * Helper type that distributes over a code union for ErrataClientError.
 * For each code C in the union, creates a ErrataClientError with that specific code and its details.
 */
export type ErrataClientErrorForCodes<
  TCodes extends CodesRecord,
  C extends string,
> = import('./client').ErrataClientError<C, DetailsForCode<TCodes, C>>

type DistributeErrataClientErrorForCodes<
  TCodes extends CodesRecord,
  C extends string,
> = C extends unknown ? ErrataClientErrorForCodes<TCodes, C> : never

/**
 * Creates a union of ErrataClientError types for each matching code.
 * Uses distributive conditional types to properly correlate code with its details.
 */
export type MatchingErrataClientError<
  TCodes extends CodesRecord,
  P,
> = DistributeErrataClientErrorForCodes<TCodes, ResolveMatchingCodes<TCodes, P>>

export type MatchingErrataClientErrorForCodes<
  TCodes extends CodesRecord,
  TUnion extends string,
  P,
> = DistributeErrataClientErrorForCodes<TCodes, ResolveMatchingCodesFromUnion<TUnion, P>>

/**
 * Extracts the prefix from a wildcard pattern (e.g., 'auth.*' -> 'auth').
 * Returns never for non-wildcard patterns.
 */
export type ExtractPrefix<P extends string> = P extends `${infer Prefix}.*` ? Prefix : never

// ─── Plugin Types ─────────────────────────────────────────────────────────────

/**
 * Helper to extract codes from a plugin type.
 */
export type PluginCodes<T> = T extends ErrataPlugin<infer C> ? C : never

/**
 * Merge codes from a tuple of plugins into a single CodesRecord.
 */
export type MergePluginCodes<T extends readonly any[]> = T extends readonly [infer Head, ...infer Tail]
  ? PluginCodes<Head> & MergePluginCodes<Tail>
  // eslint-disable-next-line ts/no-empty-object-type
  : {}

/**
 * Configuration record for error codes.
 * Same as CodesRecord but explicitly for plugin definitions.
 */
export type CodeConfigRecord = CodesRecord

/**
 * Configuration exposed to plugins via the context object.
 */
export interface ErrataConfig {
  /** Optional app identifier for logging/observability. */
  app?: string
  /** Server-only environment label (e.g. dev/staging/prod). */
  env?: string
  /** Default numeric status when none is provided per-code. */
  defaultStatus: number
  /** Default advisory flag for user-facing exposure. */
  defaultExpose: boolean
  /** Default hint for retry-worthiness. */
  defaultRetryable: boolean
}

/**
 * Context object passed to server-side plugin hooks.
 * Provides restricted access to the errata instance.
 */
export interface ErrataContext<TCodes extends CodesRecord = CodesRecord> {
  /** Create an ErrataError for a known code. */
  create: (code: CodeOf<TCodes>, details?: any) => import('./errata-error').ErrataError<CodeOf<TCodes>, any>
  /** Normalize unknown errors into ErrataError. */
  ensure: (
    err: unknown,
    fallbackCode?: CodeOf<TCodes>,
  ) => import('./errata-error').ErrataError<CodeOf<TCodes> | InternalCode, any>
  /** Access to instance configuration. */
  config: ErrataConfig
}

/**
 * Server-side plugin interface.
 * Plugins can inject codes, intercept errors, and observe error creation.
 */
export interface ErrataPlugin<TPluginCodes extends CodeConfigRecord = CodeConfigRecord> {
  /** Unique name for debugging/deduplication. */
  name: string

  /**
   * Dictionary of codes to merge into the main registry.
   * These must be strictly typed so the user gets autocomplete.
   */
  codes?: TPluginCodes

  /**
   * Hook: Input Mapping
   * Runs inside `errors.ensure(err)`.
   * @param error - The raw unknown error being ensured.
   * @param ctx - The errata instance (restricted context).
   * @returns ErrataError instance OR { code, details } OR null (to pass).
   */
  onUnknown?: (
    error: unknown,
    ctx: ErrataContext<TPluginCodes>,
  ) => import('./errata-error').ErrataError<any, any> | { code: string, details?: any } | null

  /**
   * Hook: Serialization Adaptation
   * Runs inside `errors.serialize(err)` with the mutable payload.
   * @param payload - The current serialized error payload.
   * @param error - The original ErrataError instance.
   * @param ctx - The errata instance (restricted context).
   * @returns A SerializedError (can be the same object or a modified clone).
   */
  onSerialize?: (
    payload: import('./errata-error').SerializedError<string, any>,
    error: import('./errata-error').ErrataError<any, any>,
    ctx: ErrataContext<TPluginCodes>,
  ) => import('./errata-error').SerializedError<string, any>

  /**
   * Hook: Side Effects
   * Runs synchronously inside `errors.create()` (and by extension `throw`).
   * All plugins receive this callback (side effects are independent).
   * @param error - The fully formed ErrataError instance.
   * @param ctx - The errata instance.
   */
  onCreate?: (
    error: import('./errata-error').ErrataError<any, any>,
    ctx: ErrataContext<TPluginCodes>,
  ) => void
}

// ─── Client Plugin Types ──────────────────────────────────────────────────────

/**
 * Client configuration exposed to plugins.
 */
export interface ClientConfig {
  /** App identifier if provided. */
  app?: string
}

/**
 * Context object passed to client-side plugin hooks.
 */
export interface ClientContext {
  /** Access to client configuration. */
  config: ClientConfig
}

/**
 * Client-side plugin interface.
 * Primarily for adapting network payloads and observing error creation.
 */
export interface ErrataClientPlugin {
  /** Unique name for debugging/deduplication. */
  name: string

  /**
   * Hook: Payload Adaptation
   * Runs inside `client.deserialize(payload)`.
   * @param payload - The raw input (usually JSON).
   * @param ctx - Client context.
   * @returns ErrataClientError instance OR null (to pass to next plugin).
   */
  onDeserialize?: (
    payload: unknown,
    ctx: ClientContext,
  ) => import('./client').ErrataClientError<any, any> | null

  /**
   * Hook: Side Effects
   * Runs when `deserialize` succeeds.
   * All plugins receive this callback (side effects are independent).
   * @param error - The ErrataClientError instance.
   * @param ctx - Client context.
   */
  onCreate?: (
    error: import('./client').ErrataClientError<any, any>,
    ctx: ClientContext,
  ) => void
}
