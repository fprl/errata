import type { InternalCode } from '../src/types'
import type { ErrorCode } from './fixtures'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { code, defineCodes, errata, ErrataError, props } from '../src'
import { codes, errors } from './fixtures'

describe('errata basics', () => {
  it('creates ErrataError with resolved message and typed details', () => {
    const error = errors.create('billing.payment_failed', {
      provider: 'stripe',
      amount: 42,
    })

    expect(error).toBeInstanceOf(ErrataError)
    expect(error).toBeInstanceOf(errors.ErrataError)
    expect(error.code).toBe('billing.payment_failed')
    expect(error.message).toBe('Payment failed for stripe (42)')
    expect(error.status).toBe(402)
    expect(error.retryable).toBe(true)
    expect(error.tags).toEqual(['billing', 'payments'])
    expectTypeOf(error.details).toEqualTypeOf<{
      provider: 'stripe' | 'adyen'
      amount: number
    }>()
  })

  it('throws ErrataError via throw helper', () => {
    expect(() => {
      throw errors.create('auth.invalid_token', { reason: 'expired' })
    }).toThrowError(ErrataError)
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

  it('normalizes unknown errors in match and widens type', () => {
    const result = errors.match(new Error('boom'), {
      default: (e) => {
        expectTypeOf(e.code).toEqualTypeOf<ErrorCode | InternalCode>()
        return e.code
      },
    })

    expect(result).toBe('errata.unknown_error')
  })

  it('serializes and deserializes with brand', () => {
    const err = errors.create('billing.payment_failed', {
      provider: 'adyen',
      amount: 12,
    })
    const json = errors.serialize(err)

    expect(json.__brand).toBe('errata')
    expect(json.code).toBe('billing.payment_failed')
    expect(json.tags).toEqual(['billing', 'payments'])

    const restored = errors.deserialize(json)
    expect(restored).toBeInstanceOf(errors.ErrataError)
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

  it('enforces detail requirements via props helper', () => {
    const local = errata({
      codes: defineCodes({
        'users.missing': code({
          message: 'User missing',
          details: props<{ userId: string }>(),
        }),
        'ops.rate_limited': code({
          status: 429,
          message: ({ details }) => `Retry after ${details.retryAfter}s`,
          details: props({ retryAfter: 60 }),
        }),
      }),
    })

    const defaulted = local.create('ops.rate_limited')
    expect(defaulted.details).toEqual({ retryAfter: 60 })
    expect(defaulted.message).toBe('Retry after 60s')

    const override = local.create('ops.rate_limited', { retryAfter: 5 })
    expect(override.details.retryAfter).toBe(5)

    const strict = local.create('users.missing', { userId: 'u1' })
    expect(strict.details.userId).toBe('u1')
  })

  it('applies defaulted details and narrows by tag', () => {
    const defaulted = errors.create('billing.retry_later')
    expect(defaulted.details).toEqual({ retryAfter: 45 })
    expect(defaulted.message).toBe('Retry after 45s')

    const withOverride = errors.create('billing.retry_later', { retryAfter: 10 })
    expect(withOverride.details.retryAfter).toBe(10)

    const paymentErr = errors.create('billing.payment_failed', {
      provider: 'stripe',
      amount: 12,
    })

    if (errors.hasTag(paymentErr, 'payments')) {
      expectTypeOf(paymentErr.code).toEqualTypeOf<'billing.payment_failed'>()
      expect(paymentErr.details.amount).toBe(12)
    }

    const authErr: unknown = errors.create('auth.invalid_token', { reason: 'expired' })
    if (errors.hasTag(authErr, 'auth')) {
      expectTypeOf(authErr.code).toEqualTypeOf<'auth.invalid_token' | 'auth.user_not_found'>()
      if (authErr.code === 'auth.invalid_token') {
        expect(authErr.details.reason).toBe('expired')
      }
    }
  })

  it('respects defaultExpose when code omits expose', () => {
    const exposedErrors = errata({
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
    const hiddenErrors = errata({
      codes: defineCodes({
        'misc.hidden': { message: 'Hidden by default', expose: false },
      }),
    })

    const err = hiddenErrors.create('misc.hidden', { secret: 'shh' } as any)
    const payload = hiddenErrors.serialize(err)

    expect(err.expose).toBe(false)
    expect(payload.details).toBeUndefined()
  })

  describe('safe', () => {
    it('returns data for resolved promises and narrows tuple types', async () => {
      const userPromise = Promise.resolve({ id: 'u1', name: 'Ada' })
      const [user, err] = await errors.safe(userPromise)

      expect(err).toBeNull()
      expect(user).toEqual({ id: 'u1', name: 'Ada' })

      if (err) {
        expectTypeOf(user).toEqualTypeOf<null>()
      }
      else {
        expectTypeOf(user).toEqualTypeOf<{ id: string, name: string }>()
        expectTypeOf(err).toEqualTypeOf<null>()
      }
    })

    it('normalizes rejected promises into ErrataError tuple', async () => {
      const failingPromise: Promise<number> = Promise.reject(new Error('db down'))
      const [value, err] = await errors.safe(failingPromise)

      expect(value).toBeNull()
      expect(err).toBeInstanceOf(errors.ErrataError)
      expect(err?.code).toBe('errata.unknown_error')

      if (err) {
        expectTypeOf(err).toMatchTypeOf<InstanceType<typeof errors.ErrataError>>()
        expectTypeOf(err.code).toEqualTypeOf<ErrorCode | InternalCode>()
        expectTypeOf(value).toEqualTypeOf<null>()
      }
      else {
        expectTypeOf(value).toEqualTypeOf<number>()
      }
    })

    it('handles synchronous throw from function input', async () => {
      const [value, err] = await errors.safe(() => {
        throw new Error('boom')
      })

      expect(value).toBeNull()
      expect(err).toBeInstanceOf(errors.ErrataError)
      expect(err?.code).toBe('errata.unknown_error')
    })

    it('handles async function that rejects', async () => {
      const [value, err] = await errors.safe(async () => {
        throw new Error('async boom')
      })

      expect(value).toBeNull()
      expect(err?.code).toBe('errata.unknown_error')
    })

    it('returns data from async function that resolves', async () => {
      const [value, err] = await errors.safe(async () => {
        return { ok: true as const }
      })

      expect(err).toBeNull()
      expect(value).toEqual({ ok: true })
    })
  })

  describe('onUnknown hook', () => {
    const withOnUnknown = errata({
      codes,
      onUnknown: err => err instanceof SyntaxError ? 'analytics.event_dropped' : null,
    })

    it('maps unknown errors via onUnknown to a user code', () => {
      const boom = new SyntaxError('bad payload')
      const ensured = withOnUnknown.ensure(boom)

      expect(ensured.code).toBe('analytics.event_dropped')
      expect((ensured.details as any).raw).toBe(boom)
    })

    it('bypasses onUnknown for existing ErrataError and respects fallback', () => {
      const existing = withOnUnknown.create('auth.invalid_token', { reason: 'expired' })
      expect(withOnUnknown.ensure(existing)).toBe(existing)

      const fallbackErr = withOnUnknown.ensure(new Error('boom'), 'auth.user_not_found')
      expect(fallbackErr.code).toBe('auth.user_not_found')
      expect((fallbackErr.details as any).cause).toBeInstanceOf(Error)
    })
  })
})
