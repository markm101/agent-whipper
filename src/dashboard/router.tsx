import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const NAVIGATE = 'aw:navigate'

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(NAVIGATE, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAVIGATE, listener)
  }
}

export const usePathname = () => useSyncExternalStore(subscribe, () => window.location.pathname)

export function navigate(to: string) {
  if (to === window.location.pathname) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAVIGATE))
  window.scrollTo(0, 0)
  // A screen reader lands on the new page's heading, as it would after a full load
  requestAnimationFrame(() => document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }))
}

/** A real link. Plain left clicks stay in the app; anything else (new tab, download) is the browser's. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (rest.target && rest.target !== '_self') return
    if (new URL(href, window.location.href).origin !== window.location.origin) return
    e.preventDefault()
    navigate(href)
  }
  return <a href={href} onClick={click} {...rest} />
}
