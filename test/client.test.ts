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
