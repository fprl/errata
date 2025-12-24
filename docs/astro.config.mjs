import starlight from '@astrojs/starlight'
import { transformerTwoslash } from '@shikijs/twoslash'
import tailwindcss from '@tailwindcss/vite'
// @ts-check
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'Docs with Tailwind',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/withastro/starlight' }],
      sidebar: [
        {
          label: 'Guides',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Example Guide', slug: 'guides/example' },
          ],
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
      expressiveCode: false,
      customCss: ['./src/styles/global.css', '@shikijs/twoslash/style-rich.css'],
    }),
  ],
  // https://discord.com/channels/830184174198718474/1070481941863878697/1244029364060815461
  // https://github.com/withastro/astro/issues/10382
  // https://twoslash.netlify.app/refs/notations
  markdown: {
    shikiConfig: {
      theme: 'material-theme-lighter',
      transformers: [transformerTwoslash({ rendererRich: true })],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
