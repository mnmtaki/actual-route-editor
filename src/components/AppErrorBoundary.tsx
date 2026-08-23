import { Component, type ErrorInfo, type ReactNode } from 'react'

interface BoundaryState { error: Error | null; stack: string }

export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, stack: '' }
  static getDerivedStateFromError(error: Error): BoundaryState { return { error, stack: '' } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, stack: info.componentStack ?? '' })
    console.error('Actual Route Editor render failed', error, info)
  }
  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error" role="alert">
      <h1>应用加载失败</h1>
      <p>Actual Route Editor failed to start</p>
      <pre>{this.state.error.stack || this.state.error.message}{this.state.stack}</pre>
      <button onClick={() => location.reload()}>重新加载</button>
    </main>
  }
}
