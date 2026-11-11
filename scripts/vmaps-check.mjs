// One-command health check for Vmaps on your VM:   npm run vmaps:check      (or: node scripts/vmaps-check.mjs "Place name")
// Tests the same code the agent uses: place search, address lookup, nearby places, a route and a map tile.
// Exit code 0 = everything works, 1 = something failed (the message says what to fix).
import { vmapsConfig, geocode, reverseGeocode, searchNearby, route, getTile, fmtDist } from '../lib/vmaps/core.ts';

const place = process.argv.slice(2).join(' ').trim() || 'Connaught Place, New Delhi';
const cfg = vmapsConfig();
const on = (v) => (v ? 'yes (own server)' : 'no (public OpenStreetMap services)');

console.log('Vmaps check\n');
console.log(`Mode:           ${cfg.offline ? 'OFFLINE (only your own servers)' : 'online with cache (public servers + your own, if set)'}`);
console.log(`Own place search: ${on(cfg.local.nominatim || cfg.local.photon)}`);
console.log(`Own nearby:       ${on(cfg.local.overpass)}`);
console.log(`Own routing:      ${on(cfg.local.osrmCar)}`);
console.log(`Own map tiles:    ${on(cfg.local.tiles)}\n`);

let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const msg = await fn();
    console.log(`  OK    ${name} (${Date.now() - t0} ms): ${msg}`);
    return true;
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

let here = null;
await step('place search', async () => {
  const { places } = await geocode(place, 1);
  if (!places[0]) throw new Error(`nothing found for "${place}"`);
  here = places[0];
  return `${here.name} at ${here.lat}, ${here.lon}`;
});
if (here) {
  await step('address lookup', async () => (await reverseGeocode(here.lat, here.lon)).place.address || '(no address)');
  await step('nearby places', async () => {
    const r = await searchNearby(here, 'cafe', 1500, 5);
    if (!r.places.length) throw new Error('the server answered, but found no cafes (try another place)');
    return `${r.places.length} cafes, nearest: ${r.places[0].name} (${fmtDist(r.places[0].distM ?? 0)})`;
  });
  await step('route', async () => {
    const to = { name: 'Test point', lat: here.lat + 0.02, lon: here.lon + 0.02 };
    const r = await route(here, to, 'driving');
    return `${r.km} km, about ${r.min} min, ${r.steps.length} steps`;
  });
  const z = 12, n = 2 ** z, x = Math.floor(((here.lon + 180) / 360) * n);
  const lat = (here.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  await step('map tile', async () => {
    const t = await getTile(z, x, y);
    return `${t.bytes.length} bytes${t.stale ? ' (old copy from disk)' : ''}`;
  });
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll good: Vmaps is ready.');
if (failed) {
  console.log('Tips: 1) the VM needs outbound internet (HTTPS) for the public servers, or run your own servers (see VMAPS.md);');
  console.log('      2) if you set VMAPS_OFFLINE=1, every service you need must have its own VMAPS_*_URL;');
  console.log('      3) the first run is slow because public servers allow only about 1 request per second.');
  process.exit(1);
}
