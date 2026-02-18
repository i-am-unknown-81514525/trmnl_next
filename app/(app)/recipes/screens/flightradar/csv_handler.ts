import fs from 'fs';
import { parse } from 'csv-parse/sync';
import Flatbush from 'flatbush';
import {AirportExtended, Runway, Navaid} from "./schema_external/scraped_data";

function toNum(v: string | undefined) : number | null {
    if (v === undefined || v === null || v === '') return null;
    const number = Number(v);
    return isFinite(number) ? number : null;
}

function toBool(v: string | undefined) : boolean {
    if (v === undefined || v === null || v === '') return false;
    return v.toLowerCase() in ['1', 'true'];
}

let loaded: boolean = false;
let airports: AirportExtended[] = [];
let airports_idx: Flatbush | null = null;
let navaids: Navaid[] = [];
let navaids_idx: Flatbush | null = null;
let runways: Runway[] = [];
let runways_idx: Flatbush | null = null;

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
            lat,
            lon,
            runways: []
        }
        airports.push(rec);
    }
    if (airports.length > 0) {
        airports_idx = new Flatbush(airports.length);
        for (const airport of airports) {
            airports_idx.add(airport.lon, airport.lat, airport.lat, airport.lon);
        }
        airports_idx.finish();
    }
}