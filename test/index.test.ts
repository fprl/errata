import type { CodesOf, DetailsOf } from '../src'

import { describe, expect, expectTypeOf, it } from 'vitest'
import { AppError, betterErrors, createErrorClient, defineCodes } from '../src'

const typeOnly = <T>() => undefined as unknown as T

const codes = defineCodes({
  'core.internal_error': {
    status: 500,
    message: 'Internal error',
    expose: false,
    retryable: false,
    tags: ['core'],
  },
  'auth': {
    invalid_token: {
      status: 401,
      message: 'Invalid token',
      expose: true,
      retryable: false,
      tags: ['auth'],
      details: typeOnly<{ reason: 'expired' | 'revoked' }>(),
    },
  },
  'billing': {
    payment_failed: {
      status: 402,
      expose: true,
      retryable: true,
      tags: ['billing'],
      message: ({ details }: { details: { provider: 'stripe' | 'adyen', amount: number } }) =>
        `Payment failed for ${details.provider} (${details.amount})`,
      details: typeOnly<{ provider: 'stripe' | 'adyen', amount: number }>(),
    },
  },
} as const)

const errors = betterErrors({
  app: 'test-app',
  env: 'test',
  defaultStatus: 500,
  defaultExpose: false,
  codes,
})

type ErrorCode = keyof typeof codes

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

describe('betterErrors basics', () => {
  it('creates AppError with resolved message and typed details', () => {
    const error = errors.create('billing.payment_failed', {
      provider: 'stripe',
      amount: 42,
    })

    expect(error).toBeInstanceOf(AppError)
    expect(error).toBeInstanceOf(errors.AppError)
    expect(error.code).toBe('billing.payment_failed')
    expect(error.message).toBe('Payment failed for stripe (42)')
    expect(error.status).toBe(402)
    expect(error.retryable).toBe(true)
    expect(error.tags).toEqual(['billing'])
    expectTypeOf(error.details).toEqualTypeOf<{
      provider: 'stripe' | 'adyen'
      amount: number
    }>()
  })

  it('throws AppError via throw helper', () => {
    expect(() =>
      errors.throw('auth.invalid_token', { reason: 'expired' }),
    ).toThrowError(AppError)
  })

  it('wraps unknown errors with ensure and fallback code', () => {
    const original = new Error('boom')
    const ensured = errors.ensure(original, 'core.internal_error')
    expect(ensured.code).toBe('core.internal_error')
    expect(ensured.details).toEqual({ cause: original })
  })

  it('supports is/match helpers', () => {
    const err = errors.create('auth.invalid_token', { reason: 'expired' })
    expect(errors.is(err, 'auth.invalid_token')).toBe(true)
    expect(errors.is(err, ['core.internal_error', 'billing.payment_failed'])).toBe(
      false,
    )

    const matched = errors.match(err, {
      'auth.invalid_token': e => `auth:${e.details.reason}`,
      'default': e => `default:${e.code}`,
    })
    expect(matched).toBe('auth:expired')
  })

  it('serializes and deserializes with brand', () => {
    const err = errors.create('billing.payment_failed', {
      provider: 'adyen',
      amount: 12,
    })
    const json = errors.serialize(err)

    expect(json.__brand).toBe('better-errors')
    expect(json.code).toBe('billing.payment_failed')
    expect(json.tags).toEqual(['billing'])

    const restored = errors.deserialize(json)
    expect(restored).toBeInstanceOf(errors.AppError)
    expect(restored.message).toContain('Payment failed for adyen (12)')
  })

  it('produces HTTP-friendly shape', () => {
    const err = errors.create('auth.invalid_token', { reason: 'revoked' })
    const { status, body } = errors.http.from(err)

    expect(status).toBe(401)
    expect(body).toEqual({ error: errors.serialize(err) })

    const unknown = new Error('oops')
    const normalized = errors.http.from(unknown, 'core.internal_error')
    expect(normalized.status).toBe(500)
    expect(normalized.body.error.code).toBe('core.internal_error')
  })
})

describe('client error client', () => {
  const client = createErrorClient<typeof errors>()

  it('deserializes and matches codes', () => {
    const serverErr = errors.create('auth.invalid_token', { reason: 'expired' })
    const payload = errors.serialize(serverErr)
    const err = client.deserialize(payload)

    expect(err).toBeInstanceOf(client.AppError)
    expect(client.is(err, 'auth.invalid_token')).toBe(true)
    expect(
      client.match(err, {
        'auth.invalid_token': e => `client:${e.code}`,
        'default': e => `default:${e.code}`,
      }),
    ).toBe('client:auth.invalid_token')
  })

  it('exposes the code union via CodesOf', () => {
    type ClientCode = CodesOf<typeof errors>
    expectTypeOf<ClientCode>().toEqualTypeOf<ErrorCode>()
  })
})
