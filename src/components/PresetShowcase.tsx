import type { ActualRouteProject } from '../data/model'
import { demoProject } from '../data/demo'
import { getBuiltInPresets } from '../data/presetRegistry'
import { PresetPreview } from './BuiltInPresetPanel'

/**
 * Development-only visual fixture for comparing every built-in symbol and its
 * supported service-count variants. It is intentionally not mounted by App;
 * importing it from a test/dev route keeps it out of normal user projects.
 */
const SHOWCASE_CASES: Array<{ presetId: string; serviceCount?: number }> = [
  { presetId: 'station.actualroute.default' },
  { presetId: 'transfer.actualroute.default', serviceCount: 2 },
  { presetId: 'station.shanghai.basic' },
  { presetId: 'transfer.shanghai.default', serviceCount: 2 },
  { presetId: 'station.guangzhou.basic' },
  { presetId: 'transfer.guangzhou.classic', serviceCount: 2 },
  { presetId: 'transfer.guangzhou.classic', serviceCount: 3 },
  { presetId: 'transfer.guangzhou.classic', serviceCount: 4 },
  { presetId: 'transfer.guangzhou.2024', serviceCount: 2 },
  { presetId: 'transfer.guangzhou.2024', serviceCount: 4 },
  { presetId: 'transfer.guangzhou.2024', serviceCount: 6 },
  { presetId: 'transfer.beijing.default', serviceCount: 2 },
  { presetId: 'transfer.kunming.two', serviceCount: 2 },
  { presetId: 'transfer.kunming.three', serviceCount: 3 },
  { presetId: 'transfer.kunming.three', serviceCount: 4 },
  { presetId: 'transfer.kunming.three', serviceCount: 6 },
  { presetId: 'station.metroman.basic' },
  { presetId: 'transfer.metroman.default', serviceCount: 2 },
]

export function PresetShowcase({ project = demoProject }: { project?: ActualRouteProject }) {
  const presets = getBuiltInPresets()
  return <section className="preset-showcase" data-testid="preset-showcase">
    <header><h2>内置车站样式预览</h2><p>仅用于开发与视觉验收，不会自动加入用户工程。</p></header>
    <div className="preset-showcase-grid">{SHOWCASE_CASES.map((item, index) => {
      const preset = presets.find(candidate => candidate.id === item.presetId)
      if (!preset) return null
      const label = item.serviceCount ? `${preset.displayName} · ${item.serviceCount}线` : preset.displayName
      return <article key={`${item.presetId}-${item.serviceCount ?? 'default'}-${index}`} data-preset-id={item.presetId} data-service-count={item.serviceCount ?? ''}>
        <h3>{label}</h3>
        <PresetPreview project={project} presetId={item.presetId} serviceCount={item.serviceCount} />
      </article>
    })}</div>
  </section>
}

export const PRESET_SHOWCASE_CASES = SHOWCASE_CASES
