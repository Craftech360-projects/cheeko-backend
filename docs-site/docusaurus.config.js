// @ts-check
const { themes: prismThemes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Cheeko Docs',
  tagline: 'AI Companion for Children — Backend & Firmware Reference',
  favicon: 'img/favicon.ico',

  url: 'https://docs.cheeko.ai',
  baseUrl: '/',

  organizationName: 'Craftech360-projects',
  projectName: 'cheeko-backend',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'Cheeko Docs',
        items: [
          { type: 'docSidebar', sidebarId: 'mainSidebar', position: 'left', label: 'Docs' },
          { href: 'https://github.com/Craftech360-projects/cheeko-backend', label: 'Backend Repo', position: 'right' },
          { href: 'https://github.com/Craftech360-projects/CheekoAI-Parent-App', label: 'Parent App Repo', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        copyright: `Copyright © ${new Date().getFullYear()} Cheeko. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'python', 'java', 'cpp'],
      },
    }),
};

module.exports = config;
