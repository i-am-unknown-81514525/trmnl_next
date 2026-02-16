import { createReadStream, createWriteStream } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Decompressor } from 'zstd-wasm';

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
    const result = decompressor.decompress(body);
    const total_size = result.length;
    const entries = total_size / 112 - 1;
    throw new Error("Not implemented yet");
}
