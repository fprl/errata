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
- Helpers: `errors.throw`, `errors.is`, `errors.match`, `errors.hasTag`
- Built-in **serialize/deserialize** across boundaries
- Optional **scoped zones** for complex services
- **Plugins** — import error definitions from Stripe, Prisma, your own packages, etc.
- Zero runtime dependencies

## Install

```bash
npm install errata
```

## Quick Start

```ts
import { errata } from 'errata'

const errors = errata({
  codes: {
    'user.not_found': { status: 404, message: 'User not found' },
    'auth.unauthorized': { status: 401, message: 'Not authenticated' },
  }
})

// Throw
errors.throw('user.not_found')

// Check
if (errors.is(e, 'auth.unauthorized')) { ... }

// Match
errors.match(e, {
  'user.not_found': () => show404(),
  'auth.unauthorized': () => redirect('/login'),
})
```

## Plugins

Extend your registry with pre-defined error sets:

```ts
import { myBackendErrors } from '@my-org/api-errors'
import { errata } from 'errata'
import { stripeErrors } from 'errata-stripe'

const errors = errata({
  codes: {
    'app.unknown': { status: 500, message: 'Something went wrong' }
  },
  plugins: [stripeErrors(), myBackendErrors()]
})

// Now you can handle Stripe errors with full type safety
errors.match(e, {
  'stripe.card_declined': () => showCardError(),
  'stripe.rate_limit': () => retry(),
})
```

## Note for Developers

This starter recommends using [npm Trusted Publisher](https://github.com/e18e/ecosystem-issues/issues/201), where the release is done on CI to ensure the security of the packages.

To do so, you need to run `pnpm publish` manually for the very first time to create the package on npm, and then go to `https://www.npmjs.com/package/<your-package-name>/access` to set the connection to your GitHub repo.

Then for future releases, you can run `pnpm run release` and the GitHub Actions will take care of the release process.

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
[license-href]: https://github.com/fprl/errata/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/errata
