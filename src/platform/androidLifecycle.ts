import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { StatusBar, Style } from '@capacitor/status-bar'

export async function initializeAndroidShell() {
  if (Capacitor.getPlatform() !== 'android') return
  document.documentElement.classList.add('capacitor-android')
  await StatusBar.setStyle({ style: Style.Light }).catch(() => undefined)
  await StatusBar.setBackgroundColor({ color: '#15191a' }).catch(() => undefined)
  await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined)
  await Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => undefined)
  await CapacitorApp.addListener('appStateChange', ({ isActive }) => document.documentElement.classList.toggle('app-in-background', !isActive))
  await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    const openDetails = [...document.querySelectorAll<HTMLDetailsElement>('details[open]')].at(-1)
    if (openDetails) { openDetails.open = false; return }
    if (document.querySelector('.context-sheet')) { window.dispatchEvent(new Event('actual-route-close-context')); return }
    const dismiss = document.querySelector<HTMLElement>('[data-android-back-dismiss]')
    if (dismiss) { dismiss.click(); return }
    if (canGoBack) history.back(); else CapacitorApp.exitApp()
  })
}
