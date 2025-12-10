/**
 * Pattern matching utilities for error code wildcards.
 * Supports exact matches and wildcard patterns (e.g., 'auth.*').
 */

/**
 * Check if a pattern is a wildcard pattern (ends with `.*`).
 */
export function isWildcardPattern(pattern: string): boolean {
  return pattern.endsWith('.*')
}

/**
 * Extract prefix from a wildcard pattern (e.g., 'auth.*' -> 'auth.').
 */
export function getWildcardPrefix(pattern: string): string {
  return pattern.slice(0, -1) // Remove '*', keep the dot
}

/**
 * Check if an error code matches a pattern.
 * - Exact patterns: strict equality
 * - Wildcard patterns (`.*`): code starts with prefix
 */
export function matchesPattern(code: string, pattern: string): boolean {
  if (isWildcardPattern(pattern)) {
    return code.startsWith(getWildcardPrefix(pattern))
  }
  return code === pattern
}

/**
 * Find the best matching handler key for an error code.
 * Priority: exact match > longest wildcard prefix > undefined
 */
export function findBestMatchingPattern(
  code: string,
  patterns: string[],
): string | undefined {
  // First, check for exact match
  if (patterns.includes(code)) {
    return code
  }

  // Then, find matching wildcards and pick the longest prefix (most specific)
  const matchingWildcards = patterns
    .filter(p => isWildcardPattern(p) && matchesPattern(code, p))
    .sort((a, b) => b.length - a.length) // Sort by length descending (longest first)

  return matchingWildcards[0]
}
