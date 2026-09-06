'use strict';

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const CleanCSS = require('clean-css');

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
    this.imagesDir = options.imagesDir;
    this.imagesOutputDir = options.imagesOutputDir || 'images';
    this.bundleKey = options.bundleKey || '__bundle.js';
    this.siteUrl = (options.siteUrl || 'https://inneroutliner.com').replace(/\/$/, '');
    this.defaultLocale = options.defaultLocale || 'en';
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
            // -- 1. Capture the webpack JS bundle --
            const bundledJS = assets[this.bundleKey]
              ? assets[this.bundleKey].source()
              : '';
            
            if (assets[this.bundleKey]) {
              compilation.deleteAsset(this.bundleKey);
            }

            // -- 2. Read and prepare source files --
            const rawCSS = fs.readFileSync(this.stylePath, 'utf8');
            const safeCSS = minifyCSS(rawCSS).replace(/<\/style>/gi, '<\\/style>');
            const safeJS = bundledJS ? bundledJS.replace(/<\/script>/gi, '<\\/script>') : '';

            const templateSrc = fs.readFileSync(this.templatePath, 'utf8');
            const template = Handlebars.compile(templateSrc);

            // -- 3. Copy static images into dist/<imagesOutputDir> --
            if (this.imagesDir && fs.existsSync(this.imagesDir)) {
              const imageFiles = fs.readdirSync(this.imagesDir)
                .filter(f => /\.(png|jpe?g|webp|gif|svg)$/i.test(f));

              for (const file of imageFiles) {
                const constant = fs.readFileSync(path.join(this.imagesDir, file));
                compilation.emitAsset(`${this.imagesOutputDir}/${file}`, new RawSource(constant, true));
              }

              if (imageFiles.length) {
                console.log(`\x1b[32m[LocaleSitePlugin]\x1b[0m copied ${imageFiles.length} image(s) > dist/${this.imagesOutputDir}/`);
              }
            }

            // -- 4. Load locale files from localeDir --
            const locales = fs.readdirSync(this.localesDir)
              .filter(f => f.endsWith('.json'))
              .map(f => JSON.parse(fs.readFileSync(path.join(this.localesDir, f), 'utf8')))
              .filter(locale => locale && locale.enabled);

            // The picker lists every locale that has a generated page.
            const languages = locales
              .map(locale => ({
                code: locale.outputDir,
                htmlLang: locale.htmlLang,
                dir: locale.htmlDir,
                name: locale.languageName || locale.outputDir,
                href: `/${locale.outputDir}/`,
                absHref: `${this.siteUrl}/${locale.outputDir}/`,
              }))
              .sort((a, b) => a.name.localeCompare(b.name));

            const xDefaultHref = (
              languages.find(lang => lang.code === this.defaultLocale) || languages[0]
            ).absHref;

            // -- 5. Emit one HTML file per enabled locale --
            let count = 0;
            for (const localeData of locales) {
              const pageDepth = localeData.outputDir.split('/').filter(Boolean).length;
              const imagePrefix = `${'../'.repeat(pageDepth)}${this.imagesOutputDir}/`;
              const pageData = {
                ...localeData,
                showcase: localeData.showcase && {
                  ...localeData.showcase,
                  items: localeData.showcase.items.map(item => ({
                    ...item,
                    src: item.src.replace(/^\/images\//, imagePrefix),
                  })),
                },
              };
              const structuredData = {
                '@context': 'https://schema.org',
                '@type': 'SoftwareApplication',
                name: localeData.nav && localeData.nav.brand,
                description: localeData.meta && localeData.meta.description,
                url: localeData.meta && localeData.meta.canonical,
                inLanguage: localeData.htmlLang,
                applicationCategory: 'ProductivityApplication',
                operatingSystem: 'macOS, Windows',
                offers: {
                  '@type': 'Offer',
                  price: '0',
                  priceCurrency: 'USD',
                },
              };

              const html = template({
                ...pageData,
                languages: languages.map(lang => ({
                  ...lang,
                  active: lang.code === localeData.outputDir,
                })),
                currentLanguage: languages.find(lang => lang.code === localeData.outputDir),
                xDefaultHref,
                INLINE_CSS: new Handlebars.SafeString(`<style>${safeCSS}</style>`),
                INLINE_JS: safeJS ? new Handlebars.SafeString(`<script>${safeJS}</script>`) : '',
                STRUCTURED_DATA: new Handlebars.SafeString(
                  `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`,
                ),
              });

              const outputPath = `${localeData.outputDir}/index.html`;
              compilation.emitAsset(outputPath, new RawSource(html, false));
              console.log(`\x1b[32m[LocaleSitePlugin]\x1b[0m built > dist/${outputPath}`);
              count++;
            }

            // -- 6. Emit sitemap.xml + robots.txt (SEO discovery files) --
            if (count > 0) {
              const today = new Date().toISOString().slice(0, 10);
              const urlEntries = languages.map(lang => {
                const alternates = languages
                  .map(alt => `<xhtml:link rel="alternate" hreflang="${alt.htmlLang}" href="${alt.absHref}" />`)
                  .join('\n');
                return `<url>\n <loc>${lang.absHref}</loc>\n <lastmod>${today}</lastmod>\n <changefreq>weekly</changefreq>\n <priority>${lang.code === this.defaultLocale ? '1.0' : '0.8'}</priority>\n${alternates}\n </url>`;
              }).join('\n');

              const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urlEntries}\n</urlset>`;
              compilation.emitAsset('sitemap.xml', new RawSource(sitemap, false));

              const robots = `User-agent: *\nAllow: /\n\nSitemap: ${this.siteUrl}/sitemap.xml\n`;
              compilation.emitAsset('robots.txt', new RawSource(robots, false));

              console.log(`\x1b[32m[LocaleSitePlugin]\x1b[0m built > dist/sitemap.xml, dist/robots.txt`);
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