import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lineDiff } from './diff.ts'

test('a line diff keeps shared lines and marks what was added and removed', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), [
    { kind: 'same', text: 'a' },
    { kind: 'del', text: 'b' },
    { kind: 'add', text: 'B' },
    { kind: 'same', text: 'c' },
    { kind: 'add', text: 'd' },
  ])
  assert.deepEqual(lineDiff('', 'x'), [{ kind: 'add', text: 'x' }], 'a new file is all additions')
})
