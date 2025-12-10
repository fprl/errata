import { describe, expect, expectTypeOf, it } from 'vitest'

import { errors } from './fixtures'

describe('betterErrors.safe', () => {
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

  it('normalizes rejected promises into AppError tuple', async () => {
    const failingPromise: Promise<number> = Promise.reject(new Error('db down'))
    const [value, err] = await errors.safe(failingPromise)

    expect(value).toBeNull()
    expect(err).toBeInstanceOf(errors.AppError)
    expect(err?.code).toBe('core.internal_error')

    if (err) {
      expectTypeOf(err).toExtend<InstanceType<typeof errors.AppError>>()
      expectTypeOf(value).toEqualTypeOf<null>()
    }
    else {
      expectTypeOf(value).toEqualTypeOf<number>()
    }
  })
})
