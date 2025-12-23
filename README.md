# Errata

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

> **Errors are data. Define them like it.**

A typed error registry for TypeScript. Works anywhere—servers, CLIs, libraries, full-stack apps.

## Why Errata?

We spend time defining database schemas and validating inputs. But errors? We usually just wing it.

```ts
throw new Error('User not found') // ← What is this? Who handles it? Who knows.
```

## Features

- Central **codes registry** with typed `props`
- Fully typed helpers with autocomplete: `errors.create()`, `errors.is()`, `errors.match()`, `errors.hasTag()`
- Built-in **serialize/deserialize** across boundaries
- Optional **scoped zones** for complex services
- **Plugins** — extend with pre-defined error sets from shared packages
- Zero runtime dependencies

## Install

```bash
npm install errata
```

## Quick Start

```ts
import { code, errata, props } from 'errata'

const errors = errata({
  codes: {
    'app.internal_error': {
      status: 500,
      message: 'Internal error',
    },
    'user.not_found': code({
      status: 404,
      message: ({ details }) => `User ${details.userId} not found`,
      details: props<{ userId: string }>(),
      tags: ['auth', 'user'] as const,
    }),
    'auth.unauthorized': code({
      status: 401,
      message: 'Not authenticated',
      expose: true,
      tags: ['auth', 'security'] as const,
    }),
  }
})

// Create and throw
throw errors.create('user.not_found', { userId: '123' })

// Check
if (errors.is(e, 'auth.unauthorized')) { ... }

// Match
errors.match(e, {
  'user.not_found': () => show404(),
  'auth.unauthorized': () => redirect('/login'),
})

// Check tags
if (errors.hasTag(e, 'security')) { ... }

// Other helpers
errors.ensure(e, 'user.not_found') // throws if not this error
const [data, err] = await errors.safe(() => fetchUser(id)) // typed [result, error] tuple
const json = errors.serialize(e) // for sending across boundaries
const err = errors.deserialize(json) // restore on other side
```

## Plugins

Extend your registry with pre-defined error sets from shared packages:

```ts
import { myBackendErrors } from '@my-org/api-errors'
import { errata } from 'errata'

const errors = errata({
  codes: {
    'app.unknown': { status: 500, message: 'Something went wrong' }
  },
  plugins: [myBackendErrors()]
})

// Now you can handle backend errors with full type safety
errors.match(e, {
  'payment.declined': () => showCardError(),
  'rate_limit': () => retry(),
})
```

## License

[MIT](./LICENSE) License © [Franco P. Romano L.](https://github.com/fprl)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/errata?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/errata
[npm-downloads-src]: https://img.shields.io/npm/dm/errata?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/errata
[bundle-src]: https://img.shields.io/bundlephobia/minzip/errata?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=errata
[license-src]: https://img.shields.io/github/license/fprl/errata.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/fprl/errata/blob/main/LICENSE.md
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/errata
