import { betterErrors, code, defineCodes } from '../src'

export const codes = defineCodes({
  'core.internal_error': {
    status: 500,
    message: 'Internal error',
    expose: false,
    retryable: false,
    tags: ['core'],
  },
  'auth': {
    invalid_token: code<{ reason: 'expired' | 'revoked' }>({
      status: 401,
      message: 'Invalid token',
      expose: true,
      retryable: false,
      tags: ['auth'],
    }),
  },
  'billing': {
    payment_failed: code<{ provider: 'stripe' | 'adyen', amount: number }>({
      status: 402,
      expose: true,
      retryable: true,
      tags: ['billing'],
      message: ({ details }) => `Payment failed for ${details.provider} (${details.amount})`,
    }),
  },
} as const)

export type ErrorCode = keyof typeof codes

export const errors = betterErrors({
  app: 'test-app',
  env: 'test',
  defaultStatus: 500,
  defaultExpose: false,
  codes,
})
