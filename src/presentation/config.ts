export const PRESENTATION_ANIMATION = {
  stationFadeDuration: .4,
  stationScaleFrom: .82,
  labelDelay: .2,
  labelFadeDuration: .38,
  transferMorphDuration: .7,
  closureFadeDuration: .35,
  cameraDuration: .8,
  cameraTransitionDuration: .8,
  overviewTransitionDuration: .8,
  followCameraHeight: 560,
  boundsPadding: 90,
} as const

export const easing = {
  line: (t: number) => clamp(t),
  station: (t: number) => 1 - Math.pow(1 - clamp(t), 3),
  camera: (t: number) => { const x = clamp(t); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 },
  transfer: (t: number) => smoothStep(clamp(t)),
}
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
export const smoothStep = (value: number) => value * value * (3 - 2 * value)
export function inverseLineEasing(progress: number) { return clamp(progress) }
