// The audience form used to offer every stored Meta connection. On 2026-09-09
// that meant 14 accounts of which 13 had a rejected credential: picking one got
// you to the server action, which refused with CONNECTION_INACTIVE. Offer only
// what a real sync could use — plus whatever this config already points at, so
// an existing selection never silently disappears from its own form.
import { describe, expect, it } from 'vitest'

type Conn = { id: string; usable: boolean }

/** Mirrors selectableConnections in meta-audience-form.tsx. */
const selectable = (connections: Conn[], connectionId: string): Conn[] =>
  connections.filter((item) => item.usable || item.id === connectionId)

const ALL: Conn[] = [
  { id: 'usable-1', usable: true },
  { id: 'broken-1', usable: false },
  { id: 'broken-2', usable: false },
]

describe('which Meta connections the audience form offers', () => {
  it('offers only usable connections when nothing is selected yet', () => {
    expect(selectable(ALL, '').map((c) => c.id)).toEqual(['usable-1'])
  })

  it('keeps a saved-but-now-broken connection listed, so the config still shows what it points at', () => {
    expect(selectable(ALL, 'broken-2').map((c) => c.id)).toEqual(['usable-1', 'broken-2'])
  })

  it('does not duplicate the selected connection when it is also usable', () => {
    expect(selectable(ALL, 'usable-1').map((c) => c.id)).toEqual(['usable-1'])
  })

  it('offers nothing when no connection is usable and none is saved — the empty state is honest', () => {
    expect(selectable([{ id: 'broken-1', usable: false }], '')).toEqual([])
  })
})
