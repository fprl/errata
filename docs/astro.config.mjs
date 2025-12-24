import starlight from '@astrojs/starlight'
import { transformerTwoslash } from '@shikijs/twoslash'
import tailwindcss from '@tailwindcss/vite'
// @ts-check
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'Errata',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/fprl/errata' }],
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Quickstart', slug: 'guides/quickstart' },
          ],
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
      // https://starlight.astro.build/reference/configuration/#expressivecode
      expressiveCode: false,
      customCss: ['./src/styles/global.css', '@shikijs/twoslash/style-rich.css'],
    }),
  ],
  // https://discord.com/channels/830184174198718474/1070481941863878697/1244029364060815461
  // https://github.com/withastro/astro/issues/10382
  // https://twoslash.netlify.app/refs/notations
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      transformers: [transformerTwoslash({ rendererRich: true, explicitTrigger: true })],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
