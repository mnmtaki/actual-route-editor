import { memo, useMemo } from 'react'
import type { ActualRouteProject } from '../data/model'
import { resolveAarcPointLinksArtwork, type AarcPointLinkArtwork } from '../import-export/aarcPointLinks'

function Link({ link, layer, color }: { link: AarcPointLinkArtwork; layer: 'carpet' | 'body' | 'core'; color: string }) {
  const width = layer === 'carpet' ? link.carpetWidth : layer === 'body' ? link.bodyWidth : link.coreWidth
  if (!width) return null
  return <line
    data-aarc-point-link-id={link.id}
    data-aarc-point-link-type={link.type}
    data-aarc-point-link-layer={layer}
    x1={link.start.x} y1={link.start.y} x2={link.end.x} y2={link.end.y}
    fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
    {...(layer === 'body' && link.dash ? { strokeDasharray: link.dash.join(' ') } : {})}
    pointerEvents="none"
  />
}

export const AarcPointLinksLayer = memo(function AarcPointLinksLayer({ project }: { project: ActualRouteProject }) {
  const artwork = useMemo(() => resolveAarcPointLinksArtwork(project), [project])
  if (!artwork.links.length && !artwork.covers.length) return null
  const coverWidth = (layer: 'carpet' | 'body' | 'core', sizeRatio: number) => layer === 'carpet'
    ? (artwork.stationSize + artwork.stationLineWidth) * sizeRatio * 2
    : layer === 'body'
      ? (artwork.stationSize * 2 + artwork.stationLineWidth) * sizeRatio
      : (artwork.stationSize * 2 - artwork.stationLineWidth) * sizeRatio
  const layerColor = (layer: 'carpet' | 'body' | 'core') => layer === 'carpet' ? artwork.colors.background : layer === 'body' ? artwork.colors.exchange : artwork.colors.fill
  return <g data-layer="aarc-point-links" pointerEvents="none">
    {(['carpet', 'body', 'core'] as const).map(layer => <g key={layer} data-aarc-point-link-render-layer={layer}>
      {artwork.covers.map(cover => <circle key={`${layer}-${cover.pointId}`} data-aarc-point-link-cover={cover.pointId} data-aarc-point-link-cover-layer={layer} cx={cover.x} cy={cover.y} r={Math.max(0, coverWidth(layer, cover.sizeRatio) / 2)} fill={layerColor(layer)} />)}
      {artwork.links.map(link => <Link key={`${layer}-${link.id}`} link={link} layer={layer} color={layerColor(layer)} />)}
    </g>)}
  </g>
})
