import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCounts } from './.build/preload/unread-reader.js'
import { sanitize, setUnread, unreadFor, totalDirect, forgetUnread } from './.build/main/unread.js'

test('sums unread across chats', () => {
  assert.deepEqual(computeCounts([{ unreadCount: 3 }, { unreadCount: 4 }]), {
    direct: 7, muted: 0, markedUnread: 0,
  })
})

test('archived chats are excluded', () => {
  assert.deepEqual(computeCounts([{ unreadCount: 5, archive: true }, { unreadCount: 2 }]), {
    direct: 2, muted: 0, markedUnread: 0,
  })
})

test('muted chats are counted separately', () => {
  assert.deepEqual(computeCounts([{ unreadCount: 5, muteExpiration: 1893456000 }]), {
    direct: 0, muted: 5, markedUnread: 0,
  })
  assert.deepEqual(computeCounts([{ unreadCount: 6, isAutoMuted: true }]), {
    direct: 0, muted: 6, markedUnread: 0,
  })
})

test('muteExpiration of 0 means NOT muted', () => {
  assert.deepEqual(computeCounts([{ unreadCount: 5, muteExpiration: 0 }]), {
    direct: 5, muted: 0, markedUnread: 0,
  })
})

test('negative unreadCount is the manually-marked-unread sentinel', () => {
  assert.deepEqual(computeCounts([{ unreadCount: -1 }]), {
    direct: 0, muted: 0, markedUnread: 1,
  })
  assert.deepEqual(computeCounts([{ unreadCount: -1, archive: true }]), {
    direct: 0, muted: 0, markedUnread: 0,
  })
})

test('garbage values are ignored', () => {
  assert.deepEqual(
    computeCounts([{ unreadCount: 'x' }, { unreadCount: null }, { unreadCount: undefined }, {}]),
    { direct: 0, muted: 0, markedUnread: 0 },
  )
})

test('an unreadable count is never reported as zero', () => {
  // 'db-absent'/'error' must stay distinct from "caught up", or a WhatsApp
  // storage change silently looks like an empty inbox forever.
  assert.equal(sanitize({ status: 'nonsense' }).status, 'error')
  assert.equal(sanitize(null).status, 'error')
  assert.equal(sanitize({ status: 'ok', direct: -5 }).direct, 0)
})

test('launcher total excludes muted', () => {
  setUnread('a', sanitize({ status: 'ok', direct: 2, muted: 9 }))
  setUnread('b', sanitize({ status: 'ok', direct: 3, muted: 4 }))
  assert.equal(totalDirect(['a', 'b']), 5)
  forgetUnread('a')
  assert.equal(unreadFor('a').status, 'db-absent')
  assert.equal(totalDirect(['a', 'b']), 3)
})
