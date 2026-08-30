export type ProjectFormat = 'actual-route' | 'aarc' | 'unknown'

export function detectProjectFormat(raw: unknown): ProjectFormat {
  if (!raw || typeof raw !== 'object') return 'unknown'
  const value = raw as Record<string, unknown>
  if (value.version === 1 && Array.isArray(value.stations) && Array.isArray(value.lines) && isGeometry(value.geometry)) return 'actual-route'
  if (Array.isArray(value.lines) && Array.isArray(value.points) && Array.isArray(value.cvsSize)) return 'aarc'
  return 'unknown'
}

function isGeometry(value: unknown) {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { segments?: unknown }).segments))
}