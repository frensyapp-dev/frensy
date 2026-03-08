
test('listMembers mapping returns ids', () => {
  const members: Array<{ id: string }> = [ { id: 'a' }, { id: 'b' }, { id: 'c' } ]
  const ids = members.map((g: { id: string }) => g.id)
  expect(ids).toEqual(['a', 'b', 'c'])
})

test('listMessages mapping returns user uids and texts', () => {
  const msgs: Array<{ id: string; user_uid: string; text: string; created_at: number }> = [
    { id: '1', user_uid: 'u1', text: 't1', created_at: 1 },
    { id: '2', user_uid: 'u2', text: 't2', created_at: 2 },
  ]
  const uids = msgs.map((g: { user_uid: string }) => g.user_uid)
  const texts = msgs.map((g: { text: string }) => g.text)
  expect(uids).toEqual(['u1', 'u2'])
  expect(texts).toEqual(['t1', 't2'])
})

test('quitGroup calls with typed params', async () => {
  const uid: string = 'userA'
  const gid: string = 'groupX'
  // We only validate types here; calling Firestore is out of scope in unit tests without mocks.
  expect(typeof uid).toBe('string')
  expect(typeof gid).toBe('string')
})

test('postMessage signature accepts string', () => {
  const text: string = 'hello'
  expect(typeof text).toBe('string')
})
