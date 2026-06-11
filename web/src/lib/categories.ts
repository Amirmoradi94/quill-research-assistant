// Single source of truth for displaying research_category labels.
// The DB stores lowercase keys; the UI should show acronyms uppercased
// and other words title-cased.

const ACRONYMS = new Set(['av', 'cv', 'nlp', 'or', 'rl', 'ai', 'ml', 'iot', 'hci'])

export function formatCategory(cat?: string | null): string {
  if (!cat) return ''
  const key = cat.trim().toLowerCase()
  if (!key) return ''
  if (ACRONYMS.has(key)) return key.toUpperCase()
  // Multi-word: title-case each part, but uppercase any acronym parts
  return key
    .split(/\s+/)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}
