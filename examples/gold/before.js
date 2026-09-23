// cache-server.js v1.4.2
'use strict';

const http = require('http');
const url = require('url');

const DEFAULT_TTL = 60;
const MAX_ENTRIES = 1000;

/**
 * Legacy helper kept for the v1 API. Callers should migrate to Cache#get.
 * Scheduled for removal in v2.
 */
function legacyLookup(store, key) {
  if (!store.has(key)) return null;
  const hit = store.get(key);
  return hit.value;
}

class Cache {
  constructor(ttl, max) {
    this.ttl = ttl || DEFAULT_TTL;
    this.max = max || MAX_ENTRIES;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set(key, value) {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.store.set(key, { value: value, expires: Date.now() + this.ttl * 1000 });
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }
}

function parseBody(req, cb) {
  let body = '';
  req.on('data', function (chunk) { body += chunk; });
  req.on('end', function () {
    try {
      cb(null, JSON.parse(body));
    } catch (err) {
      cb(err);
    }
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function renderBanner(name) {
  return '<h1>' + name + '</h1>';
}

function validateKey(key) {
  if (typeof key !== 'string') return false;
  if (key.length === 0) return false;
  if (key.length > 256) return false;
  return /^[\w:.-]+$/.test(key);
}

const cache = new Cache(DEFAULT_TTL, MAX_ENTRIES);

const server = http.createServer(function (req, res) {
  const parsed = url.parse(req.url, true);
  const key = parsed.query.key;

  if (req.method === 'GET' && parsed.pathname === '/cache') {
    const value = cache.get(key);
    if (value === undefined) return send(res, 404, { error: 'miss' });
    return send(res, 200, { key: key, value: value });
  }

  if (req.method === 'PUT' && parsed.pathname === '/cache') {
    parseBody(req, function (err, data) {
      if (err) return send(res, 400, { error: 'bad json' });
      cache.set(key, data);
      send(res, 201, { ok: true });
    });
    return;
  }

  if (req.method === 'DELETE' && parsed.pathname === '/cache') {
    cache.clear();
    return send(res, 204, {});
  }

  if (parsed.pathname === '/stats') {
    return send(res, 200, cache.stats());
  }

  if (parsed.pathname === '/banner') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(renderBanner('cache-server'));
  }

  send(res, 404, { error: 'not found' });
});

// --- lifecycle ---------------------------------------------------------

function shutdown() {
  console.log('shutting down');
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(8080, function () {
  console.log('cache-server listening on 8080 with a default ttl of ' + DEFAULT_TTL + ' seconds and a max of ' + MAX_ENTRIES + ' entries');
});

module.exports = { Cache, legacyLookup };
