export function exportSvg(svg: SVGSVGElement, includeBackground: boolean): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-editor="true"], .segment-hit, .station-hit > circle:last-child, .station-selection-ring').forEach(node => node.remove())
  clone.querySelectorAll('.segment-selected').forEach(node => node.classList.remove('segment-selected'))
  if (!includeBackground) clone.querySelectorAll('image').forEach(node => node.remove())
  clone.removeAttribute('id')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(clone)
}
