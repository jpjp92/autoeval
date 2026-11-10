import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import nextConfig from '../next.config.ts';

const require = createRequire(import.meta.url);
const bytes = require('next/dist/compiled/bytes');
const { getCloneableBody } = require('next/dist/server/body-streams');
const { proxyRequest } = require('next/dist/server/lib/router-utils/proxy-request');

test('upload bodies above the former 10MB default remain intact', async () => {
  const chunk = Buffer.alloc(1024 * 1024, 97);
  const request = Readable.from(Array.from({ length: 12 }, () => chunk));
  request.url = '/api/ingestion/upload';
  const configuredLimit = nextConfig.experimental?.proxyClientMaxBodySize;
  const limit = typeof configuredLimit === 'string' ? bytes.parse(configuredLimit) : configuredLimit;
  const cloned = getCloneableBody(request, limit).cloneBodyStream();
  let received = 0;
  for await (const data of cloned) received += data.length;
  assert.equal(received, 12 * chunk.length);
});

test('sync API responses can take longer than 30 seconds', { timeout: 60_000 }, async () => {
  const timers = new Set();
  const upstream = http.createServer((_request, response) => {
    timers.add(setTimeout(() => response.end('completed'), 31_000));
  });
  const listen = server => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const proxy = http.createServer((request, response) => {
    proxyRequest(request, response, {
      protocol: 'http:', hostname: '127.0.0.1',
      port: String(upstream.address().port), pathname: '/slow', query: {},
    }, undefined, undefined, nextConfig.experimental?.proxyTimeout).catch(() => {
      // Next.js writes a 500 response when the proxy times out.
    });
  });

  try {
    await listen(upstream);
    await listen(proxy);
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/api/slow`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'completed');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    for (const server of [proxy, upstream]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
