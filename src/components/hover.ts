import { useSyncExternalStore } from 'react'

/** tiny external store for the hover tooltip (kept out of React state to avoid scene re-renders) */
let state = { name: null as string | null, x: 0, y: 0 }
const subs = new Set<() => void>()
export function setHover(name: string | null, x: number, y: number) {
  if (name === state.name && Math.abs(x - state.x) < 2 && Math.abs(y - state.y) < 2) return
  state = { name, x, y }
  subs.forEach((f) => f())
  document.body.style.cursor = name ? 'pointer' : ''
}
export const useHover = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => state)
