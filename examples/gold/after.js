// cache-server.js v2.0.0
'use strict';

const http = require('http');
const { URL } = require('url');
const { performance } = require('perf_hooks');
const log = require('./log');

const DEFAULT_TTL = 300;
const MAX_ENTRIES = 1000;
const SWEEP_MS = 30 * 1000;

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function validateKey(key) {
  if (typeof key !== 'string') return false;
  if (key.length === 0) return false;
  if (key.length > 512) return false;
  return /^[\w:.-]+$/.test(key);
}

class Cache {
  constructor({ ttl = DEFAULT_TTL, max = MAX_ENTRIES } = {}) {
    this.ttl = ttl;
    this.max = max;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (performance.now() > entry.expires) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
      this.evictions++;
      log.debug('evicted %s', oldest);
    }
    this.store.set(key, { value: value, expires: performance.now() + this.ttl * 1000 });
  }

  sweep() {
    const now = performance.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) {
        this.store.delete(key);
      }
    }
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  stats() {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, size: this.store.size };
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBanner(name) {
  return '<h1>' + escapeHtml(name) + '</h1>';
}

const cache = new Cache({ ttl: DEFAULT_TTL, max: MAX_ENTRIES });

const server = http.createServer(async function (req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const key = parsed.searchParams.get('key');

  if (req.method === 'GET' && parsed.pathname === '/cache') {
    const value = cache.get(key);
    if (value === undefined) return send(res, 404, { error: 'miss' });
    return send(res, 200, { key: key, value: value });
  }

  if (req.method === 'PUT' && parsed.pathname === '/cache') {
    try {
      cache.set(key, await readJson(req));
    } catch (err) {
      return send(res, 400, { error: 'bad json: ' + err.message });
    }
    return send(res, 201, { ok: true });
  }

  if (req.method === 'DELETE' && parsed.pathname === '/cache') {
    cache.clear();
    return send(res, 204, {});
  }

  if (parsed.pathname === '/stats') {
    return send(res, 200, cache.stats());
  }

  if (parsed.pathname === '/health') {
    return send(res, 200, { status: '✔ ok', uptime: process.uptime() });
  }

  if (parsed.pathname === '/banner') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(renderBanner('<cache-server> & "friends"'));
  }

  send(res, 404, { error: 'not found' });
});

function shutdown () {
  console.log('shutting down');
  server.close();
}

server.listen(8080, function () {
  console.log('cache-server listening on 8080 with a default ttl of ' + DEFAULT_TTL + ' seconds and a max of ' + MAX_ENTRIES + ' entries (sweep every ' + SWEEP_MS + 'ms)');
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { Cache };
module.exports.default = Cache;
