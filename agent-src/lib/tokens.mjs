// Token substitution + per-unit body assembly.

/** Global tokens are the base; per-unit manifest.tokens override by key. */
export function mergeTokens(globalTokens, unitTokens) {
  return { ...globalTokens, ...(unitTokens || {}) };
}

/**
 * Substitute {{token}} occurrences in `text`. A token value may be a string or a
 * per-platform map (resolved with `platform`). Throws on any undefined token or a
 * per-platform map that lacks the active platform.
 */
export function substituteTokens(text, tokens, platform, where) {
  for (const m of text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
    if (!(m[1] in tokens)) {
      throw new Error(`${where}: uses {{${m[1]}}} with no matching token (global or unit)`);
    }
  }
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, token) => {
    const def = tokens[token];
    const val = def && typeof def === 'object' ? def[platform] : def;
    if (val == null) {
      throw new Error(`${where}: token {{${token}}} has no value for ${platform}`);
    }
    return String(val);
  });
}

/** Resolve tokens in a platform-neutral string (manifest description / interface). */
export function substituteNeutral(text, tokens, where) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, token) => {
    if (!(token in tokens)) {
      throw new Error(`${where}: uses {{${token}}} with no matching token`);
    }
    const def = tokens[token];
    if (def && typeof def === 'object') {
      throw new Error(`${where}: token {{${token}}} is per-platform; manifest strings must be neutral`);
    }
    return String(def);
  });
}

/**
 * Resolve tokens in the manifest's platform-neutral strings (description and, for
 * skills, the interface descriptor) once per unit, before any renderer reads them.
 * Mutates the in-memory manifest.
 */
export function substituteManifestStrings(unit, globalTokens) {
  const tokens = mergeTokens(globalTokens, unit.manifest.tokens);
  if (typeof unit.manifest.description === 'string') {
    unit.manifest.description = substituteNeutral(
      unit.manifest.description, tokens, `${unit.kind}/${unit.name} manifest.description`);
  }
  const iface = unit.manifest.interface;
  if (iface) {
    for (const k of ['display_name', 'short_description', 'default_prompt']) {
      if (typeof iface[k] === 'string') {
        iface[k] = substituteNeutral(iface[k], tokens, `${unit.kind}/${unit.name} interface.${k}`);
      }
    }
  }
}

export function resolveBody(unit, platform, globalTokens) {
  const tokens = mergeTokens(globalTokens, unit.manifest.tokens);
  let body = substituteTokens(unit.body, tokens, platform, `${unit.kind}/${unit.name} body`);

  // Append the platform overlay if present (overlays get the same token treatment).
  if (unit.overlays[platform]) {
    const ov = substituteTokens(
      unit.overlays[platform], tokens, platform, `${unit.kind}/${unit.name} overlay:${platform}`);
    body = body.replace(/\n+$/, '\n') + '\n' + ov;
  }
  // Append the project customization fragment last, so it wins by "later instruction" precedence.
  if (unit.append) {
    const frag = substituteTokens(
      unit.append, tokens, platform, `${unit.kind}/${unit.name} append (agent-custom)`);
    body = body.replace(/\n+$/, '\n') + '\n' + frag;
  }
  if (!body.endsWith('\n')) body += '\n';
  return body;
}
