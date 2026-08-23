import { BUILD_VERSION } from '../build'

export function Toolbar({ canUndo, canRedo, undo, redo, fitAll, zoomSelection, importProject, importTopology, exportProject, exportSvg, importBackground, onNewLine, drawing, onFinish }: {
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; fitAll: () => void; zoomSelection: () => void
  importProject: () => void; importTopology: () => void; exportProject: () => void; exportSvg: () => void; importBackground: () => void; onNewLine: () => void; drawing: boolean; onFinish: () => void
}) {
  return <header className="toolbar direct-toolbar">
    <div className="brand"><span className="brand-mark">AR</span><div><strong>实际走向绘制器</strong><small>线路驱动 · 直接编辑</small><small className="build-version">build: {BUILD_VERSION}</small></div></div>
    <div className="tool-group creation-group"><button className="primary" onClick={drawing ? onFinish : onNewLine}>{drawing ? '完成绘制' : '＋ 新建线路'}</button></div>
    <div className="tool-group mobile-core"><button onClick={undo} disabled={!canUndo}>撤销</button><button onClick={redo} disabled={!canRedo}>重做</button></div>
    <div className="tool-group desktop-tools"><button onClick={fitAll}>适应全部</button><button onClick={zoomSelection}>缩放到选择</button></div>
    <div className="tool-group push-right desktop-tools"><button onClick={importBackground}>底图</button><button onClick={importTopology}>导入拓扑</button><button onClick={importProject}>导入工程</button><button onClick={exportProject}>导出 JSON</button><button onClick={exportSvg}>导出 SVG</button></div>
  </header>
}
