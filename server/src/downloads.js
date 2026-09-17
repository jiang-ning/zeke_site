'use strict';

const { version } = require("react");

const OWNER = process.env.GITHUB_RELEASE_OWNER || 'jiang-ning';
const REPO = process.env.GITHUB_RELEASE_REPO || 'inneroutliner';
const CACHE_TTL_MS = 5 * 60 * 1000;

// Asset name patterns per platform slug, matched in order against the latest release.
// Names come from the electron-forge makers in zeke_pro/forge.config.js
// (squirrel -> .exe, zip -> darwin .zip, deb -> .deb, rpm -> .rpm).
const PLATFORM_MATCHERS = {
  win: [/\.exe$/i, /win32.*\.zip$/i],
  'mac-arm64': [/arm64.*\.dmg$/i, /(darwin|mac|osx).*arm64.*\.zip$/i],
  'linux-deb': [/\.deb$/i],
  'linux-rpm': [/\.rpm$/i],
};

const PLATFORMS = Object.keys(PLATFORM_MATCHERS);

// Only ever redirect to hosts Github actually serves release assets from, so a
// compromised/unexpected API response cannot turn this into an open redirect.
const ALLOWED_ASSET_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

let cache = null;
let inFlight = null;

async function fetchLatestRelease() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `${OWNER}-${REPO}-site`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Optional: lifts the unauthenticated 60 req/h rate limit and allows private repos.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/release/latest`, { headers });

  if (!response.ok) {
    throw new Error(`GitHub releases API returned ${response.status}`);
  }

  const release = await response.json();

  return {
    version: release.tag_name,
    assets: (release.assets || []).map((asset) => ({ name: asset.name, url: asset.browser_download_url })),
  };
}

async function getLatestRelease() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.release;
  }

  if (!inFlight) {
    inFlight = fetchLatestRelease()
      .then((release) => {
        cache = { release, fetchedAt: Date.now() };
        return release;
      })
      .catch((err) => {
        // Serve a stale copy rather than failing the download if GitHub hiccups.
        if (cache) return cache.release;
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

function isAllowedAssetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_ASSET_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function resolveDownload(platform) {
  const matchers = PLATFORM_MATCHERS[platform];
  if (!matchers) return null;

  const release = await getLatestRelease();

  for (const matcher of matchers) {
    const asset = release.assets.find((candidate) => matcher.test(candidate.name));
    if (asset && isAllowedAssetUrl(asset.url)) {
      return { url: asset.url, name: asset.name, version: release.version };
    }
  }

  return null;
}

function detectPlatform(userAgent = '') {
  const ua = userAgent.toLowerCase();

  if (ua.includes('windows')) return 'win';
  if (ua.includes('mac os') || ua.includes('macintosh')) {
    // Safari/Chrome on Apple Silicon still report Intel; arm64 is the safer default
    // for new Macs, so only fall back to x64 when the UA looks like an old build.
    return ua.includes('intel mac os x 10_1') ? 'mac-x64' : 'mac-arm64';
  }
  if (ua.includes('linux') && !ua.includes('android')) return 'linux-deb';

  return 'win';
}

module.exports = { PLATFORMS, resolveDownload, detectPlatform, getLatestRelease };
