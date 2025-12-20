import type { ErrataPlugin } from '../src'

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { code, defineCodes, definePlugin, errata, ErrataError, props } from '../src'

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const baseCodes = defineCodes({
  core: {
    internal_error: {
      status: 500,
      message: 'Internal error',
      expose: false,
    },
  },
  billing: {
    declined: code({
      status: 402,
      message: ({ details }) => `Card declined: ${details.reason}`,
      details: props<{ reason: string, provider?: string }>(),
      expose: true,
    }),
  },
})

// ─── 1. Code Injection & Inference ────────────────────────────────────────────

describe('plugin code injection', () => {
  const pluginCodes = defineCodes({
    plugin: {
      test_error: {
        status: 418,
        message: 'I am a teapot',
        expose: true,
      },
    },
  })

  const testPlugin: ErrataPlugin<typeof pluginCodes> = {
    name: 'test-plugin',
    codes: pluginCodes,
  }

  const errors = errata({
    codes: baseCodes,
    plugins: [testPlugin] as const,
  })

  it('can create errors with plugin-injected codes', () => {
    const err = errors.create('plugin.test_error')

    expect(err).toBeInstanceOf(ErrataError)
    expect(err.code).toBe('plugin.test_error')
    expect(err.message).toBe('I am a teapot')
    expect(err.status).toBe(418)
  })

  it('still works with base codes', () => {
    const err = errors.create('core.internal_error')
    expect(err.code).toBe('core.internal_error')
  })

  it('infers plugin codes in the type union (compile-time check)', () => {
    const err = errors.create('plugin.test_error')
    // Type assertion: if this compiles, the type inference is working
    expectTypeOf(err.code).toEqualTypeOf<'plugin.test_error'>()
  })

  it('warns on duplicate plugin names', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    errata({
      codes: baseCodes,
      plugins: [
        { name: 'duplicate', codes: {} },
        { name: 'duplicate', codes: {} },
      ] as const,
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate plugin name "duplicate"'),
    )
    warnSpy.mockRestore()
  })

  it('warns on code collision between plugins and base codes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const conflictingPlugin: ErrataPlugin<typeof baseCodes> = {
      name: 'conflicting',
      codes: baseCodes, // Reusing the same codes
    }

    errata({
      codes: baseCodes,
      plugins: [conflictingPlugin] as const,
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    )
    warnSpy.mockRestore()
  })

  it('definePlugin provides type inference for plugin authors', () => {
    const myPluginCodes = defineCodes({
      myplugin: {
        custom_error: {
          status: 500,
          message: 'Custom error from plugin',
        },
      },
    })

    // definePlugin provides autocomplete for hooks and ctx
    const myPlugin = definePlugin({
      name: 'my-plugin',
      codes: myPluginCodes,
      onEnsure: (_error, ctx) => {
        // ctx.create should be available with autocomplete
        if (_error instanceof Error && _error.message === 'trigger') {
          return ctx.create('myplugin.custom_error')
        }
        return null
      },
      onCreate: (_error, ctx) => {
        // ctx.config should be accessible
        expect(ctx.config).toBeDefined()
      },
    })

    const errors = errata({
      codes: baseCodes,
      plugins: [myPlugin] as const,
    })

    // Plugin codes should be available
    const err = errors.create('myplugin.custom_error')
    expect(err.code).toBe('myplugin.custom_error')
  })
})

// ─── 2. onEnsure Mapping (The "Stripe" Case) ──────────────────────────────────

describe('plugin onEnsure mapping', () => {
  // Mock third-party error
  class StripeError extends Error {
    code = 'card_declined'
    decline_code = 'insufficient_funds'
    constructor() {
      super('Your card was declined.')
    }
  }

  const stripePlugin: ErrataPlugin = {
    name: 'stripe',
    onEnsure: (error, _ctx) => {
      if (error instanceof StripeError) {
        return {
          code: 'billing.declined',
          details: {
            reason: error.decline_code,
            provider: 'stripe',
          },
        }
      }
      return null
    },
  }

  const errors = errata({
    codes: baseCodes,
    plugins: [stripePlugin] as const,
  })

  it('maps third-party errors to ErrataError via onEnsure', () => {
    const stripeErr = new StripeError()
    const ensured = errors.ensure(stripeErr)

    expect(ensured).toBeInstanceOf(ErrataError)
    expect(ensured.code).toBe('billing.declined')
    expect(ensured.details).toEqual({
      reason: 'insufficient_funds',
      provider: 'stripe',
    })
  })

  it('can return ErrataError directly from onEnsure', () => {
    const directPlugin: ErrataPlugin = {
      name: 'direct',
      onEnsure: (error, ctx) => {
        if (error instanceof StripeError) {
          return ctx.create('billing.declined', {
            reason: error.decline_code,
            provider: 'stripe',
          })
        }
        return null
      },
    }

    const errorsWithDirect = errata({
      codes: baseCodes,
      plugins: [directPlugin] as const,
    })

    const ensured = errorsWithDirect.ensure(new StripeError())
    expect(ensured.code).toBe('billing.declined')
  })

  it('falls back to standard handling when plugins return null', () => {
    const noopPlugin: ErrataPlugin = {
      name: 'noop',
      onEnsure: () => null,
    }

    const errorsWithNoop = errata({
      codes: baseCodes,
      plugins: [noopPlugin] as const,
    })

    const regularError = new Error('Regular error')
    const ensured = errorsWithNoop.ensure(regularError, 'core.internal_error')

    expect(ensured.code).toBe('core.internal_error')
    expect(ensured.details).toEqual({ cause: regularError })
  })
})

// ─── 3. onEnsure Priority/Chain ───────────────────────────────────────────────

describe('plugin onEnsure priority chain', () => {
  class CustomError extends Error {
    type = 'custom'
  }

  it('stops at first plugin that returns non-null', () => {
    const pluginA: ErrataPlugin = {
      name: 'plugin-a',
      onEnsure: () => null, // Passes through
    }

    const pluginB: ErrataPlugin = {
      name: 'plugin-b',
      onEnsure: (error, _ctx) => {
        if (error instanceof CustomError) {
          return { code: 'core.internal_error', details: { source: 'plugin-b' } }
        }
        return null
      },
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [pluginA, pluginB] as const,
    })

    const ensured = errors.ensure(new CustomError())
    expect(ensured.details).toEqual({ source: 'plugin-b' })
  })

  it('short-circuits when first plugin handles error', () => {
    const onEnsureB = vi.fn(() => null)

    const pluginA: ErrataPlugin = {
      name: 'plugin-a',
      onEnsure: (error) => {
        if (error instanceof CustomError) {
          return { code: 'core.internal_error', details: { source: 'plugin-a' } }
        }
        return null
      },
    }

    const pluginB: ErrataPlugin = {
      name: 'plugin-b',
      onEnsure: onEnsureB,
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [pluginA, pluginB] as const,
    })

    const ensured = errors.ensure(new CustomError())

    expect(ensured.details).toEqual({ source: 'plugin-a' })
    expect(onEnsureB).not.toHaveBeenCalled()
  })

  it('handles errors thrown in onEnsure gracefully', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const crashingPlugin: ErrataPlugin = {
      name: 'crashing',
      onEnsure: () => {
        throw new Error('Plugin crashed!')
      },
    }

    const fallbackPlugin: ErrataPlugin = {
      name: 'fallback',
      onEnsure: () => ({ code: 'core.internal_error', details: { fallback: true } }),
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [crashingPlugin, fallbackPlugin] as const,
    })

    const ensured = errors.ensure(new Error('test'))

    // Should have logged the crash
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('plugin "crashing" crashed in onEnsure'),
      expect.any(Error),
    )

    // Should have fallen through to the next plugin
    expect(ensured.details).toEqual({ fallback: true })

    errorSpy.mockRestore()
  })
})

// ─── 4. onCreate Side Effects (The "Sentry" Case) ─────────────────────────────

describe('plugin onCreate side effects', () => {
  it('calls onCreate hook when creating errors', () => {
    const logSpy = vi.fn()

    const loggingPlugin: ErrataPlugin = {
      name: 'logging',
      onCreate: (error, _ctx) => {
        logSpy(error.code, error.details)
      },
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [loggingPlugin] as const,
    })

    errors.create('billing.declined', { reason: 'test' })

    expect(logSpy).toHaveBeenCalledWith('billing.declined', { reason: 'test' })
  })

  it('calls onCreate hook when throwing errors', () => {
    const logSpy = vi.fn()

    const loggingPlugin: ErrataPlugin = {
      name: 'logging',
      onCreate: (error) => {
        logSpy(error.code)
      },
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [loggingPlugin] as const,
    })

    expect(() => errors.throw('billing.declined', { reason: 'test' })).toThrow(ErrataError)
    expect(logSpy).toHaveBeenCalledWith('billing.declined')
  })

  it('calls all plugin onCreate hooks (not short-circuited)', () => {
    const spyA = vi.fn()
    const spyB = vi.fn()

    const pluginA: ErrataPlugin = {
      name: 'plugin-a',
      onCreate: () => spyA(),
    }

    const pluginB: ErrataPlugin = {
      name: 'plugin-b',
      onCreate: () => spyB(),
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [pluginA, pluginB] as const,
    })

    errors.create('core.internal_error')

    expect(spyA).toHaveBeenCalledTimes(1)
    expect(spyB).toHaveBeenCalledTimes(1)
  })

  it('swallows errors thrown in onCreate without crashing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const safeSpy = vi.fn()

    const crashingPlugin: ErrataPlugin = {
      name: 'crashing',
      onCreate: () => {
        throw new Error('Logging crashed!')
      },
    }

    const safePlugin: ErrataPlugin = {
      name: 'safe',
      onCreate: () => safeSpy(),
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [crashingPlugin, safePlugin] as const,
    })

    // Should not throw
    const err = errors.create('core.internal_error')

    expect(err.code).toBe('core.internal_error')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('plugin "crashing" crashed in onCreate'),
      expect.any(Error),
    )
    // Safe plugin should still have been called
    expect(safeSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('provides ctx.create in onCreate for advanced use cases', () => {
    const createdCodes: string[] = []

    const inspectorPlugin: ErrataPlugin = {
      name: 'inspector',
      onCreate: (error, ctx) => {
        // Access config
        expect(ctx.config.app).toBe('test-app')
        createdCodes.push(error.code)
      },
    }

    const errors = errata({
      app: 'test-app',
      codes: baseCodes,
      plugins: [inspectorPlugin] as const,
    })

    errors.create('core.internal_error')
    errors.create('billing.declined', { reason: 'test' })

    expect(createdCodes).toEqual(['core.internal_error', 'billing.declined'])
  })

  it('provides ctx.ensure in plugin hooks', () => {
    let ensuredFromPlugin: ErrataError | null = null

    const wrapperPlugin: ErrataPlugin = {
      name: 'wrapper',
      onEnsure: (error, ctx) => {
        // Use ctx.ensure to re-normalize (careful with infinite loops in real code!)
        if (error instanceof Error && error.message === 'wrap-me') {
          ensuredFromPlugin = ctx.create('core.internal_error', { wrapped: true } as any)
          return ensuredFromPlugin
        }
        return null
      },
    }

    const errors = errata({
      codes: baseCodes,
      plugins: [wrapperPlugin] as const,
    })

    const result = errors.ensure(new Error('wrap-me'))
    expect(result).toBe(ensuredFromPlugin)
    expect(result.details).toEqual({ wrapped: true })
  })
})
