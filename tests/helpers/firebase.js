// In-memory Realtime Database fixture. It never loads credentials or makes network calls.
function firebaseFixture(stored) {
  const operations = [];
  let nextPush = 0;
  const parts = path => path.split('/').filter(Boolean);
  const read = path => parts(path).reduce((value, key) => value?.[key], stored) ?? null;
  function write(path, value) {
    const keys = parts(path);
    const last = keys.pop();
    let parent = stored;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      const nextKey = index + 1 < keys.length ? keys[index + 1] : last;
      if (Array.isArray(parent[key]) && !/^\d+$/.test(nextKey)) {
        parent[key] = Object.fromEntries(Object.entries(parent[key]));
      }
      parent = parent[key] ||= {};
    }
    if (value === null) delete parent[last];
    else parent[last] = structuredClone(value);
  }
  const snapshot = value => ({ val: () => structuredClone(value) });
  const database = { ref: path => ({
    push: () => ({ key: `-${String(++nextPush).padStart(19, '0')}` }),
    once: async () => {
      operations.push({ type: 'read', path });
      return snapshot(read(path));
    },
    update: async changes => {
      operations.push({ type: 'update', path, changes: structuredClone(changes), bytes: Buffer.byteLength(JSON.stringify(changes)) });
      for (const [key, value] of Object.entries(changes)) write(`${path}/${key}`, value);
    },
    transaction: async callback => {
      operations.push({ type: 'transaction', path });
      const next = callback(structuredClone(read(path)));
      if (next !== undefined) write(path, next);
      return { committed: next !== undefined, snapshot: snapshot(read(path)) };
    }
  }) };
  return { getDatabase: () => database, stored, operations };
}

module.exports = { firebaseFixture };
