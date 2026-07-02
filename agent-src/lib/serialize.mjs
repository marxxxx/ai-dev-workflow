// Small serializers (we WRITE known field sets; we never parse YAML/TOML) + LF normalization.

/** Double-quote and escape a string for YAML/TOML basic strings. */
export function dq(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/** Emit a YAML scalar plain when safe, double-quoted otherwise. */
export function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value);
  const needsQuote =
    s === '' ||
    /^\s|\s$/.test(s) ||              // leading/trailing whitespace
    /[:#]\s/.test(s) ||              // "key: val" or " # comment" ambiguity
    /\s#/.test(s) ||
    /:$/.test(s) ||                  // trailing colon
    /[\n"\\]/.test(s) ||
    /^[-?!&*|>%@`'"#,\[\]{}]/.test(s); // leading indicator char
  return needsQuote ? dq(s) : s;
}

export function normalizeLF(text) {
  return text.replace(/\r\n/g, '\n');
}
