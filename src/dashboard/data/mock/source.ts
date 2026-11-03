import type { AttemptDetail, Board } from '../../../shared/api.ts'
import type { BoardSource } from '../source.ts'
import { settle } from '../../../server/domain/commands.ts'
import type { World } from '../../../server/domain/records.ts'
import { attemptDetailOf, boardOf } from '../../../server/domain/view.ts'
import { initialWorld } from './fixtures.ts'
import { MOCK_CONFIG } from './runner.ts'
import { TIMELINE } from './timeline.ts'

export interface MockOptions {
  /** ms between timeline events. After the last one the board still refreshes at this pace. */
  every?: number
  now?: () => number
}

export function createMockSource({ every = 3500, now = Date.now }: MockOptions = {}): BoardSource {
  let world: World = initialWorld(now())
  let next = 0
  let board: Board = boardOf(world, now())
  let details = new Map<string, AttemptDetail | null>()
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined

  const tick = () => {
    const at = now()
    const event = TIMELINE[next]
    world = structuredClone(world)
    if (event) {
      event.run(world, at)
      next++
    }
    settle(world, at, MOCK_CONFIG)
    board = boardOf(world, at)
    details = new Map()
    for (const listener of listeners) listener()
  }

  return {
    current: () => board,
    subscribe(listener) {
      listeners.add(listener)
      timer ??= setInterval(tick, every)
      return () => {
        listeners.delete(listener)
        if (listeners.size || timer === undefined) return
        clearInterval(timer)
        timer = undefined
      }
    },
    attempt(agent, module, attempt) {
      const key = `${agent}/${module}/${attempt}`
      if (!details.has(key)) details.set(key, attemptDetailOf(world, agent, module, attempt))
      return details.get(key) ?? null
    },
  }
}
