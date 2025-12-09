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

export type DetailsOf<
  TCodes extends CodesRecord,
  TCode extends CodeOf<TCodes>,
> = TCodes[TCode]['details'] extends undefined ? unknown : TCodes[TCode]['details']

export type CodesOf<T extends { _codesBrand?: any }> = NonNullable<T['_codesBrand']>
