import { Decompressor } from 'zstd-wasm';
import {getLive, FR24SearchResult} from './schema_external/fr24search';
import {ForeignFlightData, FlightID, Location, Trail} from "./schema";
import {Trace} from "./schema_external/adsbexchange_trace";

async function getFlightInZone(bottom_left: Location, top_right: Location) : Promise<ForeignFlightData[]> {
    const response = await fetch(
        `https://globe.adsbexchange.com/re-api/?binCraft&zstd&box=${bottom_left.lat},${top_right.lat},${bottom_left.long},${top_right.long}`,
        {
            headers: {
                "Referer": "https://globe.adsbexchange.com/",
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

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.byteLength < 12) return [];
    const stride = view.getUint32(8, true);
    const entries = Math.floor(data.byteLength / stride);

    const arr: ForeignFlightData[] = [];
    for (let i = 1; i < entries; i++) {
        const base = stride * i;

        const validity1 = view.getUint8(base + 73);
        if (!(validity1 & 64)) continue; // Invalid position

        const hexInt = view.getUint32(base, true);
        const hex = (hexInt & 0xFFFFFF).toString(16).padStart(6, '0');

        const long = view.getInt32(base + 8, true) / 1e6;
        const lat = view.getInt32(base + 12, true) / 1e6;

        const callsignBytes = data.subarray(base + 78, base + 86);
        let end = callsignBytes.indexOf(0);
        if (end === -1) end = 8;
        const callsign = new TextDecoder().decode(callsignBytes.subarray(0, end)).trim();

        const alt = (validity1 & 16) ? view.getInt16(base + 20, true) * 25 : null;
        const speed = (validity1 & 128) ? view.getInt16(base + 34, true) / 10.0 : null;

        const validity2 = view.getUint8(base + 74);
        const track = (validity2 & 8) ? view.getInt16(base + 40, true) / 90.0 : null;

        arr.push(
            {id: {hex, callsign, fr24_hex8: null},
                loc: {
                    loc: {
                        lat, long
                    },
                    alt: alt,
                    speed: speed,
                    track: track
                }
            }
        );
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

async function getTrailADSBExchange(id: FlightID) : Promise<Trail[]> {
    const response = await fetch(
        `https://globe.adsbexchange.com/data/traces/${id.hex.substring(4, 6)}/trace_full_${id.hex}.json`,
        {
            headers: {
                "Referer": "https://globe.adsbexchange.com/",
                "User-Agent": "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
            }
        }
    );
    const result: Trace = await response.json();
    let prev_loc: Location | null = null;
    let prev_speed: number | null = null;
    let prev_track: number | null = null;
    for (const dt of result.trace) {
        if (dt[1] !== null && dt[2] !== null) {
            prev_loc = <Location>{lat: dt[1], long: dt[2]};
            break;
        }
    }
    for (const dt of result.trace) {
        if (dt[4] !== null) {
            prev_speed = dt[4];
            break;
        }
    }
    for (const dt of result.trace) {
        if (dt[5] !== null) {
            prev_track = dt[5];
            break;
        }
    }
    if (prev_loc === null) return [];
    if (prev_speed === null) return [];
    if (prev_track === null) return [];
    let arr: Trail[] = [];
    for (const dt of result.trace) {
        if (dt[1] !== null && dt[2] !== null) {
            prev_loc = <Location>{lat: dt[1], long: dt[2]};
        }
        if (dt[4] !== null) prev_speed = dt[4];
        if (dt[5] !== null) prev_track = dt[5];
        arr.push(
            {
                dt: dt[0],
                loc: {
                    loc: <Location>prev_loc,
                    alt: dt[3] === "ground" ? 0 : dt[3],
                    speed: prev_speed,
                    track: prev_track
                }
            }
        );
    }
    return arr;
}

async function getTrailFR24(id: FlightID) : Promise<Trail[]> {
    id = await getFr24Hex(id);
    const response = await fetch(`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${id.fr24_hex8}&timestamp=0`);
    throw new Error("Not implemented");
}