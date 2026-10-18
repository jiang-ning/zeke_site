'use strict';

const fs = require('fs');
const path = require('path');

// Copies a directory of hand-written static files into dist/<to>/ (webpack's
// `output.clean` wipes dist, so files must be emitted as assets). String
// placeholders in text files are replaced from `replacements`
const TEXT_EXT = /\.(html?|css|js|svg|txt|xml|json|webmanifest)$/i;

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

class StaticDirPlugin {
  constructor(options = {}) {
    this.from = options.from;
    this.to = (options.to || '').replace(/^\/+|\/+$/g, '');
    this.replacements = options.replacements || {};
  }

  apply(compiler) {
    const { webpack } = compiler;
    const { RawSource } = webpack.sources;

    compiler.hooks.thisCompilation.tap('StaticDirPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'StaticDirPlugin', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          if (!this.from || !fs.existsSync(this.from)) {
            compilation.warnings.push(new Error(`[StaticDirPlugin] Source directory not found: ${this.from}`));
            return;
          }

          compilation.contextDependencies.add(this.from);
          const files = listFiles(this.from);

          for (const file of files) {
            const rel = path.relative(this.from, file).split(path.sep).join('/');
            const outputPath = this.to ? `${this.to}/${rel}` : rel;
            let content = fs.readFileSync(file);

            if (TEXT_EXT.test(file)) {
              let text = content.toString('utf8');
              for (const [token, value] of Object.entries(this.replacements)) {
                text = text.split(token).join(value);
              }
              content = Buffer.from(text, 'utf8');
            }

            compilation.emitAsset(outputPath, new RawSource(content, false));
          }

          console.log(`\x1b[32m[StaticDirPlugin]\x1b[0m copied ${files.length} files(s) > dist/${this.to || ''}`)
        },
      );
    });
  }
}

module.exports = StaticDirPlugin;
