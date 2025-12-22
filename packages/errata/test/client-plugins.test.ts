import type { ErrataClientPlugin } from '../src'

import type { errors } from './fixtures'

import { describe, expect, it, vi } from 'vitest'
import { createErrorClient, defineClientPlugin, ErrataClientError } from '../src'

// ─── 5. onDeserialize Adaptation (The "RFC 7807" Case) ────────────────────────

describe('client plugin onDeserialize adaptation', () => {
  it('adapts non-standard payloads via plugin', () => {
    // RFC 7807 Problem Details format (different from errata format)
    const rfc7807Payload = {
      type: 'https://example.com/errors/payment-failed',
      title: 'Payment Failed',
      status: 402,
      detail: 'Your card was declined due to insufficient funds.',
    }

    const rfc7807Plugin: ErrataClientPlugin = {
      name: 'rfc7807',
      onDeserialize: (payload, _ctx) => {
        if (
          payload
          && typeof payload === 'object'
          && 'type' in payload
          && 'title' in payload
        ) {
          const p = payload as { type: string, title: string, status?: number, detail?: string }
          // Map RFC 7807 to ErrataClientError
          return new ErrataClientError({
            __brand: 'errata',
            code: 'billing.payment_failed', // Map type to code
            message: p.detail ?? p.title,
            status: p.status,
            tags: [],
            details: { rfc7807: p },
          })
        }
        return null
      },
    }

    const client = createErrorClient<typeof errors>({
      plugins: [rfc7807Plugin],
    })

    const err = client.deserialize(rfc7807Payload)

    expect(err).toBeInstanceOf(ErrataClientError)
    expect(err.code).toBe('billing.payment_failed')
    expect(err.message).toBe('Your card was declined due to insufficient funds.')
    expect(err.status).toBe(402)
    expect(err.details).toEqual({ rfc7807: rfc7807Payload })
  })

  it('falls back to standard deserialization when plugins return null', () => {
    const noopPlugin: ErrataClientPlugin = {
      name: 'noop',
      onDeserialize: () => null,
    }

    const client = createErrorClient<typeof errors>({
      plugins: [noopPlugin],
    })

    // Standard errata payload
    const standardPayload = {
      __brand: 'errata' as const,
      code: 'auth.invalid_token',
      message: 'Invalid token',
      status: 401,
      tags: [],
    }

    const err = client.deserialize(standardPayload)
    expect(err.code).toBe('auth.invalid_token')
  })

  it('returns errata.unknown_error for invalid payloads without plugins', () => {
    const client = createErrorClient<typeof errors>()

    const invalidPayload = { no_code_here: true }
    const err = client.deserialize(invalidPayload)

    expect(err.code).toBe('errata.unknown_error')
  })

  it('stops at first plugin that returns non-null', () => {
    const spyB = vi.fn(() => null)

    const pluginA: ErrataClientPlugin = {
      name: 'plugin-a',
      onDeserialize: (payload) => {
        if (payload && typeof payload === 'object' && 'custom' in payload) {
          return new ErrataClientError({
            __brand: 'errata',
            code: 'core.internal_error',
            message: 'Handled by A',
            tags: [],
          })
        }
        return null
      },
    }

    const pluginB: ErrataClientPlugin = {
      name: 'plugin-b',
      onDeserialize: spyB,
    }

    const client = createErrorClient<typeof errors>({
      plugins: [pluginA, pluginB],
    })

    const err = client.deserialize({ custom: true })

    expect(err.message).toBe('Handled by A')
    expect(spyB).not.toHaveBeenCalled()
  })

  it('handles errors in onDeserialize gracefully', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const crashingPlugin: ErrataClientPlugin = {
      name: 'crashing',
      onDeserialize: () => {
        throw new Error('Plugin exploded!')
      },
    }

    const client = createErrorClient<typeof errors>({
      plugins: [crashingPlugin],
    })

    // Should not throw, should fall back to standard behavior
    const err = client.deserialize({ code: 'auth.invalid_token', message: 'test' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('plugin "crashing" crashed in onDeserialize'),
      expect.any(Error),
    )
    expect(err.code).toBe('auth.invalid_token')

    errorSpy.mockRestore()
  })
})

// ─── 6. onCreate Client Logging ───────────────────────────────────────────────

describe('client plugin onCreate', () => {
  it('calls onCreate when deserialize succeeds', () => {
    const logSpy = vi.fn()

    const loggingPlugin: ErrataClientPlugin = {
      name: 'logging',
      onCreate: (error, _ctx) => {
        logSpy(error.code, error.message)
      },
    }

    const client = createErrorClient<typeof errors>({
      plugins: [loggingPlugin],
    })

    const payload = {
      __brand: 'errata' as const,
      code: 'auth.invalid_token',
      message: 'Token expired',
      tags: [],
    }

    client.deserialize(payload)

    expect(logSpy).toHaveBeenCalledWith('auth.invalid_token', 'Token expired')
  })

  it('calls onCreate for plugin-adapted errors', () => {
    const logSpy = vi.fn()

    const adapterPlugin: ErrataClientPlugin = {
      name: 'adapter',
      onDeserialize: (payload) => {
        if (payload && typeof payload === 'object' && 'custom' in payload) {
          return new ErrataClientError({
            __brand: 'errata',
            code: 'core.internal_error',
            message: 'Custom adapted',
            tags: [],
          })
        }
        return null
      },
    }

    const loggingPlugin: ErrataClientPlugin = {
      name: 'logging',
      onCreate: error => logSpy(error.code),
    }

    const client = createErrorClient<typeof errors>({
      plugins: [adapterPlugin, loggingPlugin],
    })

    client.deserialize({ custom: true })

    expect(logSpy).toHaveBeenCalledWith('core.internal_error')
  })

  it('calls all plugin onCreate hooks (not short-circuited)', () => {
    const spyA = vi.fn()
    const spyB = vi.fn()

    const pluginA: ErrataClientPlugin = {
      name: 'plugin-a',
      onCreate: () => spyA(),
    }

    const pluginB: ErrataClientPlugin = {
      name: 'plugin-b',
      onCreate: () => spyB(),
    }

    const client = createErrorClient<typeof errors>({
      plugins: [pluginA, pluginB],
    })

    client.deserialize({ code: 'test', message: 'test' })

    expect(spyA).toHaveBeenCalledTimes(1)
    expect(spyB).toHaveBeenCalledTimes(1)
  })

  it('swallows errors in onCreate without crashing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const safeSpy = vi.fn()

    const crashingPlugin: ErrataClientPlugin = {
      name: 'crashing',
      onCreate: () => {
        throw new Error('onCreate exploded!')
      },
    }

    const safePlugin: ErrataClientPlugin = {
      name: 'safe',
      onCreate: () => safeSpy(),
    }

    const client = createErrorClient<typeof errors>({
      plugins: [crashingPlugin, safePlugin],
    })

    // Should not throw
    const err = client.deserialize({ code: 'test', message: 'test' })

    expect(err.code).toBe('test')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('plugin "crashing" crashed in onCreate'),
      expect.any(Error),
    )
    // Safe plugin should still have been called
    expect(safeSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('provides ctx.config with app identifier', () => {
    let capturedApp: string | undefined

    const configPlugin: ErrataClientPlugin = {
      name: 'config-reader',
      onCreate: (_error, ctx) => {
        capturedApp = ctx.config.app
      },
    }

    const client = createErrorClient<typeof errors>({
      app: 'my-client-app',
      plugins: [configPlugin],
    })

    client.deserialize({ code: 'test', message: 'test' })

    expect(capturedApp).toBe('my-client-app')
  })
})

// ─── Plugin Validation ────────────────────────────────────────────────────────

describe('client plugin validation', () => {
  it('warns on duplicate plugin names', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    createErrorClient<typeof errors>({
      plugins: [
        { name: 'duplicate' },
        { name: 'duplicate' },
      ],
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate plugin name "duplicate"'),
    )

    warnSpy.mockRestore()
  })

  it('defineClientPlugin provides type inference for plugin authors', () => {
    // defineClientPlugin provides autocomplete for hooks and ctx
    const myPlugin = defineClientPlugin({
      name: 'my-client-plugin',
      onDeserialize: (payload, ctx) => {
        // ctx.config should be accessible
        if (ctx.config.app === 'test') {
          return null
        }
        return null
      },
      onCreate: (_error, ctx) => {
        expect(ctx.config).toBeDefined()
      },
    })

    const client = createErrorClient<typeof errors>({
      app: 'test-app',
      plugins: [myPlugin],
    })

    const err = client.deserialize({ code: 'test', message: 'test' })
    expect(err.code).toBe('test')
  })
})
