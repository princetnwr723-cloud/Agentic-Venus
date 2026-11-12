/** A tiny in-memory Firestore: enough for the calls the store makes. */
export function fakeDb() {
  const data = new Map();
  const snap = (path) => ({ exists: data.has(path), id: path.split("/").pop(), data: () => (data.has(path) ? structuredClone(data.get(path)) : undefined) });
  const docRef = (path) => ({
    path,
    get: async () => snap(path),
    set: async (d, o) => { data.set(path, o?.merge ? { ...(data.get(path) ?? {}), ...structuredClone(d) } : structuredClone(d)); },
    update: async (d) => { if (!data.has(path)) throw new Error("NOT_FOUND " + path); data.set(path, { ...data.get(path), ...structuredClone(d) }); },
    delete: async () => { data.delete(path); },
    collection: (n) => colRef(path + "/" + n),
  });
  const colRef = (path, filters = [], order = null, lim = Infinity) => ({
    doc: (id) => docRef(path + "/" + (id ?? Math.random().toString(36).slice(2))),
    where: (f, op, v) => colRef(path, [...filters, [f, op, v]], order, lim),
    orderBy: (f, dir = "asc") => colRef(path, filters, [f, dir], lim),
    limit: (n) => colRef(path, filters, order, n),
    get: async () => {
      let docs = [...data.keys()].filter((k) => k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/")).map((k) => ({ k, v: data.get(k) }));
      for (const [f, op, v] of filters) docs = docs.filter(({ v: x }) => (op === "<" ? x[f] < v : op === ">" ? x[f] > v : x[f] === v));
      if (order) docs.sort((a, b) => (order[1] === "desc" ? b.v[order[0]] - a.v[order[0]] : a.v[order[0]] - b.v[order[0]]));
      return { docs: docs.slice(0, lim).map(({ k }) => snap(k)) };
    },
  });
  let chain = Promise.resolve();
  const db = {
    collection: (n) => colRef(n),
    // Firestore runs conflicting transactions one after the other (it retries the loser); a queue gives the same result
    runTransaction: (fn) => {
      const run = async () => {
        const writes = [];
        const tx = { get: async (r) => r.get(), set: (r, d, o) => writes.push(() => r.set(d, o)), update: (r, d) => writes.push(() => r.update(d)), delete: (r) => writes.push(() => r.delete()) };
        const out = await fn(tx);
        for (const w of writes) await w();
        return out;
      };
      const next = chain.then(run, run);
      chain = next.catch(() => {});
      return next;
    },
  };
  return { db, data };
}

