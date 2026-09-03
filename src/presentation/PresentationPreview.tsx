import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ActualRouteProject, PresentationSettings } from '../data/model'
import { compilePresentation, resolutionSize } from './compiler'
import { getBeatLocalProgress, getPresentationState } from './engine'
import { PresentationScene } from './PresentationScene'
import { exportPresentationVideo, getSupportedVideoFormats } from './videoExport'
import { saveBlob, shareBlob } from '../platform/fileIO'

export function PresentationPreview({ project, onClose, onSettingsChange }: { project: ActualRouteProject; onClose: () => void; onSettingsChange: (settings: PresentationSettings) => void }) {
  const [settings, setSettings] = useState(project.presentation)
  const [previewSize, setPreviewSize] = useState({ width: 1280, height: 720 })
  const previewAspect = previewSize.width / previewSize.height
  const sequence = useMemo(() => compilePresentation(project, settings, previewAspect), [project, settings, previewAspect])
  const videoSize = resolutionSize(settings.resolution)
  const exportSequence = useMemo(() => compilePresentation(project, settings, videoSize.width / videoSize.height), [project, settings, videoSize.width, videoSize.height])
  const [time, setTime] = useState(0), [exportTime, setExportTime] = useState(0), [playing, setPlaying] = useState(false), [settingsOpen, setSettingsOpen] = useState(true)
  const [debugOpen, setDebugOpen] = useState(false), [frameStats, setFrameStats] = useState({ fps: 0, deltaMs: 0 })
  const [exporting, setExporting] = useState(false), [exportProgress, setExportProgress] = useState(0), [message, setMessage] = useState(''), [lastVideo, setLastVideo] = useState<{ blob: Blob; filename: string } | null>(null)
  const formats = useMemo(getSupportedVideoFormats, []), [formatIndex, setFormatIndex] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null), exportSvgRef = useRef<SVGSVGElement>(null), stageRef = useRef<HTMLDivElement>(null)
  const last = useRef(0), statLast = useRef(0), smoothedDelta = useRef(16.7), pointers = useRef(new Map<number, { x: number; y: number }>()), pinchDistance = useRef<number | null>(null)
  const debugState = useMemo(() => debugOpen ? getPresentationState(project, sequence, time) : null, [debugOpen, project, sequence, time])
  const debugSegment = debugState ? Object.entries(debugState.segmentStates).find(([, value]) => value.revealProgress > 0 && value.revealProgress < 1) : undefined

  useLayoutEffect(() => {
    const element = stageRef.current
    if (!element) return
    const updateSize = () => { const rect = element.getBoundingClientRect(); setPreviewSize({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) }) }
    updateSize(); const observer = new ResizeObserver(updateSize); observer.observe(element); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!playing) return
    last.current = performance.now(); statLast.current = last.current
    let frame = 0
    const loop = (now: number) => {
      const rawDelta = Math.max(0, now - last.current), delta = Math.min(.1, rawDelta / 1000); last.current = now
      if (debugOpen) { smoothedDelta.current = smoothedDelta.current * .86 + rawDelta * .14; if (now - statLast.current > 250) { statLast.current = now; setFrameStats({ fps: smoothedDelta.current > 0 ? 1000 / smoothedDelta.current : 0, deltaMs: rawDelta }) } }
      setTime(current => { const next = Math.min(sequence.duration, current + delta); if (next >= sequence.duration) setPlaying(false); return next }); frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop); return () => cancelAnimationFrame(frame)
  }, [playing, sequence.duration, debugOpen])
  useEffect(() => { setTime(current => Math.min(current, sequence.duration)) }, [sequence.duration])

  const update = (values: Partial<PresentationSettings>) => { const next = { ...settings, ...values }; setSettings(next); onSettingsChange(next) }
  const setCameraViewWidth = (value: number) => update({ cameraViewWidth: Math.max(100, Math.min(20000, value)) })
  const handleWheel = (event: React.WheelEvent) => { event.preventDefault(); setPlaying(false); setCameraViewWidth(settings.cameraViewWidth * (event.deltaY > 0 ? 1.12 : .88)) }
  const pointerDown = (event: React.PointerEvent) => { pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); event.currentTarget.setPointerCapture?.(event.pointerId) }
  const pointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size !== 2) { pinchDistance.current = null; return }
    const [a, b] = [...pointers.current.values()], distance = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinchDistance.current && distance > 1) { setPlaying(false); setCameraViewWidth(settings.cameraViewWidth * pinchDistance.current / distance) }
    pinchDistance.current = distance
  }
  const pointerEnd = (event: React.PointerEvent) => { pointers.current.delete(event.pointerId); if (pointers.current.size < 2) pinchDistance.current = null }
  const exportVideo = async () => {
    const format = formats[formatIndex]
    if (!format) { setMessage('当前浏览器不支持离线视频编码，建议使用桌面版 Chrome 或 Edge。'); return }
    setPlaying(false); setExporting(true); setExportProgress(0); setMessage('正在按固定帧率逐帧渲染并编码，请保持页面打开。')
    try {
      const blob = await exportPresentationVideo({ width: videoSize.width, height: videoSize.height, fps: settings.fps, duration: exportSequence.duration, format, onProgress: setExportProgress,
        renderFrame: async frameTime => { flushSync(() => setExportTime(frameTime)); if (!exportSvgRef.current) throw new Error('演示画面尚未准备好'); return exportSvgRef.current },
      })
      const filename = `${project.name}-发展史.${format.extension}`; setLastVideo({ blob, filename }); await saveBlob(filename, blob); setMessage(`视频已生成：${format.label}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '视频导出失败') } finally { setExporting(false) }
  }

  return <div className="presentation-mode" role="dialog" aria-label="轨道交通线网发展史演示">
    <div ref={stageRef} className="presentation-stage" onWheel={handleWheel} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}><PresentationScene project={project} sequence={sequence} time={time} width={previewSize.width} height={previewSize.height} svgRef={svgRef} /></div>
    <div className="presentation-export-frame" aria-hidden="true"><PresentationScene project={project} sequence={exportSequence} time={exportTime} width={videoSize.width} height={videoSize.height} svgRef={exportSvgRef} /></div>
    <header className="presentation-topbar"><div><strong>{settings.title || project.name}</strong><small>发展史演示，共 {sequence.beats.length} 个演示场次</small></div><button onClick={() => setDebugOpen(value => !value)}>调试</button><button onClick={() => setSettingsOpen(value => !value)}>设置</button><button data-android-back-dismiss onClick={onClose}>退出</button></header>
    {debugOpen && debugState && <aside className="presentation-debug" aria-label="演示调试信息"><strong>演示诊断</strong><span>演示时间：{time.toFixed(3)} 秒</span><span>当前阶段：{debugState.currentBeat?.beatId ?? '停留或结束'}</span><span>日期 / 类型：{debugState.historyDate}，{debugState.currentBeat?.type ?? '-'}</span><span>线路：{debugState.currentBeat?.lineId ?? '-'}</span><span>阶段进度：{getBeatLocalProgress(debugState.currentBeat, time).toFixed(4)}</span><span>线路展开：{debugState.globalRevealProgress.toFixed(4)}</span><span>当前区间：{debugSegment?.[0] ?? '-'}</span><span>区间展开：{debugSegment?.[1].revealProgress.toFixed(4) ?? '-'}</span><span>线段偏移：{debugSegment ? (debugSegment[1].strokeDashoffset * 1000).toFixed(1) : '-'}</span><span>帧率 / 帧间隔：{frameStats.fps.toFixed(1)} / {frameStats.deltaMs.toFixed(1)} 毫秒</span></aside>}
    <footer className="presentation-controls"><button className="presentation-play" onClick={() => { if (time >= sequence.duration) setTime(0); setPlaying(value => !value) }}>{playing ? '暂停' : '▶ 播放'}</button><input aria-label="演示进度" type="range" min="0" max={Math.max(.001, sequence.duration)} step="0.001" value={time} onInput={event => { setPlaying(false); setTime(Number(event.currentTarget.value)) }} /><span>{formatClock(time)} / {formatClock(sequence.duration)}</span><button onClick={() => { setPlaying(false); setTime(0) }}>■ 停止</button></footer>
    {settingsOpen && <aside className="presentation-settings"><div className="presentation-sheet-handle" /><h2>发展史设置</h2>
      <div className="presentation-setting-grid"><label>开始日期<input type="date" value={settings.startDate} onChange={event => update({ startDate: event.currentTarget.value })} /></label><label>结束日期<input type="date" value={settings.endDate} onChange={event => update({ endDate: event.currentTarget.value })} /></label><label>线路生长速度（km/s）<input type="number" min=".1" max="10" step=".1" value={settings.growthSpeedKmPerSecond} onChange={event => update({ growthSpeedKmPerSecond: Math.max(.1, Math.min(10, Number(event.currentTarget.value) || 1.5)) })} /><small>线路在发展史中每秒延伸的实际公里数。</small></label><label>阶段结束停留（秒）<input type="number" min="0" max="10" step=".1" value={settings.pauseDuration} onChange={event => update({ pauseDuration: Number(event.currentTarget.value) || 0 })} /><small>每次建设完成后，静止多久进入下一阶段。</small></label><label>视野大小（地图单位）<input aria-label="视野大小" type="number" min="100" max="20000" step="50" value={Math.round(settings.cameraViewWidth)} onChange={event => setCameraViewWidth(Number(event.currentTarget.value) || 1000)} /><small>播放时镜头继续跟随建设位置，只固定可见范围大小；也可在画面上滚轮或双指调整。</small></label><label>镜头<select value={settings.cameraMode} onChange={event => update({ cameraMode: event.currentTarget.value as PresentationSettings['cameraMode'] })}><option value="fixed">固定全图</option><option value="follow">跟随建设进度</option></select><small>跟随建设进度会把当前建设位置保持在画面中心附近。</small></label><label>帧率<select value={settings.fps} onChange={event => update({ fps: Number(event.currentTarget.value) as 30 | 60 })}><option value="30">30 fps</option><option value="60">60 fps</option></select></label><label>视频尺寸<select value={settings.resolution} onChange={event => update({ resolution: event.currentTarget.value as PresentationSettings['resolution'] })}><option value="1920x1080">1920 × 1080 横屏</option><option value="1080x1920">1080 × 1920 竖屏</option><option value="1280x720">1280 × 720 横屏</option></select></label><label>视频格式<select disabled={!formats.length} value={formatIndex} onChange={event => setFormatIndex(Number(event.currentTarget.value))}>{formats.length ? formats.map((format, index) => <option key={format.mimeType} value={index}>{format.label}</option>) : <option>当前浏览器不支持</option>}</select></label></div>
      <div className="presentation-checks"><label><input type="checkbox" checked={settings.overviewAfterEachPhase} onChange={event=>update({overviewAfterEachPhase:event.currentTarget.checked})}/>每个开通阶段后展示全景</label><label>全景停留（秒）<input aria-label="全景停留" type="number" min="0" max="20" step=".1" value={settings.overviewHoldDuration} onChange={event=>update({overviewHoldDuration:Math.max(0,Number(event.currentTarget.value)||0)})}/></label><label><input type="checkbox" checked={settings.showLabels} onChange={event => update({ showLabels: event.currentTarget.checked })} />站名</label><label><input type="checkbox" checked={settings.showForeignStationNames} onChange={event => update({ showForeignStationNames: event.currentTarget.checked })} />外文站名</label><label><input type="checkbox" checked={settings.showDate} onChange={event => update({ showDate: event.currentTarget.checked })} />日期</label><label><input type="checkbox" checked={settings.showOperatingLength} onChange={event => update({ showOperatingLength: event.currentTarget.checked })} />运营里程</label><label><input type="checkbox" checked={settings.showStationCount} onChange={event => update({ showStationCount: event.currentTarget.checked })} />车站数量</label><label><input type="checkbox" checked={settings.showBackground} onChange={event => update({ showBackground: event.currentTarget.checked })} />底图</label><label><input type="checkbox" checked={settings.showLegend} onChange={event => update({ showLegend: event.currentTarget.checked })} />线路图例</label></div>
      <label className="presentation-title-field">标题<input value={settings.title} placeholder={project.name} onChange={event => update({ title: event.currentTarget.value })} /></label><button className="primary presentation-export" disabled={exporting || !sequence.beats.length || !formats.length} onClick={exportVideo}>{exporting ? `导出中 ${Math.round(exportProgress * 100)}%` : '导出视频'}</button>{lastVideo&&<button className="presentation-share" onClick={()=>void shareBlob(lastVideo.filename,lastVideo.blob).catch(error=>setMessage(error instanceof Error?error.message:'分享失败'))}>分享最近生成的视频</button>}{message && <p className="presentation-message">{message}</p>}
    </aside>}
  </div>
}
function formatClock(value: number) { const minutes = Math.floor(value / 60), seconds = Math.floor(value % 60); return `${minutes}:${seconds.toString().padStart(2, '0')}` }
