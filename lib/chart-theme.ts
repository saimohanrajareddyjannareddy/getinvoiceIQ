/**
 * getinvoiceIQ — shared chart language for the dashboard.
 * One family across every chart, matching the homepage's
 * price-tracker mock: hairline grid, mono ticks in warm gray,
 * coal + pop series, cream tooltip card. Pages import these
 * constants instead of re-declaring local palettes (the Food Cost
 * page kept private pre-theme constants for months — this module
 * is the fix for that failure mode).
 */
export const POP = '#EC4899'
export const COAL = '#171310'
export const GRAY = '#8A8377'

/** Multi-series order: the story series first (pop), then coal, then gray. */
export const SERIES = [POP, COAL, GRAY]

export const GRID = 'rgba(26,23,19,0.08)'

export const TICK = {
  fontSize: 11,
  fontFamily: 'var(--font-plex-mono)',
  fill: GRAY,
} as const

export const tooltipStyle = {
  borderRadius: 10,
  border: '1px solid rgba(26,23,19,0.1)',
  background: '#FFFDF9',
  fontFamily: 'var(--font-plex-mono)',
  fontSize: 12,
}

export const CURSOR = { fill: 'rgba(23,19,16,0.06)' }
