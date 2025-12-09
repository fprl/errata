import type { CodeConfig, CodesRecord } from './types'

type CodeWithoutDetails<TDetails> = Omit<CodeConfig<TDetails>, 'details'> & {
  /** Prevent passing runtime details; typing only. */
  details?: never
}

type FlattenCodes<
  TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
> = {
  [K in keyof TInput & string as TInput[K] extends CodeConfig<any> ? K : never]: Extract<
    TInput[K],
    CodeConfig<any>
  >;
} & {
  [K in keyof TInput & string as TInput[K] extends Record<string, CodeConfig<any>>
    ? `${K}.${keyof TInput[K] & string}`
    : never]: TInput[K] extends Record<string, CodeConfig<any>>
    ? TInput[K][keyof TInput[K] & string]
    : never;
}

type FlattenedCodes<
  TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
>
  = FlattenCodes<TInput> extends CodesRecord ? FlattenCodes<TInput> : CodesRecord

function isCodeConfig(value: unknown): value is CodeConfig {
  return !!value && typeof value === 'object' && 'message' in value
}

function flattenCodes(input: Record<string, any>, prefix = ''): CodesRecord {
  const result: CodesRecord = {}

  for (const [key, value] of Object.entries(input)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isCodeConfig(value)) {
      result[fullKey] = value
      continue
    }

    if (value && typeof value === 'object') {
      Object.assign(result, flattenCodes(value, fullKey))
    }
  }

  return result
}

/**
 * Define your codes registry (flat or one-level nested).
 * Returns a flattened, typed map of codes to config.
 */
export function defineCodes<
  TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
>(input: TInput): FlattenedCodes<TInput> {
  return flattenCodes(input) as FlattenedCodes<TInput>
}

/**
 * Type-only helper to declare the `details` shape without runtime noise.
 */
export function code<TDetails = void>(
  config: CodeWithoutDetails<TDetails>,
): CodeConfig<TDetails> {
  return config as CodeConfig<TDetails>
}
