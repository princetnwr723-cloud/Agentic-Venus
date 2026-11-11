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
      const q = await body(req);
      if (q.includes('contact%3Awebsite') || q.includes('contact:website')) {
        // a contact-only search: the server has dropped places with no contact tag
        return json({ elements: [
          { type: 'node', lat: 28.6316, lon: 77.2168, tags: { amenity: 'dentist', name: 'Smile Dental', website: 'smiledental.example.in', phone: '+91 98765 43210' } },
          { type: 'node', lat: 28.6320, lon: 77.2170, tags: { amenity: 'dentist', name: 'Evil Clinic', website: 'javascript:alert(1)', email: 'not an email', phone: '12' } },
          { type: 'node', lat: 28.6330, lon: 77.2180, tags: { amenity: 'dentist', name: 'Quiet Clinic', 'contact:email': 'Hello@Quiet.example.in', 'contact:website': 'https://quiet.example.in/' } },
        ] });
      }
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

// ---------------------------------------------------------------- leads

test('nearby: contact details are read from the map tags and cleaned', async () => {
  const r = await core.searchNearby({ lat: 28.6315, lon: 77.2167 }, 'dental clinic', 2000, 10, { contactOnly: true });
  assert.equal(r.label, 'dentist');
  const by = Object.fromEntries(r.places.map((p) => [p.name, p]));
  assert.equal(by['Smile Dental'].website, 'https://smiledental.example.in/');
  assert.equal(by['Smile Dental'].phone, '+91 98765 43210');
  assert.equal(by['Quiet Clinic'].email, 'hello@quiet.example.in');
  assert.equal(by['Quiet Clinic'].website, 'https://quiet.example.in/');
  // unsafe or broken values are dropped, and a place left with no contact is not a lead
  assert.equal(by['Evil Clinic'], undefined);
});

test('contact value cleaners', () => {
  assert.equal(core.cleanWebsite('javascript:alert(1)'), undefined);
  assert.equal(core.cleanWebsite('ftp://x.example.com'), undefined);
  assert.equal(core.cleanWebsite('http://user:pw@x.example.com'), undefined);
  assert.equal(core.cleanWebsite('www.shop.example.in; https://other.example'), 'https://www.shop.example.in/');
  assert.equal(core.cleanEmail('mailto:Info@Shop.IN;x@y.z'), 'info@shop.in');
  assert.equal(core.cleanEmail('a b@c.com'), undefined);
  assert.equal(core.cleanPhone('+91-98765 43210; 0141 2222'), '+91-98765 43210');
  assert.equal(core.cleanPhone('123'), undefined);
});

const HOME = `<html><head><title>Smile Dental &amp; Implant Centre | Jaipur</title>
<meta name='description' content="Family dentist in Jaipur: braces, implants and root canal. Open six days a week.">
</head><body><a href="/contact-us">Contact</a><a href="tel:+911412222333">Call</a>
<img src="logo@2x.png"> sentry@sentry.io you@example.com <a href="mailto:Care@smiledental.example.in?subject=hi">mail</a></body></html>`;

test('parseSite: one line about the business, real emails only, phone and contact page', () => {
  const r = core.parseSite(HOME, 'https://smiledental.example.in/');
  assert.match(r.about, /^Family dentist in Jaipur/);
  assert.deepEqual(r.emails, ['care@smiledental.example.in']);
  assert.equal(r.phone, '+911412222333');
  assert.equal(r.contactUrl, 'https://smiledental.example.in/contact-us');
  const t = core.parseSite('<title>Acme Plumbing Services</title><h1>x</h1>', 'https://acme.example.com');
  assert.equal(t.about, 'Acme Plumbing Services');
  assert.deepEqual(t.emails, []);
});

test('enrichLeads: fills gaps, keeps map values, survives bad sites, caches', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes('down.example')) throw new Error('HTTP 503');
    if (url.endsWith('/contact')) return '<p>write to <a href="mailto:hello@later.example.in">us</a></p>';
    if (url.includes('later.example')) return '<title>Later Law Associates, Jaipur</title><a href="/contact">Contact us</a>';
    return HOME;
  };
  const leads = [
    { name: 'A', lat: 1, lon: 1, website: 'https://a-site.example.in/', email: 'osm@a.example.in' },
    { name: 'B', lat: 2, lon: 2, website: 'https://down.example.in/' },
    { name: 'C', lat: 3, lon: 3, website: 'https://later.example.in/' },
    { name: 'D', lat: 4, lon: 4 },
  ];
  const r = await core.enrichLeads(leads, fetcher);
  assert.equal(r.read, 2);
  assert.equal(r.failed, 1);
  assert.equal(r.places[0].email, 'osm@a.example.in', 'the value from the map wins');
  assert.match(r.places[0].about, /Family dentist/);
  assert.equal(r.places[0].phone, '+911412222333');
  assert.equal(r.places[1].about, undefined);
  assert.equal(r.places[2].email, 'hello@later.example.in', 'found on the contact page');
  assert.equal(r.places[3].website, undefined);
  assert.equal(leads[0].about, undefined, 'input is not changed');
  const before = calls.length;
  await core.enrichLeads([leads[0], leads[2]], fetcher);
  assert.equal(calls.length, before, 'second run is served from the cache');
});

test('leads block: valid JSON, short enough, cannot break out of its fence', () => {
  const long = (i) => ({
    name: `Clinic ${i} \`\`\` x`, lat: 28.6 + i / 1000, lon: 77.2, distM: 100 * i, address: 'A very long street name '.repeat(8), phone: `+91 98765 4321${i}`,
    website: `https://clinic${i}.example.in/`, email: `care${i}@clinic${i}.example.in`, about: 'We do many things for many people in the city. '.repeat(6),
  });
  const f = core.vleadsFence('dentist leads near Jaipur', Array.from({ length: 12 }, (_, i) => long(i)));
  assert.ok(f.length <= 3800, `fence is ${f.length} characters`);
  const m = /^```vleads\n([\s\S]*)\n```$/.exec(f);
  assert.ok(m);
  const j = JSON.parse(m[1]);
  assert.ok(j.leads.length >= 6);
  assert.ok(!m[1].includes('`'));
});

test('new business categories are understood', async () => {
  for (const w of ['advocate', 'chartered accountant', 'property dealer', 'coaching centre', 'diagnostic centre', 'factory']) {
    await core.searchNearby({ lat: 28.6315, lon: 77.2167 }, w, 500, 1).catch((e) => assert.doesNotMatch(String(e.message), /do not know the category/));
  }
});

test('CSV: quoted, formula-safe, Excel-friendly', async () => {
  const { toCsv, csvCell } = await import('../../lib/vmaps/csv.ts');
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('+91 98765 43210'), '"+91 98765 43210"');
  assert.equal(csvCell('line\nbreak, "quoted"'), '"line break, ""quoted"""');
  const csv = toCsv([{ name: 'Smile, Dental', lat: 1.5, lon: 2.5, phone: '+91 98765 43210', email: 'a@b.in', distM: 120 }]);
  assert.ok(csv.startsWith('\uFEFF"Name","Phone"'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^"Smile, Dental","\+91 98765 43210","a@b\.in"/);
  assert.match(lines[1], /openstreetmap\.org/);
});
