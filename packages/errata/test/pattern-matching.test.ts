import { describe, expect, expectTypeOf, it } from 'vitest'

import { code, defineCodes, errata, props } from '../src'

/**
 * Extended codes for pattern matching tests.
 * Uses one-level nesting which the type system supports.
 */
const codes = defineCodes({
  'core.internal_error': {
    status: 500,
    message: 'Internal error',
    tags: ['core'],
  },
  'core.not_found': {
    status: 404,
    message: 'Not found',
    tags: ['core'],
  },
  'auth': {
    invalid_token: code({
      status: 401,
      message: 'Invalid token',
      tags: ['auth'],
      details: props<{ reason: 'expired' | 'revoked' }>(),
    }),
    missing_credentials: code({
      status: 401,
      message: 'Missing credentials',
      tags: ['auth'],
      details: props<{ field: string }>(),
    }),
    login_failed: code({
      status: 401,
      message: 'Login failed',
      tags: ['auth', 'login'],
      details: props<{ attempts: number }>(),
    }),
    rate_limited: code({
      status: 429,
      message: 'Rate limited',
      tags: ['auth'],
      details: props<{ retryAfter: number }>(),
    }),
  },
  'billing': {
    payment_failed: code({
      status: 402,
      message: ({ details }) => `Payment failed for ${details.provider}`,
      tags: ['billing'],
      details: props<{ provider: 'stripe' | 'adyen', amount: number }>(),
    }),
    subscription_expired: code({
      status: 402,
      message: 'Subscription expired',
      tags: ['billing'],
      details: props<{ planId: string }>(),
    }),
  },
} as const)

const errors = errata({
  app: 'test-app',
  codes,
})

describe('pattern Matching: is() method', () => {
  describe('exact code matching', () => {
    it('matches exact code', () => {
      const err = errors.create('auth.invalid_token', { reason: 'expired' })

      expect(errors.is(err, 'auth.invalid_token')).toBe(true)
      expect(errors.is(err, 'auth.missing_credentials')).toBe(false)
      expect(errors.is(err, 'billing.payment_failed')).toBe(false)
    })

    it('narrows type for exact code', () => {
      const err = errors.create('auth.invalid_token', { reason: 'expired' })

      if (errors.is(err, 'auth.invalid_token')) {
        // Type should be narrowed to auth.invalid_token
        expectTypeOf(err.code).toEqualTypeOf<'auth.invalid_token'>()
        // Details type is narrowed correctly
        expect(err.details.reason).toBe('expired')
      }
    })
  })

  describe('wildcard pattern matching', () => {
    it('matches codes starting with prefix using auth.*', () => {
      const tokenErr = errors.create('auth.invalid_token', { reason: 'expired' })
      const credsErr = errors.create('auth.missing_credentials', { field: 'password' })
      const loginErr = errors.create('auth.login_failed', { attempts: 3 })
      const billingErr = errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 })

      // All auth codes should match 'auth.*'
      expect(errors.is(tokenErr, 'auth.*')).toBe(true)
      expect(errors.is(credsErr, 'auth.*')).toBe(true)
      expect(errors.is(loginErr, 'auth.*')).toBe(true)

      // Billing codes should not match 'auth.*'
      expect(errors.is(billingErr, 'auth.*')).toBe(false)
    })

    it('does not match when wildcard prefix does not match', () => {
      const tokenErr = errors.create('auth.invalid_token', { reason: 'expired' })
      const billingErr = errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 })

      // billing.* should not match auth codes
      expect(errors.is(tokenErr, 'billing.*')).toBe(false)
      // core.* should not match billing codes
      expect(errors.is(billingErr, 'core.*')).toBe(false)
    })

    it('narrows type for wildcard pattern', () => {
      const err: unknown = errors.create('auth.invalid_token', { reason: 'expired' })

      if (errors.is(err, 'auth.*')) {
        // Type should be narrowed to union of all auth codes
        expectTypeOf(err.code).toEqualTypeOf<
          | 'auth.invalid_token'
          | 'auth.missing_credentials'
          | 'auth.login_failed'
          | 'auth.rate_limited'
        >()
      }
    })

    it('narrows type for core.* wildcard pattern', () => {
      const err: unknown = errors.create('core.internal_error', undefined)

      if (errors.is(err, 'core.*')) {
        // Type should be narrowed to only core codes
        expectTypeOf(err.code).toEqualTypeOf<'core.internal_error' | 'core.not_found'>()
      }
    })
  })

  describe('array pattern matching', () => {
    it('matches any pattern in array', () => {
      const tokenErr = errors.create('auth.invalid_token', { reason: 'expired' })
      const billingErr = errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 })
      const coreErr = errors.create('core.internal_error', undefined)

      // Mix of exact and wildcard patterns
      expect(errors.is(tokenErr, ['auth.invalid_token', 'billing.*'])).toBe(true)
      expect(errors.is(billingErr, ['auth.invalid_token', 'billing.*'])).toBe(true)
      expect(errors.is(coreErr, ['auth.invalid_token', 'billing.*'])).toBe(false)
    })

    it('matches array of wildcards', () => {
      const authErr = errors.create('auth.invalid_token', { reason: 'expired' })
      const billingErr = errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 })

      expect(errors.is(authErr, ['auth.*', 'billing.*'])).toBe(true)
      expect(errors.is(billingErr, ['auth.*', 'billing.*'])).toBe(true)
    })

    it('narrows type for array of patterns', () => {
      const err: unknown = errors.create('auth.invalid_token', { reason: 'expired' })

      if (errors.is(err, ['auth.*', 'billing.payment_failed'])) {
        // Type should be union of all matching codes
        expectTypeOf(err.code).toEqualTypeOf<
          | 'auth.invalid_token'
          | 'auth.missing_credentials'
          | 'auth.login_failed'
          | 'auth.rate_limited'
          | 'billing.payment_failed'
        >()
      }
    })
  })

  describe('edge cases', () => {
    it('returns false for non-ErrataError values', () => {
      expect(errors.is(new Error('boom'), 'auth.*')).toBe(false)
      expect(errors.is(null, 'auth.*')).toBe(false)
      expect(errors.is(undefined, 'auth.*')).toBe(false)
      expect(errors.is('string', 'auth.*')).toBe(false)
      expect(errors.is({}, 'auth.*')).toBe(false)
    })

    it('handles empty array pattern', () => {
      const err = errors.create('auth.invalid_token', { reason: 'expired' })
      expect(errors.is(err, [])).toBe(false)
    })
  })
})

describe('pattern Matching: match() method', () => {
  describe('exact code handlers', () => {
    it('calls exact match handler', () => {
      const err = errors.create('auth.invalid_token', { reason: 'expired' })

      const result = errors.match(err, {
        'auth.invalid_token': e => `token:${(e.details as { reason: string }).reason}`,
        'default': () => 'fallback',
      })

      expect(result).toBe('token:expired')
    })

    it('narrows type in exact match handler', () => {
      const err = errors.create('auth.invalid_token', { reason: 'expired' })

      errors.match(err, {
        'auth.invalid_token': (e) => {
          // Type should be narrowed to exact code
          expectTypeOf(e.code).toEqualTypeOf<'auth.invalid_token'>()
          // Details are typed, access with type guard
          expect((e.details as { reason: string }).reason).toBe('expired')
          return null
        },
        'default': () => null,
      })
    })
  })

  describe('wildcard handlers', () => {
    it('calls wildcard handler when no exact match', () => {
      const err = errors.create('auth.missing_credentials', { field: 'password' })

      const result = errors.match(err, {
        'auth.invalid_token': () => 'token',
        'auth.*': e => `auth:${e.code}`,
        'default': () => 'fallback',
      })

      expect(result).toBe('auth:auth.missing_credentials')
    })

    it('narrows type in wildcard handler', () => {
      const err = errors.create('auth.login_failed', { attempts: 3 })

      errors.match(err, {
        'auth.*': (e) => {
          // Type should be union of all auth codes
          expectTypeOf(e.code).toEqualTypeOf<
            | 'auth.invalid_token'
            | 'auth.missing_credentials'
            | 'auth.login_failed'
            | 'auth.rate_limited'
          >()
          return null
        },
        'default': () => null,
      })
    })
  })

  describe('priority: exact > longest wildcard > default', () => {
    it('prefers exact match over wildcard', () => {
      const err = errors.create('auth.invalid_token', { reason: 'expired' })

      const result = errors.match(err, {
        'auth.invalid_token': () => 'exact',
        'auth.*': () => 'wildcard',
        'default': () => 'fallback',
      })

      expect(result).toBe('exact')
    })

    it('uses wildcard when no exact match exists', () => {
      const err = errors.create('auth.login_failed', { attempts: 3 })

      const result = errors.match(err, {
        'auth.invalid_token': () => 'token',
        'auth.*': () => 'generic-auth',
        'default': () => 'fallback',
      })

      expect(result).toBe('generic-auth')
    })

    it('falls back to default when no pattern matches', () => {
      const err = errors.create('core.internal_error', undefined)

      const result = errors.match(err, {
        'auth.*': () => 'auth',
        'billing.*': () => 'billing',
        'default': e => `default:${e.code}`,
      })

      expect(result).toBe('default:core.internal_error')
    })

    it('returns undefined when no handler matches and no default', () => {
      const err = errors.create('core.internal_error', undefined)

      const result = errors.match(err, {
        'auth.*': () => 'auth',
        'billing.*': () => 'billing',
      })

      expect(result).toBeUndefined()
    })
  })

  describe('normalizes unknown errors', () => {
    it('wraps non-ErrataError and routes to default', () => {
      const unknownErr = new Error('boom')

      const result = errors.match(unknownErr, {
        'auth.*': () => 'auth',
        'default': e => `wrapped:${e.code}`,
      })

      // Unknown errors get wrapped with the first available code
      expect(result).toBe('wrapped:core.internal_error')
    })
  })

  describe('complex scenarios', () => {
    it('handles multiple domains with wildcards correctly', () => {
      const results: string[] = []

      // Test with different error types
      const authToken = errors.create('auth.invalid_token', { reason: 'expired' })
      const authLogin = errors.create('auth.login_failed', { attempts: 3 })
      const billing = errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 })

      const handler = (err: unknown) =>
        errors.match(err, {
          'auth.invalid_token': () => 'exact-token',
          'auth.*': () => 'auth-wildcard',
          'billing.*': () => 'billing-wildcard',
          'default': () => 'default',
        })

      results.push(handler(authToken)!)
      results.push(handler(authLogin)!)
      results.push(handler(billing)!)

      expect(results).toEqual([
        'exact-token', // exact match wins
        'auth-wildcard', // wildcard match
        'billing-wildcard', // wildcard match
      ])
    })

    it('works without default handler', () => {
      const err = errors.create('auth.invalid_token', { reason: 'expired' })

      const result = errors.match(err, {
        'auth.invalid_token': () => 'matched',
      })

      expect(result).toBe('matched')
    })
  })
})

describe('pattern Matching: Type Inference', () => {
  it('matchingCodes extracts correct codes for exact pattern', () => {
    // This is a compile-time check - if it compiles, the types are correct
    const err = errors.create('auth.invalid_token', { reason: 'expired' })

    if (errors.is(err, 'auth.invalid_token')) {
      // Should compile: accessing known property
      const _reason = err.details.reason
      expect(_reason).toBe('expired')
    }
  })

  it('matchingCodes extracts correct codes for wildcard pattern', () => {
    const err: unknown = errors.create('auth.login_failed', { attempts: 3 })

    if (errors.is(err, 'auth.*')) {
      if (err.code === 'auth.login_failed') {
        const attempts: number = err.details.attempts
        expect(attempts).toBe(3)
      }
    }
  })

  it('handles discriminated union narrowing after is()', () => {
    function handleError(err: unknown): string {
      if (errors.is(err, 'auth.invalid_token')) {
        // TypeScript knows err.details has 'reason'
        return `Token error: ${err.details.reason}`
      }

      if (errors.is(err, 'auth.*')) {
        // TypeScript knows err.code is one of the auth codes
        if (err.code === 'auth.login_failed') {
          // Further narrowing works
          return `Login failed: ${err.details.attempts} attempts`
        }
        return `Auth issue: ${err.code}`
      }

      if (errors.is(err, 'billing.*')) {
        return `Billing error: ${err.code}`
      }

      return 'Unknown error'
    }

    expect(handleError(errors.create('auth.invalid_token', { reason: 'expired' }))).toBe(
      'Token error: expired',
    )
    expect(handleError(errors.create('auth.login_failed', { attempts: 5 }))).toBe(
      'Login failed: 5 attempts',
    )
    expect(handleError(errors.create('billing.payment_failed', { provider: 'stripe', amount: 100 }))).toBe(
      'Billing error: billing.payment_failed',
    )
  })
})
