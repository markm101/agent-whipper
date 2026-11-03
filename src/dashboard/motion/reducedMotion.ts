// Copied from docs/overview/src/kit/reduced-motion.ts (stageshow kit, MIT), without the stage's still context.
import { useEffect, useState } from 'react'

/** Whether the viewer asked for reduced motion. Motion parts skip their tweens. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}
