// Project/repo identity helpers: name normalization and git-remote slug detection.

import fs from 'node:fs';
import path from 'node:path';

/** Lower-case, collapse non-alphanumerics to single dashes, trim dashes. */
export function kebabCase(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Extract `owner/repo` (or the Azure repo name) from a git remote URL. */
export function slugFromRemoteUrl(url) {
  const u = url.trim().replace(/\.git$/, '');
  const ado = u.match(/dev\.azure\.com\/[^/]+\/[^/]+\/_git\/([^/]+)$/);
  if (ado) return ado[1];
  const ssh = u.match(/^[^@\s]+@[^:]+:(.+)$/); // git@host:owner/repo
  if (ssh) return ssh[1];
  const https = u.match(/^https?:\/\/[^/]+\/(.+)$/); // https://host/owner/repo
  if (https) return https[1];
  return '';
}

/** Parse the origin remote's slug from raw .git/config text. '' when absent/unparseable. */
export function parseOriginSlug(gitConfigText) {
  if (!gitConfigText) return '';
  let inOrigin = false;
  for (const raw of gitConfigText.split('\n')) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+?)\]$/);
    if (sec) { inOrigin = /^remote\s+"origin"$/.test(sec[1]); continue; }
    if (inOrigin) {
      const m = line.match(/^url\s*=\s*(.+)$/);
      if (m) return slugFromRemoteUrl(m[1]);
    }
  }
  return '';
}

/** Read the origin slug from <root>/.git/config; '' when absent. */
export function detectRepoSlug(projectRoot) {
  const cfg = path.join(projectRoot, '.git', 'config');
  if (!fs.existsSync(cfg)) return '';
  try { return parseOriginSlug(fs.readFileSync(cfg, 'utf8')); } catch { return ''; }
}
