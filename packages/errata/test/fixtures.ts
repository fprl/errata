import { code, defineCodes, errata, props } from '../src'

export const codes = defineCodes({
  core: {
    internal_error: {
      status: 500,
      message: 'Internal error',
      expose: false,
      retryable: false,
      tags: ['core'] as const,
    },
    config_missing: code({
      status: 500,
      message: ({ details }) => `Missing config: ${details.key}`,
      tags: ['core', 'config'] as const,
      details: props<{ key: string }>(),
    }),
  },
  auth: {
    invalid_token: code({
      status: 401,
      message: 'Invalid token',
      expose: true,
      retryable: false,
      tags: ['auth', 'security'] as const,
      details: props<{ reason: 'expired' | 'revoked' }>(),
    }),
    user_not_found: code({
      status: 404,
      message: ({ details }) => `User ${details.userId} not found`,
      expose: true,
      retryable: false,
      tags: ['auth', 'user'] as const,
      details: props<{ userId: string }>(),
    }),
  },
  billing: {
    payment_failed: code({
      status: 402,
      expose: true,
      retryable: true,
      tags: ['billing', 'payments'] as const,
      details: props<{ provider: 'stripe' | 'adyen', amount: number }>(),
      message: ({ details }) => `Payment failed for ${details.provider} (${details.amount})`,
    }),
    retry_later: code({
      status: 429,
      expose: true,
      retryable: true,
      tags: ['billing', 'retry'] as const,
      details: props({ retryAfter: 45 }),
      message: ({ details }) => `Retry after ${details.retryAfter}s`,
    }),
  },
  analytics: {
    event_dropped: {
      status: 202,
      message: 'Event dropped',
      expose: true,
      retryable: false,
      tags: ['analytics'] as const,
    },
  },
} as const)

export type ErrorCode = keyof typeof codes

export const errors = errata({
  app: 'test-app',
  env: 'test',
  defaultStatus: 500,
  defaultExpose: false,
  codes,
})
