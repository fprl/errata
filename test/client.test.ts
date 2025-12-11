import type { CodesOf } from '../src'
import type { ErrorCode } from './fixtures'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { createErrorClient } from '../src'
import { errors } from './fixtures'

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

  it('respects expose flag for details', () => {
    const exposed = errors.create('billing.payment_failed', {
      provider: 'stripe',
      amount: 10,
    })
    const exposedErr = client.deserialize(errors.serialize(exposed))
    expect(exposedErr.details).toEqual({ provider: 'stripe', amount: 10 })

    const hidden = errors.create('core.internal_error', { secret: 'nope' } as any)
    const hiddenPayload = errors.serialize(hidden)
    const hiddenErr = client.deserialize(hiddenPayload)
    expect(hiddenPayload.details).toBeUndefined()
    expect(hiddenErr.details).toBeUndefined()
  })
})

describe('client pattern matching: is()', () => {
  const client = createErrorClient<typeof errors>()

  describe('wildcard pattern matching', () => {
    it('matches codes starting with prefix using auth.*', () => {
      const tokenErr = client.deserialize(
        errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
      )
      const billingErr = client.deserialize(
        errors.serialize(errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 })),
      )

      expect(client.is(tokenErr, 'auth.*')).toBe(true)
      expect(client.is(billingErr, 'auth.*')).toBe(false)
      expect(client.is(billingErr, 'billing.*')).toBe(true)
    })

    it('narrows type for wildcard pattern', () => {
      const err: unknown = client.deserialize(
        errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
      )

      if (client.is(err, 'auth.*')) {
        expectTypeOf(err.code).toEqualTypeOf<'auth.invalid_token' | 'auth.user_not_found'>()
      }
    })
  })

  describe('array pattern matching', () => {
    it('matches any pattern in array', () => {
      const tokenErr = client.deserialize(
        errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
      )
      const billingErr = client.deserialize(
        errors.serialize(errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 })),
      )
      const coreErr = client.deserialize(
        errors.serialize(errors.create('core.internal_error', undefined)),
      )

      expect(client.is(tokenErr, ['auth.*', 'billing.*'])).toBe(true)
      expect(client.is(billingErr, ['auth.*', 'billing.*'])).toBe(true)
      expect(client.is(coreErr, ['auth.*', 'billing.*'])).toBe(false)
    })

    it('narrows type for array of patterns', () => {
      const err: unknown = client.deserialize(
        errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
      )

      if (client.is(err, ['auth.*', 'billing.payment_failed'])) {
        expectTypeOf(err.code).toEqualTypeOf<
          | 'auth.invalid_token'
          | 'auth.user_not_found'
          | 'billing.payment_failed'
        >()
      }
    })
  })

  describe('edge cases', () => {
    it('returns false for non-ClientAppError values', () => {
      expect(client.is(new Error('boom'), 'auth.*')).toBe(false)
      expect(client.is(null, 'auth.*')).toBe(false)
      expect(client.is(undefined, 'auth.*')).toBe(false)
      expect(client.is({}, 'auth.*')).toBe(false)
    })
  })
})

describe('client pattern matching: match()', () => {
  const client = createErrorClient<typeof errors>()

  describe('wildcard handlers', () => {
    it('calls wildcard handler when no exact match', () => {
      const err = client.deserialize(
        errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
      )

      const result = client.match(err, {
        'billing.payment_failed': () => 'billing',
        'auth.*': e => `auth:${e.code}`,
        'default': () => 'fallback',
      })

      expect(result).toBe('auth:auth.invalid_token')
    })

    it('narrows type in wildcard handler', () => {
      const err = client.deserialize(
        errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
      )

      client.match(err, {
        'auth.*': (e) => {
          expectTypeOf(e.code).toEqualTypeOf<'auth.invalid_token' | 'auth.user_not_found'>()
          return null
        },
        'default': () => null,
      })
    })
  })

  describe('priority: exact > wildcard > default', () => {
    it('prefers exact match over wildcard', () => {
      const err = client.deserialize(
        errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
      )

      const result = client.match(err, {
        'auth.invalid_token': () => 'exact',
        'auth.*': () => 'wildcard',
        'default': () => 'fallback',
      })

      expect(result).toBe('exact')
    })

    it('falls back to default when no pattern matches', () => {
      const err = client.deserialize(
        errors.serialize(errors.create('core.internal_error', undefined)),
      )

      const result = client.match(err, {
        'auth.*': () => 'auth',
        'billing.*': () => 'billing',
        'default': e => `default:${e.code}`,
      })

      expect(result).toBe('default:core.internal_error')
    })

    it('returns undefined when no handler matches and no default', () => {
      const err = client.deserialize(
        errors.serialize(errors.create('core.internal_error', undefined)),
      )

      const result = client.match(err, {
        'auth.*': () => 'auth',
        'billing.*': () => 'billing',
      })

      expect(result).toBeUndefined()
    })
  })

  describe('non-ClientAppError handling', () => {
    it('calls default handler for non-ClientAppError', () => {
      const result = client.match(new Error('boom'), {
        'auth.*': () => 'auth',
        'default': () => 'not-client-error',
      })

      expect(result).toBe('not-client-error')
    })

    it('returns undefined for non-ClientAppError without default', () => {
      const result = client.match(new Error('boom'), {
        'auth.*': () => 'auth',
      })

      expect(result).toBeUndefined()
    })
  })
})

describe('client hasTag()', () => {
  const client = createErrorClient<typeof errors>()

  it('returns true when error has tag', () => {
    const err = client.deserialize(
      errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
    )

    expect(client.hasTag(err, 'auth')).toBe(true)
  })

  it('returns false when error does not have tag', () => {
    const err = client.deserialize(
      errors.serialize(errors.create('auth.invalid_token', { reason: 'expired' })),
    )

    expect(client.hasTag(err, 'billing')).toBe(false)
  })

  it('returns false for non-ClientAppError', () => {
    expect(client.hasTag(new Error('boom'), 'auth')).toBe(false)
    expect(client.hasTag(null, 'auth')).toBe(false)
  })
})
