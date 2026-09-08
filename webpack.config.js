'use strict';

const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const LocaleSitePlugin = require('./src/build/locale-site-plugin');

module.exports = (env, argv) => {
  const isProd = (argv && argv.mode === 'production') || process.env.NODE_ENV === 'production';

  return {
    mode: isProd ? 'production' : 'development',

    // -- Entry: page interaction script (will be minified + inlined) ---
    entry: './src/scripts/main.js',

    output: {
      filename: '__bundle.js',
      path: path.resolve(__dirname, 'dist'),
      clean: true
    },

    optimization: {
      minimize: isProd,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: { drop_console: isProd },
            format: { comments: false },
          },
          extractComments: false,
        }),
      ],
    },

    // -- Locale-aware static site generator ----
    plugins: [
      new LocaleSitePlugin({
        template: path.resolve(__dirname, 'src/templates/page.html'),
        pageTemplates: {
          index: path.resolve(__dirname, 'src/templates/page.html'),
          privacy: path.resolve(__dirname, 'src/templates/privacy.html'),
          terms: path.resolve(__dirname, 'src/templates/terms.html'),
          security: path.resolve(__dirname, 'src/templates/security.html'),
          license: path.resolve(__dirname, 'src/templates/license.html'),
        },
        localesDir: path.resolve(__dirname, 'src/data/locales'),
        style: path.resolve(__dirname, 'src/styles/main.css'),
        imagesDir: path.resolve(__dirname, 'src/images'),
        bundleKey: '__bundle.js',
        siteUrl: 'https://inneroutliner.com',
        defaultLocale: 'en',
      }),
    ],

    // Silence "asset size" warnings - everything is intentionally inlined
    performance: { hints: false },
    stats: 'minimal',
  };
};
