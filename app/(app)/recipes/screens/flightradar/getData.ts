import { createReadStream, createWriteStream } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Decompressor } from 'zstd-wasm';
import {getLive, FR24SearchResult} from './schema_external/fr24search';

export interface Location {
    lat: number,
    long: number
}

export interface FlightID {
    hex: string,
    callsign: string,
    fr24_hex8: string | null;
}

export interface ForeignFlightData {
    id: FlightID
    loc: Location
}

export interface Trail {
    loc: Location,
    speed: number,
    height: number,
    track: number
}

export interface FlightData {
    id: FlightID
    current: Trail
    trail: Trail[]
}

export interface Airport {
    code: string,
    loc: Location
}

type TrackingKind =
    | { kind: 'static_location', location: Location }
    | { kind: 'static_airport', airport: Airport }
    | { kind: 'flight'; flight: FlightData };

export interface DisplayData {
    tracking: TrackingKind,
    center_loc: Location,
    nearby: ForeignFlightData[]
}

async function getFlightInZone(bottom_left: Location, top_right: Location) : Promise<ForeignFlightData[]> {
    const response = await fetch(
        `https://globe.adsbexchange.com/re-api/?binCraft&zstd&box=${bottom_left.lat},${top_right.lat},${bottom_left.long},${top_right.long}`,
        {
            headers: {
                "referer": "https://globe.adsbexchange.com/",
                "User-Agent": "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
            }
        }
    )
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const body = await response.bytes();
    const decompressor = new Decompressor();
    await decompressor.init();
    const data = decompressor.decompress(body);
    const total_size = data.length;
    const entries = (total_size / 112) - 1;
    const arr: ForeignFlightData[] = [];
    for (let i = 1; i <= entries; i++) { // it is start at 1 and end at entries inclusively because the first
        // one should be discarded, as evidence by the -1 in entries.
        const base = 112*i;
        const hex_int = data[base+2] * 65536 + data[base+3] * 256 + data[base+4];
        const hex = hex_int.toString(16);
        const long = data[base+8] * (2**24) + data[base+9] * (2**16) + data[base+10] * (2**8) + data[base+11] / 1e6;
        const lat = data[base+12] * (2**24) + data[base+13] * (2**16) + data[base+14] * (2**8) + data[base+15] / 1e6;
        const callsign = (new TextDecoder()).decode(data.subarray(base+78, base+78+8)).trim();
        arr.push({id: {hex, callsign, fr24_hex8: null}, loc: {lat, long}});
    }
   return arr;
}

async function getFr24Hex(id: FlightID) : Promise<FlightID> {
    const response = await fetch(`https://www.flightradar24.com/v1/search/web/find?query=${id.callsign}&limit=50`);
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    if (id.fr24_hex8) {
        return id;
    }
    const result: FR24SearchResult = await response.json();
    const entry = getLive(id.callsign, result);
    if (entry === null) {
        return id;
        }
    return {...id, fr24_hex8: entry.id};
}