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

function buildFooterLinks(localeCode, footerLinks = []) {
  const legalSlugs = ['privacy', 'terms', 'security'];

  return footerLinks.map((link, index) => {
    if (index < legalSlugs.length) {
      return {
        ...link,
        href: `/${localeCode}/${legalSlugs[index]}/`,
      };
    }

    return link;
  });
}

function pageLabelFromFooter(footerLinks, slug) {
  const slugOrder = {
    privacy: 0,
    terms: 1,
    security: 2,
  };
  const fallback = slug.charAt(0).toUpperCase() + slug.slice(1);
  const idx = slugOrder[slug];
  return typeof idx === 'number' && footerLinks[idx] && footerLinks[idx].label
    ? footerLinks[idx].label
    : fallback;
}

function pageSuffixFor(slug) {
  if (slug === 'index') return '';
  if (slug === 'license') return 'license.html';
  return `${slug}/`;
}

function buildPageMeta(siteUrl, localeData, slug, footerLinks) {
  if (slug === 'index') {
    return localeData.meta;
  }

  const label = pageLabelFromFooter(footerLinks, slug);
  const brand = (localeData.nav && localeData.nav.brand) || 'InnerOutliner';
  const canonical = `${siteUrl}/${localeData.outputDir}/${pageSuffixFor(slug)}`;
  const description = `${label} information for ${brand}.`;

  return {
    title: `${label} | ${brand}`,
    description,
    keywords: `${brand}, ${label}`,
    canonical,
    ogLocale: (localeData.meta && localeData.meta.ogLocale) || localeData.htmlLang,
    ogTitle: `${label} | ${brand}`,
    ogDesc: description,
  };
}

function buildPageLanguages(locales, siteUrl, slug) {
  const pageSuffix = pageSuffixFor(slug);

  return locales
    .map(locale => ({
      code: locale.outputDir,
      htmlLang: locale.htmlLang,
      dir: locale.htmlDir,
      name: locale.languageName || locale.outputDir,
      href: `/${locale.outputDir}/${pageSuffix}`,
      absHref: `${siteUrl}/${locale.outputDir}/${pageSuffix}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

class LocaleSitePlugin {
  constructor(options = {}) {
    this.templatePath = options.template;
    this.pageTemplates = options.pageTemplates || { index: options.template };
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

            const compiledTemplates = {};
            for (const [slug, templatePath] of Object.entries(this.pageTemplates)) {
              if (!templatePath || !fs.existsSync(templatePath)) {
                continue;
              }

              const templateSrc = fs.readFileSync(templatePath, 'utf8');
              compiledTemplates[slug] = Handlebars.compile(templateSrc);
            }
            
            if (!compiledTemplates.index) {
              throw new Error('[LocaleSitePlugin] Missing required "index" template.');
            }

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

            // -- 5. Emit one HTML file per enabled locale --
            let count = 0;
            for (const localeData of locales) {
              for (const [slug, template] of Object.entries(compiledTemplates)) {
                const isIndexPage = slug === 'index';
                const pageDepthBase = localeData.outputDir.split('/').filter(Boolean).length;
                const pageDepth = pageSuffixFor(slug).endsWith('/') ? pageDepthBase + 1 : pageDepthBase;
                const imagePrefix = `${'../'.repeat(pageDepth)}${this.imagesOutputDir}/`;
                const footerLinks = buildFooterLinks(localeData.outputDir, (localeData.footer && localeData.footer.links) || []);

                const pageData = {
                  ...localeData,
                  meta: buildPageMeta(this.siteUrl, localeData, slug, footerLinks),
                  footer: localeData.footer && {
                    ...localeData.footer,
                    links: footerLinks,
                  },
                  showcase: localeData.showcase && {
                    ...localeData.showcase,
                    items: localeData.showcase.items.map(item => ({
                      ...item,
                      src: item.src.replace(/^\/images\//, imagePrefix),
                    })),
                  },
                };

                const pageLanguages = buildPageLanguages(locales, this.siteUrl, slug);
                // The index page group has a real language-neutral landing page at the site root;
                // other page groups fall back to the default locale's own page.
                const xDefaultHref = isIndexPage
                  ? `${this.siteUrl}/`
                  : (pageLanguages.find(lang => lang.code === this.defaultLocale) || pageLanguages[0]).absHref;
                const pageLabel = pageLabelFromFooter(footerLinks, slug);
                const structuredData = isIndexPage ? {
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
                } : {
                  '@context': 'https://schema.org',
                  '@type': 'WebPage',
                  name: pageLabel,
                  inLanguage: localeData.htmlLang,
                  url: `${this.siteUrl}/${localeData.outputDir}/${pageSuffixFor(slug)}`,
                  isPartOf: {
                    '@type': 'WebSite',
                    name: (localeData.nav && localeData.nav.brand) || 'InnerOutliner',
                    url: `${this.siteUrl}/${localeData.outputDir}/`,
                  },
                };

                const html = template({
                  ...pageData,
                  pageSlug: slug,
                  pageLabel,
                  languages: pageLanguages.map(lang => ({
                    ...lang,
                    active: lang.code === localeData.outputDir,
                  })),
                  currentLanguage: pageLanguages.find(lang => lang.code === localeData.outputDir),
                  xDefaultHref,
                  INLINE_CSS: new Handlebars.SafeString(`<style>${safeCSS}</style>`),
                  INLINE_JS: safeJS ? new Handlebars.SafeString(`<script>${safeJS}</script>`) : '',
                  STRUCTURED_DATA: new Handlebars.SafeString(
                    `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`,
                  ),
                });

                const outputPath = isIndexPage
                  ? `${localeData.outputDir}/index.html`
                  : slug === 'license'
                    ? `${localeData.outputDir}/license.html`
                    : `${localeData.outputDir}/${slug}/index.html`;
                compilation.emitAsset(outputPath, new RawSource(html, false));
                console.log(`\x1b[32m[LocaleSitePlugin]\x1b[0m built > dist/${outputPath}`);
                count++;
              }
            }

            // -- 5.5. Emit root index.html: language-neutral landing page that suggests a
            // matching locale based on the visitor's browser language (defaults to 'en' content). --
            let rootIndexEmitted = false;
            const defaultLocaleData = locales.find(l => l.outputDir === this.defaultLocale) || locales[0];
            if (defaultLocaleData && compiledTemplates.index) {
              const footerLinks = buildFooterLinks(defaultLocaleData.outputDir, (defaultLocaleData.footer && defaultLocaleData.footer.links) || []);
              const pageLanguages = buildPageLanguages(locales, this.siteUrl, 'index');
              const suggestLocales = pageLanguages
                .filter(lang => lang.code !== this.defaultLocale)
                .map(lang => { 
                  const ownLocaleData = locales.find(l => l.outputDir === lang.code);
                  return {
                    code: lang.code, 
                    htmlLang: lang.htmlLang, 
                    name: lang.name, 
                    href: lang.href,
                    // Each target locale supplies its own translated suggestion strings,
                    // so the banner reads naturally in the visitor's detected language.
                    strings: (ownLocaleData && ownLocaleData.localeSuggest) || defaultLocaleData.localeSuggest || {},
                  };
                });
              const suggestData = {
                locales: suggestLocales,
                strings: defaultLocaleData.localeSuggest || {},
              };
              
              const pageData = {
                ...defaultLocaleData,
                meta: {
                  ...buildPageMeta(this.siteUrl, defaultLocaleData, 'index', footerLinks),
                  canonical: `${this.siteUrl}/`,
                },
                footer: defaultLocaleData.footer && {
                  ...defaultLocaleData.footer,
                  links: footerLinks,
                },
                showcase: defaultLocaleData.showcase && {
                  ...defaultLocaleData.showcase,
                  items: defaultLocaleData.showcase.items.map(item => ({
                    ...item,
                    src: item.src.replace(/^\/images\//, `./${this.imagesOutputDir}/`),
                  })),
                },
              };

              const structureData = {
                '@context': 'https://schema.org',
                '@type': 'SoftwareApplication',
                name: defaultLocaleData.nav && defaultLocaleData.nav.brand,
                description: pageData.meta && pageData.meta.description,
                url: pageData.meta && pageData.meta.canonical,
                inLanguage: defaultLocaleData.htmlLang,
                applicationCategory: 'ProductivityApplication',
                operatingSystem: 'macOS, Windows',
                offers: { '@type': 'Offer', price: '4.99', priceCurrency: 'USD'},
              };

              const html = compiledTemplates.index({
                ...pageData,
                pageSlug: 'index',
                isRootPage: true,
                languages: pageLanguages.map(lang => ({
                  ...lang,
                  active: lang.code === defaultLocaleData.outputDir,
                })),
                currentLanguage: pageLanguages.find(lang => lang.code === defaultLocaleData.outputDir),
                xDefaultHref: `${this.siteUrl}/`,
                localeSuggestData: new Handlebars.SafeString(JSON.stringify(suggestData).replace(/</g,'\\u003c')),
                INLINE_CSS: new Handlebars.SafeString(`<style>${safeCSS}</style>`),
                INLINE_JS: safeJS ? new Handlebars.SafeString(`<script>${safeJS}</script>`) : '',
                STRUCTURED_DATA: new Handlebars.SafeString(
                  `<script type="application/ld+json">${JSON.stringify(structureData)}</script>`,
                ),
              });

              compilation.emitAsset('index.html', new RawSource(html, false));
              console.log(`\x1b[32m[LocaleSitePlugin]\x1b[0m built > dist/index.html (locale-detect landing page)`);
              rootIndexEmitted = true;
            }

            // -- 6. Emit sitemap.xml + robots.txt (SEO discovery files) --
            if (count > 0) {
              const today = new Date().toISOString().slice(0, 10);
              const sitemapSlugs = Object.keys(compiledTemplates);
              const rootUrlEntry = rootIndexEmitted ? (() => {
                const indexLanguages = buildPageLanguages(locales, this.siteUrl, 'index');
                const alternates = indexLanguages
                  .map(alt => `<xhtml:link rel="alternate" hreflang="${alt.htmlLang}" href="${alt.absHref}" />`)
                  .concat(`<xhtml:link rel="alternate" hreflang="x-default" href="${this.siteUrl}" />`)
                  .join('\n');
                return `<url>\n <loc>${this.siteUrl}/<loc>\n <lastmod>${today}</lastmod>\n<changefreq>weekly</changefreq>\n <priority>1.0</priority>\n${alternates}\n </url>`;
              })() : '';
              const urlEntries = sitemapSlugs.map(slug => {
                const pageLanguages = buildPageLanguages(locales, this.siteUrl, slug);

                return pageLanguages.map(lang => {
                  const alternates = pageLanguages
                    .map(alt => `<xhtml:link rel="alternate" hreflang="${alt.htmlLang}" href="${alt.absHref}" />`)
                    .join('\n');
                  const isIndex = slug === 'index';
                  const priority = isIndex
                    ? (lang.code === this.defaultLocale ? '1.0' : "0.8")
                    : '0.6';

                  return `<url>\n <loc>${lang.absHref}</loc>\n <lastmod>${today}</lastmod>\n <changefreq>weekly</changefreq>\n <priority>${priority}</priority>\n${alternates}\n </url>`;
                }).join('\n');
              }).join('\n');

              const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rootUrlEntry}\n${urlEntries}\n</urlset>`;
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