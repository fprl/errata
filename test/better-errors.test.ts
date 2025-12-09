import { describe, expect, expectTypeOf, it } from 'vitest'

import { AppError, betterErrors, defineCodes } from '../src'
import { errors } from './fixtures'

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

  it('respects defaultExpose when code omits expose', () => {
    const exposedErrors = betterErrors({
      codes: defineCodes({
        'misc.visible': { message: 'Visible by default' },
      }),
      defaultExpose: true,
    })

    const err = exposedErrors.create('misc.visible', { foo: 'bar' } as any)
    const payload = exposedErrors.serialize(err)

    expect(err.expose).toBe(true)
    expect(payload.details).toEqual({ foo: 'bar' })
  })

  it('defaults expose to false when not set', () => {
    const hiddenErrors = betterErrors({
      codes: defineCodes({
        'misc.hidden': { message: 'Hidden by default', expose: false },
      }),
    })

    const err = hiddenErrors.create('misc.hidden', { secret: 'shh' } as any)
    const payload = hiddenErrors.serialize(err)

    expect(err.expose).toBe(false)
    expect(payload.details).toBeUndefined()
  })
})
