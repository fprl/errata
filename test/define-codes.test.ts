import type { DetailsOf } from '../src'

import { describe, expect, expectTypeOf, it } from 'vitest'

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
})
