// Vmaps core, tested against small fake map servers on this machine: needs no internet and no keys.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'vmaps-test-'));
process.env.VMAPS_DATA_DIR = dataDir;
process.env.VMAPS_OFFLINE = '1';

const core = await import('../../lib/vmaps/core.ts');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const hits = { search: 0, overpass: 0, route: 0, tile: 0 };
let server;
let base = '';

const body = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b)); });

before(async () => {
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/search') {
      hits.search++;
      if (u.searchParams.get('q') === 'nowhere land') return json([]);
      return json([{ lat: '28.6315', lon: '77.2167', name: 'Connaught Place', type: 'suburb', display_name: 'Connaught Place, New Delhi, India' }]);
    }
    if (u.pathname === '/reverse') return json({ lat: '28.6139', lon: '77.2090', display_name: 'India Gate, New Delhi, India', name: 'India Gate' });
    if (u.pathname === '/overpass') {
      hits.overpass++;
      await body(req);
      return json({ elements: [
        { type: 'node', lat: 28.632, lon: 77.218, tags: { amenity: 'cafe', name: 'Far Cafe' } },
        { type: 'node', lat: 28.6316, lon: 77.2168, tags: { amenity: 'cafe' } },
        { type: 'way', center: { lat: 28.6318, lon: 77.2169 }, tags: { amenity: 'cafe', name: 'Near Cafe', opening_hours: '09:00-22:00', 'addr:street': 'Janpath' } },
        { type: 'node', lat: 28.6318, lon: 77.2169, tags: { amenity: 'cafe', name: 'Near Cafe' } },
      ] });
    }
    if (u.pathname.startsWith('/route/v1/')) {
      hits.route++;
      const coordinates = Array.from({ length: 400 }, (_, i) => [77.2 + i * 0.0005, 28.6 + i * 0.0005]);
      return json({ code: 'Ok', routes: [{ distance: 12345, duration: 1500, geometry: { coordinates }, legs: [{ steps: [
        { distance: 800, name: 'Janpath', maneuver: { type: 'depart' } },
        { distance: 10, name: '', maneuver: { type: 'continue', modifier: 'straight' } },
        { distance: 3000, name: 'Ring Road', maneuver: { type: 'turn', modifier: 'left' } },
        { distance: 0, name: '', maneuver: { type: 'arrive' } },
      ] }] }] });
    }
    if (/^\/tiles\/\d+\/\d+\/\d+\.png$/.test(u.pathname)) {
      hits.tile++;
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.VMAPS_NOMINATIM_URL = base;
  process.env.VMAPS_OVERPASS_URL = `${base}/overpass`;
  process.env.VMAPS_OSRM_URL = base;
  process.env.VMAPS_TILE_URL = `${base}/tiles/{z}/{x}/{y}.png`;
});

after(() => server?.close());

test('coordinates are understood without any server', async () => {
  assert.deepEqual(core.parseLatLon('28.61, 77.20'), { lat: 28.61, lon: 77.2 });
  assert.equal(core.parseLatLon('95, 10'), null);
  assert.equal(core.parseLatLon('Delhi'), null);
  const before = hits.search;
  const r = await core.geocode('28.61,77.20');
  assert.equal(r.places[0].kind, 'point');
  assert.equal(hits.search, before);
});

test('geocode finds a place, then answers from the disk cache', async () => {
  const a = await core.geocode('Connaught Place Delhi');
  assert.equal(a.places[0].name, 'Connaught Place');
  assert.equal(a.places[0].lat, 28.6315);
  const n = hits.search;
  const b = await core.geocode('connaught place delhi');
  assert.equal(b.places[0].name, 'Connaught Place');
  assert.equal(hits.search, n, 'second call must not hit the server');
});

test('geocode with no match returns an empty list, not an error', async () => {
  const r = await core.geocode('nowhere land');
  assert.deepEqual(r.places, []);
  await assert.rejects(() => core.resolvePlace('nowhere land'), /could not find/i);
});

test('resolvePlace accepts objects with coordinates', async () => {
  const p = await core.resolvePlace({ name: 'Home', lat: 28.5, lng: 77.1 });
  assert.deepEqual([p.name, p.lat, p.lon], ['Home', 28.5, 77.1]);
});

test('reverse geocode gives an address', async () => {
  const r = await core.reverseGeocode(28.6139, 77.209);
  assert.match(r.place.address, /India Gate/);
});

test('nearby: named places first, nearest first, duplicates removed', async () => {
  const r = await core.searchNearby({ lat: 28.6315, lon: 77.2167 }, 'coffee shop', 1500, 8);
  assert.equal(r.label, 'cafe');
  assert.deepEqual(r.places.map((p) => p.name).slice(0, 2), ['Near Cafe', 'Far Cafe']);
  assert.equal(r.places.filter((p) => p.name === 'Near Cafe').length, 1);
  assert.ok(r.places[0].distM < r.places[1].distM);
  assert.match(r.places[0].extra, /open: 09:00-22:00/);
  assert.ok(r.places[2].name.startsWith('('), 'unnamed places come last');
});

test('nearby: unknown words are refused, raw OSM tags are allowed, bad tags are not', async () => {
  await assert.rejects(() => core.searchNearby({ lat: 1, lon: 1 }, 'dragon lair'), /do not know the category/);
  await assert.rejects(() => core.searchNearby({ lat: 1, lon: 1 }, 'amenity=cafe"];out;'), /do not know the category/);
  const r = await core.searchNearby({ lat: 28.6315, lon: 77.2167 }, 'amenity=cafe', 1000, 3);
  assert.ok(r.places.length > 0);
});

test('route: distance, time, readable steps, thinned geometry', async () => {
  const from = { name: 'A', lat: 28.6, lon: 77.2 }, to = { name: 'B', lat: 28.7, lon: 77.3 };
  const r = await core.route(from, to, 'car');
  assert.equal(r.mode, 'driving');
  assert.equal(r.km, 12.3);
  assert.equal(r.min, 25);
  assert.ok(r.coords.length <= 100 && r.coords.length > 10);
  assert.deepEqual(r.coords[0], [28.6, 77.2]);
  assert.match(r.steps[0], /^Start on Janpath/);
  assert.ok(r.steps.some((s) => /^Turn left onto Ring Road/.test(s)));
  assert.equal(r.steps.at(-1), 'Arrive at your destination');
  assert.ok(!r.steps.some((s) => s.includes('(10 m)')), 'tiny continue steps are dropped');
});

test('map card block is valid JSON and cannot break out of its fence', () => {
  const f = core.vmapFence({ title: 'Cafes `evil`', markers: [{ name: 'A ``` b', lat: 1.234567, lon: 2.345678, note: 'x' }] });
  const m = /^```vmap\n([\s\S]*)\n```$/.exec(f);
  assert.ok(m);
  const j = JSON.parse(m[1]);
  assert.equal(j.markers[0].lat, 1.23457);
  assert.ok(!m[1].includes('`'));
});

test('tiles are fetched once, stored on disk and served again from disk', async () => {
  const t1 = await core.getTile(5, 17, 11);
  assert.equal(t1.type, 'image/png');
  assert.ok(t1.bytes.equals(PNG));
  const n = hits.tile;
  const t2 = await core.getTile(5, 17, 11);
  assert.ok(t2.bytes.equals(PNG));
  assert.equal(hits.tile, n);
  await assert.rejects(() => core.getTile(3, 99, 0), /bad tile/);
  await assert.rejects(() => core.getTile(25, 0, 0), /bad tile/);
});

test('offline mode with nothing configured explains what to do', async () => {
  const keep = { ...process.env };
  delete process.env.VMAPS_NOMINATIM_URL;
  delete process.env.VMAPS_PHOTON_URL;
  await assert.rejects(() => core.geocode('some brand new place'), /VMAPS_OFFLINE is on/);
  Object.assign(process.env, keep);
});
