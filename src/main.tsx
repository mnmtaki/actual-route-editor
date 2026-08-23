import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { BUILD_VERSION } from './build'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './styles.css'

declare global { interface Window { __actualRouteShowFatal?: (reason: unknown) => void; __ACTUAL_ROUTE_BUILD__?: string } }
window.__ACTUAL_ROUTE_BUILD__ = BUILD_VERSION
console.info(`Actual Route Editor build: ${BUILD_VERSION}`)
if (typeof globalThis.structuredClone !== 'function') globalThis.structuredClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const rootElement = document.getElementById('root')
if (!rootElement) { window.__actualRouteShowFatal?.(new Error('找不到 #root 挂载节点')); throw new Error('Actual Route Editor: #root not found') }
try { createRoot(rootElement).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>) } catch (error) { window.__actualRouteShowFatal?.(error); throw error }
