// In-memory Realtime Database fixture. It never loads credentials or makes network calls.
function firebaseFixture(stored) {
  const operations = [];
  const parts = path => path.split('/').filter(Boolean);
  const read = path => parts(path).reduce((value, key) => value?.[key], stored) ?? null;
  function write(path, value) {
    const keys = parts(path);
    const last = keys.pop();
    let parent = stored;
    for (const key of keys) parent = parent[key] ||= {};
    if (value === null) delete parent[last];
    else parent[last] = structuredClone(value);
  }
  const snapshot = value => ({ val: () => structuredClone(value) });
  const database = { ref: path => ({
    once: async () => {
      operations.push({ type: 'read', path });
      return snapshot(read(path));
    },
    update: async changes => {
      operations.push({ type: 'update', path });
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
