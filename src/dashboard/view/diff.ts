// The line diff the change review shows.

export type Line = { kind: 'same' | 'add' | 'del'; text: string }

/** A line diff by longest common subsequence. Big files fall back to showing both versions whole. */
export function lineDiff(before: string, after: string): Line[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out: Line[] = []
  let [i, j] = [0, 0]
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: 'same', text: a[i++]! }), j++
    // Removals before additions, as diffs read
    else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push({ kind: 'del', text: a[i++]! })
    else out.push({ kind: 'add', text: b[j++]! })
  }
  return out
}
