import { rehypeHeadingIds } from '@astrojs/markdown-remark'
import starlight from '@astrojs/starlight'
import { transformerTwoslash } from '@shikijs/twoslash'
import tailwindcss from '@tailwindcss/vite'
// @ts-check
import { defineConfig } from 'astro/config'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'

// https://astro.build/config
export default defineConfig({
  // https://discord.com/channels/830184174198718474/1070481941863878697/1244029364060815461
  // https://github.com/withastro/astro/issues/10382
  // https://twoslash.netlify.app/refs/notations
  markdown: {
    rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: 'wrap' }]],
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      transformers: [transformerTwoslash({ rendererRich: true, explicitTrigger: true })],
    },
  },
  integrations: [
    starlight({
      // https://github.com/sst/opencode/blob/dev/packages/web/astro.config.mjs
      title: 'Errata',
      lastUpdated: true,
      expressiveCode: false,
      // https://starlight.astro.build/reference/configuration/#expressivecode
      customCss: ['./src/styles/global.css', '@shikijs/twoslash/style-rich.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/fprl/errata' }],
      editLink: {
        baseUrl: 'https://github.com/fprl/errata/edit/main/docs/',
      },
      markdown: {
        headingLinks: false,
      },
      pagination: false,
      sidebar: [
        'introduction',
        'installation',
        'basic-usage',
        'boundaries',
        'plugins',
        'reference',
        // {
        //   label: 'Docs',
        //   autogenerate: { directory: 'docs' },
        // },
        // {
        //   label: 'Guides',
        //   items: [
        //     { label: 'Quickstart', slug: 'guides/quickstart' },
        //   ],
        // },
        // {
        //   label: 'Reference',
        //   autogenerate: { directory: 'reference' },
        // },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
})
