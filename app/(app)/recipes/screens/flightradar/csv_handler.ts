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