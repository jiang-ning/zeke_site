'use strict';

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const CleanCSS = require('clean-css');
const { OutgoingMessage } = require('http');

const _cssMinifier = new CleanCSS({ level: 2 });


function minifyCSS(css) {
  const result = _cssMinifier.minify(css);
  if (result.errors && result.errors.length) {
    throw new Error('[LocaleSitePlugin] clean-css error: ' + result.errors.join(', '));
  }
  return result.styles;
}

class LocaleSitePlugin {
  constructor(options = {}) {
    this.templatePath = options.template;
    this.localesDir = options.localesDir;
    this.stylePath = options.style;
    this.bundleKey = options.bundleKey || '__bundle.js';
  }

  apply(compiler) {
    const { webpack } = compiler;
    const { RawSource } = webpack.sources;

    compiler.hooks.thisCompilation.tap('LocaleSitePlugin', (compilation) => {
      compilation.hooks.processAssets.tapAsync(
        {
          name: 'LocaleSitePlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
        },
        (assets, callback) => {
          try {
            const bundledJS = assets[this.bundleKey]
              ? assets[this.bundleKey].source()
              : '';
            
            if (assets[this.bundleKey]) {
              compilation.deleteAsset(this.bundleKey);
            }

            const rawCSS = fs.readFileSync(this.stylePath, 'utf8');
            const safeCSS = minifyCSS(rawCSS).replace(/<\/style>/gi, '<\\/style>');
            const safeJS = bundledJS ? bundledJS.replace(/<\/script>/gi, '<\\/script>') : '';

            const templateSrc = fs.readFileSync(this.templatePath, 'utf8');
            const template = Handlebars.compile(templateSrc);

            const localeFiles = fs.readdirSync(this.localesDir)
              .filter(f => f.endsWith('.json'));

            let count = 0;
            for (const file of localeFiles) {
              const filePath = path.join(this.localesDir, file);
              const localeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

              if (!localeData || !localeData.enabled) continue;

              const html = template({
                ...localeData,
                INLINE_CSS: new Handlebars.SafeString(`<style>${safeCSS}</style>`),
                INLINE_JS: safeJS ? new Handlebars.SafeString(`<script>${safeJS}</script>`) : '',
              });

              const outputPath = `${localeData.outputDir}/index.html`;
              compilation.emitAsset(outputPath, new RawSource(html, false));
              console.log(`\x1b[32m[LocaleSitePlugin]\x1b[0m built > dist/${outputPath}`);
              count++;
            }

            if (count === 0) {
              console.warn(`\x1b[32m[LocaleSitePlugin]\x1b[0m No enabled locales found in localesDir`);
            } else {
              console.log(`\x1b[32m[LocaleSitePlugin]\x1b[0m Done - ${count} locale page(s) generated.\n`);
            }

            callback();
          } catch (err) {
            callback(err);
          }
        },
      );
    });
  }
}

module.exports = LocaleSitePlugin;