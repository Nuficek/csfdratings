'use strict';

/** Minimal in-memory TTL cache with a soft size cap (LRU-ish eviction). */
class TTLCache {
  constructor(maxEntries = 5000) {
    this.map = new Map();
    this.max = maxEntries;
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, e);
    return e.val;
  }
  set(key, val, ttl) {
    if (this.map.size >= this.max) {
      // evict oldest
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, { val, exp: Date.now() + ttl });
  }
}

/** Run an async fn with a global concurrency cap. */
function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

module.exports = { TTLCache, createLimiter };
