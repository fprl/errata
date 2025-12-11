import type { CodeConfig, CodesRecord, PropsStrict, PropsWithDefault } from './types'

type NestedKeys<T> = {
  [K in keyof T]: T[K] extends Record<string, CodeConfig<any>>
    ? `${K & string}.${keyof T[K] & string}`
    : never
}[keyof T]

type NestedValue<T, P extends string>
  = P extends `${infer K}.${infer SubK}`
    ? K extends keyof T
      ? T[K] extends Record<string, any>
        ? SubK extends keyof T[K]
          ? T[K][SubK]
          : never
        : never
      : never
    : never

type FlattenCodes<
  TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
> = {
  [K in keyof TInput & string as TInput[K] extends CodeConfig<any> ? K : never]: Extract<
    TInput[K],
    CodeConfig<any>
  >;
} & {
  [P in NestedKeys<TInput>]: NestedValue<TInput, P>
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
  const TInput extends Record<string, CodeConfig<any> | Record<string, CodeConfig<any>>>,
>(input: TInput): FlattenedCodes<TInput> {
  return flattenCodes(input) as FlattenedCodes<TInput>
}

/**
 * Type-only helper to declare the `details` shape while optionally providing defaults.
 * Returns the defaults at runtime (or undefined), but tells TypeScript the details shape.
 */
export function props<T>(defaults: T): PropsWithDefault<T>
export function props<T>(): PropsStrict<T>
export function props<T>(defaults?: T): T {
  return defaults as T
}

/**
 * Identity helper that preserves literal inference for code configs.
 * Requires `details` to be present (use plain objects when no details are needed).
 */
export function code<C extends CodeConfig<any> & { details: unknown }>(config: C): C {
  return config
}
