import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('package.json exports', () => {
  it('includes types for "." and "./client" subpaths', async () => {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const pkg = JSON.parse(raw) as {
      exports?: Record<string, any>
    }

    expect(pkg.exports?.['.']).toMatchObject({
      types: './dist/index.d.mts',
      default: './dist/index.mjs',
    })
    expect(pkg.exports?.['./client']).toMatchObject({
      types: './dist/client.d.mts',
      default: './dist/client.mjs',
    })
  })
})
