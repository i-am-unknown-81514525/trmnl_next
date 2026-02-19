import fs from 'fs';
import { parse } from 'csv-parse/sync';
import Flatbush from 'flatbush';
import {AirportExtended, Runway, Navaid} from "./schema_external/scraped_data";
import {clampLat, normalizeLon} from "./map_utils";

function toNum(v: string | undefined) : number | null {
    if (v === undefined || v === null || v === '') return null;
    const number = Number(v);
    return isFinite(number) ? number : null;
}

function toBool(v: string | undefined) : boolean {
    if (!v) return false;
    return ['1', 'true'].includes(v.toLowerCase());
}

let loaded: boolean = false;
let airports: AirportExtended[] = [];
let airports_idx: Flatbush | null = null;
let navaids: Navaid[] = [];
let navaids_idx: Flatbush | null = null;
let runways: Runway[] = [];
let runways_idx: Flatbush | null = null;

const DRAW_PADDING = 0.01;

export function loadAllSync() : void {
    // airports.csv
    const airport_raw = fs.readFileSync("data/airports.csv", "utf8");
    const airport_rows: Record<string, string>[] = parse(airport_raw, {columns: true, skip_empty_lines: true, trim: true});
    // I gave up making more schema ahhhhhhhhhhhhh there are too many
    for (const airport_row of airport_rows) {
        const ident = (airport_row.ident || '').trim().toUpperCase() || null;
        const iata = (airport_row.iata_code || '').trim().toUpperCase() || null;
        const lat = toNum(airport_row.latitude_deg);
        if (lat === null) {
            continue;
        }
        const lon = toNum(airport_row.longitude_deg);
        if (lon === null) {
            continue;
        }
        const rec: AirportExtended = {
            id: airport_row.id,
            ident,
            iata,
            name: airport_row.name || null,
            lat: clampLat(lat),
            lon: normalizeLon(lon),
            runways: []
        }
        airports.push(rec);
    }
    if (airports.length > 0) {
        airports_idx = new Flatbush(airports.length * 2);
        for (const a of airports) {
            const minLonRaw = a.lon - DRAW_PADDING;
            const maxLonRaw = a.lon + DRAW_PADDING;
            const minLat = clampLat(a.lat - DRAW_PADDING);
            const maxLat = clampLat(a.lat + DRAW_PADDING);
            const nMin = normalizeLon(minLonRaw);
            const nMax = normalizeLon(maxLonRaw);
            if (nMax - nMin >= 0 && nMax - nMin <= 180) {
                const env: [number,number,number,number] = [nMin, minLat, nMax, maxLat];
                airports_idx.add(env[0], env[1], env[2], env[3]);
                airports_idx.add(env[0], env[1], env[2], env[3]);
            } else {
                const env1: [number,number,number,number] = [nMin, minLat, 180, maxLat];
                const env2: [number,number,number,number] = [-180, minLat, nMax, maxLat];
                airports_idx.add(env1[0], env1[1], env1[2], env1[3]);
                airports_idx.add(env2[0], env2[1], env2[2], env2[3]);
            }
        }
        airports_idx.finish();
    }
    // runways.csv
    const runway_raw = fs.readFileSync("data/runways.csv", "utf8");
    const runway_rows: Record<string, string>[] = parse(runway_raw, {columns: true, skip_empty_lines: true, trim: true});
    for (const runway_row of runway_rows) {
        const airport_ident = (runway_row.airport_ident || '').trim().toUpperCase() || "";
        const length = toNum(runway_row.length_ft);
        if (length === null) continue;
        const le_lat = toNum(runway_row.le_latitude_deg);
        if (le_lat === null) continue;
        const he_lat = toNum(runway_row.he_latitude_deg);
        if (he_lat === null) continue;
        const le_long = toNum(runway_row.le_longitude_deg);
        if (le_long === null) continue;
        const he_long = toNum(runway_row.he_longitude_deg);
        if (he_long === null) continue;
        const le_heading_degT = toNum(runway_row.le_heading_degT);
        const he_heading_degT = toNum(runway_row.he_heading_degT);

        const rec: Runway = {
            id: String(runway_row.id),
            airport_ref: String(runway_row.airport_ref),
            airport_ident,
            length_ft: length,
            width_ft: toNum(runway_row.width_ft) || 200,
            surface: runway_row.surface || null,
            lighted: toBool(runway_row.lighted),
            closed: toBool(runway_row.closed),
            le_ident: (runway_row.le_ident || '').trim() || null,
            le_lat: clampLat(le_lat),
            le_long: normalizeLon(le_long),
            le_heading_degT,
            he_ident: (runway_row.he_ident || '').trim() || null,
            he_lat: clampLat(he_lat),
            he_long: normalizeLon(he_long),
            he_heading_degT,
        };
        runways.push(rec);
    }
    if (runways.length > 0) {
        runways_idx = new Flatbush(runways.length * 2);
        for (const rw of runways) {
            const lons = [rw.le_long, rw.he_long].map(normalizeLon);
            const lats = [rw.le_lat, rw.he_lat].map(clampLat);
            const minLonRaw = Math.min(...lons) - DRAW_PADDING;
            const maxLonRaw = Math.max(...lons) + DRAW_PADDING;
            const minLat = Math.min(...lats) - DRAW_PADDING;
            const maxLat = Math.max(...lats) + DRAW_PADDING;
            const nMin = normalizeLon(minLonRaw);
            const nMax = normalizeLon(maxLonRaw);
            if (nMax - nMin >= 0 && nMax - nMin <= 180) {
                runways_idx.add(nMin, minLat, nMax, maxLat);
                runways_idx.add(nMin, minLat, nMax, maxLat);
            } else {
                runways_idx.add(nMin, minLat, 180, maxLat);
                runways_idx.add(-180, minLat, nMax, maxLat);
            }
        }
        runways_idx.finish();
    }
    // navaids.csv
    const navaid_raw = fs.readFileSync("data/navaids.csv", "utf8");
    const navaid_rows: Record<string, string>[] = parse(navaid_raw, {columns: true, skip_empty_lines: true, trim: true});
    for (const navaid_row of navaid_rows) {
        const ident = (navaid_row.ident || '').trim().toUpperCase();
        const lat = toNum(navaid_row.latitude_deg);
        if (lat === null) {
            continue;
        }
        const lon = toNum(navaid_row.longitude_deg);
        if (lon === null) {
            continue;
        }
        const name = (navaid_row.name || '').trim();
        if (!name) {
            continue
        }
        const rec: Navaid = {
            id: navaid_row.id,
            ident,
            name,
            lat: clampLat(lat),
            lon: normalizeLon(lon),
            type: navaid_row.type
        }
        navaids.push(rec);
    }
    if (navaids.length > 0) {
        navaids_idx = new Flatbush(navaids.length * 2);
        for (const n of navaids) {
            const minLonRaw = n.lon - DRAW_PADDING;
            const maxLonRaw = n.lon + DRAW_PADDING;
            const minLat = clampLat(n.lat - DRAW_PADDING);
            const maxLat = clampLat(n.lat + DRAW_PADDING);
            const nMin = normalizeLon(minLonRaw);
            const nMax = normalizeLon(maxLonRaw);
            if (nMax - nMin >= 0 && nMax - nMin <= 180) {
                navaids_idx.add(nMin, minLat, nMax, maxLat);
                navaids_idx.add(nMin, minLat, nMax, maxLat);
            } else {
                navaids_idx.add(nMin, minLat, 180, maxLat);
                navaids_idx.add(-180, minLat, nMax, maxLat);
            }
        }
        navaids_idx.finish();
    }
    loaded = true;
}

export function findRunwaysInBox(minLat:number, minLon:number, maxLat:number, maxLon:number): Runway[] {
    if (!loaded) loadAllSync();
    if (!runways_idx) return [];
    const ids = runways_idx.search(minLon, minLat, maxLon, maxLat);
    const seen = new Set<number>();
    const out: Runway[] = [];
    for (const id of ids) {
        const fi = Math.floor(id / 2);
        if (seen.has(fi)) continue;
        seen.add(fi);
        out.push(runways[fi]);
    }
    return out;
}
export function findNavaidsInBox(minLat:number, minLon:number, maxLat:number, maxLon:number): Navaid[] {
    if (!loaded) loadAllSync();
    if (!navaids_idx) return [];
    const ids = navaids_idx.search(minLon, minLat, maxLon, maxLat);
    const seen = new Set<number>();
    const out: Navaid[] = [];
    for (const id of ids) {
        const fi = Math.floor(id / 2);
        if (seen.has(fi)) continue;
        seen.add(fi);
        out.push(navaids[fi]);
    }
    return out;
}
export function findAirportInBox(minLat:number, minLon:number, maxLat:number, maxLon:number): AirportExtended[] {
    if (!loaded) loadAllSync();
    if (!airports_idx) return [];
    const ids = airports_idx.search(minLon, minLat, maxLon, maxLat);
    const seen = new Set<number>();
    const out: AirportExtended[] = [];
    for (const id of ids) {
        const fi = Math.floor(id / 2);
        if (seen.has(fi)) continue;
        seen.add(fi);
        out.push(airports[fi]);
    }
    return out;
}