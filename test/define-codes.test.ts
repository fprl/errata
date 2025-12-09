import type { DetailsOf } from '../src'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { code, defineCodes } from '../src'
import { codes } from './fixtures'

describe('defineCodes', () => {
  it('flattens nested code definitions and keeps metadata', () => {
    expect(Object.keys(codes).sort()).toEqual([
      'auth.invalid_token',
      'billing.payment_failed',
      'core.internal_error',
    ])
    expect(codes['billing.payment_failed'].retryable).toBe(true)
    expect(codes['auth.invalid_token'].status).toBe(401)
  })

  it('exposes typed details per code', () => {
    type PaymentDetails = DetailsOf<typeof codes, 'billing.payment_failed'>
    type InvalidTokenDetails = DetailsOf<typeof codes, 'auth.invalid_token'>
    expectTypeOf<PaymentDetails>().toEqualTypeOf<{
      provider: 'stripe' | 'adyen'
      amount: number
    }>()
    expectTypeOf<InvalidTokenDetails>().toEqualTypeOf<{
      reason: 'expired' | 'revoked'
    }>()
  })

  it('accepts typed details via code helper and mixes with raw configs', () => {
    const localCodes = defineCodes({
      'auth.rejected': code<{ reason: 'expired' | 'missing' }>({
        status: 401,
        message: 'Auth rejected',
      }),
      'payments': {
        failed: code<{ amount: number }>({
          status: 402,
          message: ({ details }) => `Failed to charge $${details.amount}`,
        }),
      },
      'misc': {
        simple: { message: 'ok' },
      },
    } as const)

    type RejectDetails = DetailsOf<typeof localCodes, 'auth.rejected'>
    type PaymentDetails = DetailsOf<typeof localCodes, 'payments.failed'>
    type SimpleDetails = DetailsOf<typeof localCodes, 'misc.simple'>

    expectTypeOf<RejectDetails>().toEqualTypeOf<{ reason: 'expired' | 'missing' }>()
    expectTypeOf<PaymentDetails>().toEqualTypeOf<{ amount: number }>()
    expectTypeOf<SimpleDetails>().toEqualTypeOf<unknown>()

    expect('details' in (localCodes['auth.rejected'] as any)).toBe(false)
  })
})
