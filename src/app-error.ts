import type { DetailsPayload, LogLevel, MessageResolver } from './types'

/**
 * Structured wire format for errors.
 * - `status`: optional numeric code; usually HTTP status in web apps, otherwise a classification/exit code.
 * - `details`: structured payload for this code; passed through unchanged.
 */
export interface SerializedError<C extends string = string, D = unknown> {
  __brand: 'better-errors'
  app?: string
  code: C
  message: string
  status?: number
  retryable?: boolean
  logLevel?: LogLevel
  tags?: string[]
  details?: D
}

export class AppError<C extends string = string, D = unknown> extends Error {
  readonly name = 'AppError'
  readonly app?: string
  readonly env?: string
  readonly code: C
  readonly status: number
  readonly expose: boolean
  readonly retryable: boolean
  readonly logLevel: LogLevel
  readonly tags: string[]
  readonly details: D
  readonly cause?: unknown

  constructor(args: {
    app?: string
    env?: string
    code: C
    message: string
    status: number
    expose: boolean
    retryable: boolean
    logLevel: LogLevel
    tags: string[]
    details: D
    cause?: unknown
    captureStack?: boolean
  }) {
    super(args.message)
    Object.setPrototypeOf(this, new.target.prototype)
    this.app = args.app
    this.env = args.env
    this.code = args.code
    this.status = args.status
    this.expose = args.expose
    this.retryable = args.retryable
    this.logLevel = args.logLevel
    this.tags = args.tags
    this.details = args.details
    this.cause = args.cause

    if (args.captureStack !== false && Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target)
    }
  }

  toJSON(): SerializedError<C, D> {
    return {
      __brand: 'better-errors',
      app: this.app,
      // env is intentionally server-only; omitted from serialized shape
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      logLevel: this.logLevel,
      tags: this.tags,
      details: this.details,
    }
  }
}

export function resolveMessage<TDetails>(
  message: MessageResolver<TDetails>,
  details: DetailsPayload<TDetails>,
): string {
  return typeof message === 'function' ? message({ details }) : message
}

export function isSerializedError(value: unknown): value is SerializedError<string, unknown> {
  return (
    !!value
    && typeof value === 'object'
    && (value as SerializedError).__brand === 'better-errors'
  )
}
