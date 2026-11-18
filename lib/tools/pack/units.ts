import { family, s, n, fmt, J, type PackTool } from "./core.ts";

const { t, list: UNITS } = family("convert");

type U = [code: string, toBase: number, aliases: string[]];
const CAT: Record<string, { base: string; units: U[] }> = {
  length: { base: "m", units: [
    ["m", 1, ["meter", "meters", "metre", "metres"]], ["km", 1000, ["kilometer", "kilometers", "kilometre", "kilometres", "kms"]], ["cm", 0.01, ["centimeter", "centimeters", "centimetre", "centimetres"]],
    ["mm", 0.001, ["millimeter", "millimeters", "millimetre", "millimetres"]], ["um", 1e-6, ["micrometer", "micron", "microns", "µm"]], ["nm", 1e-9, ["nanometer", "nanometers"]],
    ["mile", 1609.344, ["mi", "miles"]], ["yard", 0.9144, ["yd", "yards"]], ["foot", 0.3048, ["ft", "feet"]], ["inch", 0.0254, ["in", "inches"]],
    ["nmi", 1852, ["nauticalmile", "nautical", "nauticalmiles"]], ["fathom", 1.8288, ["fathoms"]], ["furlong", 201.168, ["furlongs"]], ["league", 4828.032, ["leagues"]],
    ["chain", 20.1168, ["chains"]], ["rod", 5.0292, ["rods", "perch"]], ["lightyear", 9.4607304725808e15, ["ly", "lightyears"]], ["au", 1.495978707e11, ["astronomicalunit"]],
  ] },
  mass: { base: "kg", units: [
    ["kg", 1, ["kilogram", "kilograms", "kilo", "kilos", "kgs"]], ["g", 0.001, ["gram", "grams", "gm", "gms"]], ["mg", 1e-6, ["milligram", "milligrams"]], ["ug", 1e-9, ["microgram", "micrograms", "µg"]],
    ["tonne", 1000, ["t", "tonnes", "metricton", "metrictons", "mt"]], ["pound", 0.45359237, ["lb", "lbs", "pounds"]], ["ounce", 0.028349523125, ["oz", "ounces"]], ["stone", 6.35029318, ["st", "stones"]],
    ["quintal", 100, ["quintals", "qtl"]], ["ton_us", 907.18474, ["shortton", "uston"]], ["ton_uk", 1016.0469088, ["longton", "ukton"]], ["carat", 0.0002, ["ct", "carats"]],
    ["grain", 6.479891e-5, ["grains", "gr"]], ["tola", 0.011664, ["tolas"]],
  ] },
  volume: { base: "l", units: [
    ["l", 1, ["liter", "liters", "litre", "litres", "ltr"]], ["ml", 0.001, ["milliliter", "milliliters", "millilitre", "millilitres", "cc"]], ["m3", 1000, ["cubicmeter", "cubicmetre"]],
    ["gal_us", 3.785411784, ["gallon", "gallons", "gal", "usgallon"]], ["gal_uk", 4.54609, ["imperialgallon", "ukgallon"]], ["quart_us", 0.946352946, ["quart", "quarts", "qt"]],
    ["pint_us", 0.473176473, ["pint", "pints", "pt"]], ["cup_us", 0.2365882365, ["cup", "cups"]], ["floz_us", 0.0295735295625, ["floz", "fluidounce", "fluidounces"]],
    ["tbsp", 0.01478676478125, ["tablespoon", "tablespoons"]], ["tsp", 0.00492892159375, ["teaspoon", "teaspoons"]], ["barrel_oil", 158.987294928, ["barrel", "barrels", "bbl"]],
    ["ft3", 28.316846592, ["cubicfoot", "cubicfeet", "cuft"]], ["in3", 0.016387064, ["cubicinch", "cubicinches", "cuin"]],
  ] },
  area: { base: "m2", units: [
    ["m2", 1, ["sqm", "squaremeter", "squaremeters", "squaremetre"]], ["km2", 1e6, ["sqkm", "squarekilometer", "squarekilometers"]], ["cm2", 1e-4, ["sqcm", "squarecentimeter"]],
    ["mm2", 1e-6, ["sqmm", "squaremillimeter"]], ["hectare", 1e4, ["ha", "hectares"]], ["acre", 4046.8564224, ["acres"]], ["ft2", 0.09290304, ["sqft", "squarefoot", "squarefeet"]],
    ["yd2", 0.83612736, ["sqyd", "squareyard", "squareyards", "gaj"]], ["in2", 6.4516e-4, ["sqin", "squareinch", "squareinches"]], ["mi2", 2589988.110336, ["sqmi", "squaremile", "squaremiles"]],
  ] },
  speed: { base: "mps", units: [
    ["mps", 1, ["ms", "m/s", "meterpersecond"]], ["kmh", 1 / 3.6, ["kph", "km/h", "kmph", "kilometerperhour"]], ["mph", 0.44704, ["milesperhour", "mi/h"]],
    ["knot", 0.5144444444444445, ["knots", "kn", "kt"]], ["fps", 0.3048, ["ft/s", "feetpersecond"]], ["mach", 340.29, ["machnumber"]],
  ] },
  time: { base: "s", units: [
    ["s", 1, ["sec", "secs", "second", "seconds"]], ["ms", 0.001, ["millisecond", "milliseconds", "msec"]], ["us", 1e-6, ["microsecond", "microseconds", "µs"]],
    ["minute", 60, ["min", "mins", "minutes"]], ["hour", 3600, ["h", "hr", "hrs", "hours"]], ["day", 86400, ["d", "days"]], ["week", 604800, ["wk", "weeks"]],
    ["month", 2629800, ["mo", "months"]], ["year", 31557600, ["yr", "yrs", "years"]], ["decade", 315576000, ["decades"]], ["century", 3155760000, ["centuries"]],
  ] },
  data: { base: "bit", units: [
    ["bit", 1, ["bits"]], ["byte", 8, ["bytes", "b"]], ["kb", 8000, ["kilobyte", "kilobytes"]], ["mb", 8e6, ["megabyte", "megabytes"]], ["gb", 8e9, ["gigabyte", "gigabytes", "gig"]],
    ["tb", 8e12, ["terabyte", "terabytes"]], ["pb", 8e15, ["petabyte", "petabytes"]], ["kib", 8192, ["kibibyte"]], ["mib", 8388608, ["mebibyte"]], ["gib", 8589934592, ["gibibyte"]],
    ["tib", 8796093022208, ["tebibyte"]], ["kbit", 1000, ["kilobit", "kilobits", "kbps"]], ["mbit", 1e6, ["megabit", "megabits", "mbps"]], ["gbit", 1e9, ["gigabit", "gigabits", "gbps"]],
  ] },
  energy: { base: "j", units: [
    ["j", 1, ["joule", "joules"]], ["kj", 1000, ["kilojoule", "kilojoules"]], ["cal", 4.184, ["calorie", "calories"]], ["kcal", 4184, ["kilocalorie", "kilocalories", "food calorie"]],
    ["wh", 3600, ["watthour", "watthours"]], ["kwh", 3.6e6, ["kilowatthour", "kilowatthours", "unit", "units"]], ["btu", 1055.05585262, ["btus"]],
    ["ev", 1.602176634e-19, ["electronvolt"]], ["ftlbf", 1.3558179483314004, ["footpound"]], ["therm", 105480400, ["therms"]],
  ] },
  pressure: { base: "pa", units: [
    ["pa", 1, ["pascal", "pascals"]], ["kpa", 1000, ["kilopascal"]], ["bar", 1e5, ["bars"]], ["mbar", 100, ["millibar", "hpa", "hectopascal"]], ["atm", 101325, ["atmosphere", "atmospheres"]],
    ["psi", 6894.757293168, ["poundpersquareinch"]], ["mmhg", 133.322387415, ["millimeterofmercury"]], ["torr", 101325 / 760, ["torrs"]], ["inhg", 3386.389, ["inchofmercury"]],
  ] },
  power: { base: "w", units: [
    ["w", 1, ["watt", "watts"]], ["kw", 1000, ["kilowatt", "kilowatts"]], ["mw", 1e6, ["megawatt", "megawatts"]], ["hp", 745.69987158227, ["horsepower"]],
    ["hp_metric", 735.49875, ["ps", "metrichorsepower"]], ["btuh", 0.29307107, ["btu/h"]], ["ftlbfs", 1.3558179483314004, ["ft-lbf/s"]],
  ] },
  force: { base: "newton", units: [["newton", 1, ["n", "newtons"]], ["kn", 1000, ["kilonewton"]], ["lbf", 4.4482216152605, ["poundforce"]], ["kgf", 9.80665, ["kilogramforce"]], ["dyne", 1e-5, ["dynes"]]] },
  angle: { base: "deg", units: [["deg", 1, ["degree", "degrees", "°"]], ["rad", 180 / Math.PI, ["radian", "radians"]], ["grad", 0.9, ["gradian", "gon"]], ["turn", 360, ["turns", "revolution", "revolutions"]], ["arcmin", 1 / 60, ["arcminute"]], ["arcsec", 1 / 3600, ["arcsecond"]]] },
  frequency: { base: "hz", units: [["hz", 1, ["hertz"]], ["khz", 1e3, ["kilohertz"]], ["mhz", 1e6, ["megahertz"]], ["ghz", 1e9, ["gigahertz"]], ["rpm", 1 / 60, ["revolutionsperminute"]]] },
};

// Aliases -> (category, unit code)
const INDEX = new Map<string, { cat: string; code: string }>();
for (const [cat, { units }] of Object.entries(CAT)) for (const [code, , al] of units) for (const k of [code, ...al]) { const key = k.toLowerCase().replace(/[\s_-]/g, ""); if (!INDEX.has(key)) INDEX.set(key, { cat, code }); }

const TEMP = ["c", "f", "k", "r"] as const;
const TEMP_NAMES: Record<string, string[]> = { c: ["celsius", "centigrade", "°c", "degc"], f: ["fahrenheit", "°f", "degf"], k: ["kelvin"], r: ["rankine"] };
const toC: Record<string, (v: number) => number> = { c: (v) => v, f: (v) => ((v - 32) * 5) / 9, k: (v) => v - 273.15, r: (v) => ((v - 491.67) * 5) / 9 };
const fromC: Record<string, (v: number) => number> = { c: (v) => v, f: (v) => (v * 9) / 5 + 32, k: (v) => v + 273.15, r: (v) => ((v + 273.15) * 9) / 5 };
for (const [k, al] of Object.entries(TEMP_NAMES)) for (const x of [k, ...al]) INDEX.set(x.toLowerCase().replace(/[\s_-]/g, ""), { cat: "temperature", code: k });

const FUEL = { kmpl: 1, mpg_us: 0.425143707, mpg_uk: 0.354006, l100km: 0 };
for (const [x, code] of [["kmpl", "kmpl"], ["kmperliter", "kmpl"], ["kmpl", "kmpl"], ["mpg", "mpg_us"], ["mpgus", "mpg_us"], ["mpguk", "mpg_uk"], ["l100km", "l100km"], ["l/100km", "l100km"], ["lper100km", "l100km"], ["km/l", "kmpl"]] as Array<[string, string]>) INDEX.set(x, { cat: "fuel", code });
const fuelToKmpl = (code: string, v: number) => (code === "l100km" ? (v === 0 ? Infinity : 100 / v) : v * (FUEL as Record<string, number>)[code]);
const fuelFromKmpl = (code: string, v: number) => (code === "l100km" ? (v === 0 ? Infinity : 100 / v) : v / (FUEL as Record<string, number>)[code]);

function convert(value: number, from: string, to: string): { out: number; cat: string; f: string; t: string } {
  const key = (x: string) => x.toLowerCase().replace(/[\s_-]/g, "").replace(/^square|^sq/, (m) => (INDEX.has(x.toLowerCase().replace(/[\s_-]/g, "")) ? "" : m));
  const A1 = INDEX.get(from.toLowerCase().replace(/[\s_-]/g, "")) ?? INDEX.get(key(from));
  const B1 = INDEX.get(to.toLowerCase().replace(/[\s_-]/g, "")) ?? INDEX.get(key(to));
  if (!A1) throw new Error(`Unknown unit "${from}". Try convert.list_units.`);
  if (!B1) throw new Error(`Unknown unit "${to}". Try convert.list_units.`);
  if (A1.cat !== B1.cat) throw new Error(`Cannot convert ${A1.cat} (${from}) to ${B1.cat} (${to}).`);
  if (A1.cat === "temperature") return { out: fromC[B1.code](toC[A1.code](value)), cat: A1.cat, f: A1.code, t: B1.code };
  if (A1.cat === "fuel") return { out: fuelFromKmpl(B1.code, fuelToKmpl(A1.code, value)), cat: A1.cat, f: A1.code, t: B1.code };
  const units = CAT[A1.cat].units;
  const fa = units.find((u) => u[0] === A1.code)![1], fb = units.find((u) => u[0] === B1.code)![1];
  return { out: (value * fa) / fb, cat: A1.cat, f: A1.code, t: B1.code };
}
const show = (v: number) => (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : fmt(parseFloat(v.toPrecision(12))));

t("convert.units", "value:number, from:string, to:string", "Convert any unit: length, mass, volume, area, speed, time, data (MB/GB/GiB), energy, pressure, power, force, angle, frequency, temperature (C/F/K), fuel (km/l, mpg, l/100km). Names or short forms: 'km', 'miles', 'lbs', 'sq ft', 'celsius'.", (a) => { const v = n(a, "value"); const r = convert(v, s(a, "from"), s(a, "to")); return `${fmt(v)} ${s(a, "from")} = ${show(r.out)} ${s(a, "to")}`; }, "unit conversion convert km miles kg pounds celsius fahrenheit gb mb liters gallons feet inches");
t("convert.list_units", "category?:string", "All unit categories and their unit names.", (a) => { const c = s(a, "category", "").toLowerCase(); const cats: Record<string, string> = { ...Object.fromEntries(Object.entries(CAT).map(([k, v]) => [k, v.units.map((u) => u[0]).join(", ")])), temperature: "c, f, k, r", fuel: "kmpl, mpg_us, mpg_uk, l100km" }; if (c && cats[c]) return `${c}: ${cats[c]}`; return Object.entries(cats).map(([k, v]) => `${k}: ${v}`).join("\n"); }, "units categories");
t("convert.temperature", "value:number, from:string, to:string", "Convert temperature between C, F, K and R.", (a) => { const r = convert(n(a, "value"), s(a, "from"), s(a, "to")); if (r.cat !== "temperature") throw new Error("Use C, F, K or R."); return `${show(r.out)}°${r.t.toUpperCase()}`; }, "celsius fahrenheit kelvin");
t("convert.fuel", "value:number, from:string, to:string", "Fuel economy: kmpl, mpg_us, mpg_uk, l100km.", (a) => { const r = convert(n(a, "value"), s(a, "from"), s(a, "to")); return show(r.out); }, "mileage");
t("convert.compare_units", "value:number, from:string", "Show one value in every unit of its category.", (a) => { const from = s(a, "from"); const A1 = INDEX.get(from.toLowerCase().replace(/[\s_-]/g, "")); if (!A1) throw new Error(`Unknown unit "${from}".`); const codes = A1.cat === "temperature" ? [...TEMP] : A1.cat === "fuel" ? Object.keys(FUEL) : CAT[A1.cat].units.map((u) => u[0]); return codes.map((c) => `${c}: ${show(convert(n(a, "value"), A1.code, c).out)}`).join("\n"); }, "all units table");
t("convert.shoe_size", "size:number, from:string, to:string", "Shoe size between India/UK, US men, US women, EU (adult approximation).", (a) => { const v = n(a, "size"); const f = s(a, "from").toLowerCase(), to = s(a, "to").toLowerCase(); const toUk: Record<string, (x: number) => number> = { uk: (x) => x, india: (x) => x, in: (x) => x, us: (x) => x - 1, us_men: (x) => x - 1, us_women: (x) => x - 2.5, eu: (x) => x / 1.5 - 25 / 3 }; const fromUk: Record<string, (x: number) => number> = { uk: (x) => x, india: (x) => x, in: (x) => x, us: (x) => x + 1, us_men: (x) => x + 1, us_women: (x) => x + 2.5, eu: (x) => (x + 25 / 3) * 1.5 }; if (!toUk[f] || !fromUk[to]) throw new Error("Use uk, india, us_men, us_women or eu."); return String(Math.round(fromUk[to](toUk[f](v)) * 2) / 2) + " (approximate: brands differ)"; }, "clothing fashion");
t("convert.cooking", "amount:number, from_unit:string, to_unit:string, ingredient?:string", "Cooking: cups/tbsp/tsp/ml ↔ grams for common ingredients (flour, sugar, butter, rice, oil, milk, honey, salt, ghee, oats, water).", (a) => { const D: Record<string, number> = { flour: 0.53, maida: 0.53, atta: 0.55, sugar: 0.85, brown_sugar: 0.93, powdered_sugar: 0.5, butter: 0.96, ghee: 0.91, rice: 0.78, oil: 0.92, milk: 1.03, honey: 1.42, salt: 1.2, oats: 0.34, water: 1, yogurt: 1.03, curd: 1.03, cocoa: 0.42, cream: 1.0 }; const ing = s(a, "ingredient", "water").toLowerCase().replace(/[\s-]/g, "_"); const dens = D[ing]; if (!dens) throw new Error(`Unknown ingredient "${ing}". Known: ${Object.keys(D).join(", ")}`); const vol = new Map<string, number>([["cup", 236.5882], ["cups", 236.5882], ["tbsp", 14.7868], ["tsp", 4.9289], ["ml", 1], ["l", 1000], ["floz", 29.5735]]); const f = s(a, "from_unit").toLowerCase(), to = s(a, "to_unit").toLowerCase(); const ml = vol.has(f) ? n(a, "amount") * vol.get(f)! : f === "g" || f === "gram" || f === "grams" ? n(a, "amount") / dens : f === "kg" ? (n(a, "amount") * 1000) / dens : f === "oz" ? (n(a, "amount") * 28.3495) / dens : NaN; if (!Number.isFinite(ml)) throw new Error("from_unit: cup, tbsp, tsp, ml, l, floz, g, kg or oz."); const out = vol.has(to) ? ml / vol.get(to)! : to === "g" || to === "gram" || to === "grams" ? ml * dens : to === "kg" ? (ml * dens) / 1000 : to === "oz" ? (ml * dens) / 28.3495 : NaN; if (!Number.isFinite(out)) throw new Error("to_unit: cup, tbsp, tsp, ml, l, floz, g, kg or oz."); return `${show(n(a, "amount"))} ${f} ${ing} ≈ ${show(out)} ${to} (typical density: homes and brands differ a little)`; }, "recipe kitchen baking");
t("convert.paper_size", "name:string", "Paper size in mm / inches: A0-A8, B4-B5, Letter, Legal, Tabloid.", (a) => { const P: Record<string, [number, number]> = { a0: [841, 1189], a1: [594, 841], a2: [420, 594], a3: [297, 420], a4: [210, 297], a5: [148, 210], a6: [105, 148], a7: [74, 105], a8: [52, 74], b4: [250, 353], b5: [176, 250], letter: [215.9, 279.4], legal: [215.9, 355.6], tabloid: [279.4, 431.8] }; const p = P[s(a, "name").toLowerCase()]; if (!p) throw new Error("Known: " + Object.keys(P).join(", ")); return `${p[0]} × ${p[1]} mm = ${(p[0] / 25.4).toFixed(2)} × ${(p[1] / 25.4).toFixed(2)} in; at 300 dpi ${Math.round((p[0] / 25.4) * 300)} × ${Math.round((p[1] / 25.4) * 300)} px`; }, "print a4 document");
t("convert.screen_resolution", "width:number, height:number", "Aspect ratio and megapixels of a resolution.", (a) => { const w = n(a, "width"), h = n(a, "height"); const g = (p: number, q: number): number => (q ? g(q, p % q) : p); const d = g(w, h); return `${w}×${h}: ratio ${w / d}:${h / d}, ${(w * h / 1e6).toFixed(2)} megapixels`; }, "image video aspect ratio");
t("convert.pixels_to_rem", "px:number, base?:number", "px → rem (base 16).", (a) => show(n(a, "px") / n(a, "base", 16)), "css design");
t("convert.rem_to_pixels", "rem:number, base?:number", "rem → px (base 16).", (a) => show(n(a, "rem") * n(a, "base", 16)), "css design");
t("convert.bandwidth_time", "size:number, size_unit:string, speed:number, speed_unit:string", "How long a download / upload takes (e.g. 5 GB at 100 Mbps).", (a) => { const bits = convert(n(a, "size"), s(a, "size_unit"), "bit").out; const bps = convert(n(a, "speed"), s(a, "speed_unit"), "bit").out; if (bps <= 0) throw new Error("speed must be > 0"); const sec = bits / bps; return `${show(sec)} seconds ≈ ${sec >= 3600 ? (sec / 3600).toFixed(2) + " hours" : sec >= 60 ? (sec / 60).toFixed(1) + " minutes" : sec.toFixed(1) + " seconds"}`; }, "internet speed upload download");

// ---- one tool per unit pair: convert.km_to_mile, convert.gb_to_mb ... (so the agent can find the exact one by name)
const pairs: PackTool[] = [];
const kwOf = (cat: string, u: U) => `${cat} ${u[0]} ${u[2].join(" ")}`;
for (const [cat, { units }] of Object.entries(CAT)) {
  for (const A1 of units) for (const B1 of units) {
    if (A1[0] === B1[0]) continue;
    const fa = A1[1], fb = B1[1];
    pairs.push({
      name: `convert.${A1[0]}_to_${B1[0]}`, family: "convert", params: "value:number",
      description: `Convert ${A1[0]} to ${B1[0]} (${cat}).`, keywords: `unit conversion ${kwOf(cat, A1)} ${kwOf(cat, B1)}`,
      run: (a) => { const v = n(a, "value"); return `${fmt(v)} ${A1[0]} = ${show((v * fa) / fb)} ${B1[0]}`; },
    });
  }
}
for (const A1 of TEMP) for (const B1 of TEMP) {
  if (A1 === B1) continue;
  pairs.push({ name: `convert.${A1}_to_${B1}`, family: "convert", params: "value:number", description: `Convert temperature ${A1.toUpperCase()} to ${B1.toUpperCase()}.`, keywords: `unit conversion temperature ${TEMP_NAMES[A1].join(" ")} ${TEMP_NAMES[B1].join(" ")}`, run: (a) => { const v = n(a, "value"); return `${fmt(v)}°${A1.toUpperCase()} = ${show(fromC[B1](toC[A1](v)))}°${B1.toUpperCase()}`; } });
}
for (const A1 of ["kmpl", "mpg_us", "mpg_uk", "l100km"]) for (const B1 of ["kmpl", "mpg_us", "mpg_uk", "l100km"]) {
  if (A1 === B1) continue;
  pairs.push({ name: `convert.${A1}_to_${B1}`, family: "convert", params: "value:number", description: `Fuel economy ${A1} to ${B1}.`, keywords: "unit conversion fuel mileage economy", run: (a) => { const v = n(a, "value"); return `${fmt(v)} ${A1} = ${show(fuelFromKmpl(B1, fuelToKmpl(A1, v)))} ${B1}`; } });
}

export const UNIT_TOOLS: PackTool[] = [...UNITS, ...pairs];
export const unitJson = () => J(Object.keys(CAT));
