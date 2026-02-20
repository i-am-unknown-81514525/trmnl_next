// import { Decompressor } from "zstd-wasm";
import {
	FR24SearchResult,
	getAirport,
	getLive,
} from "./schema_external/fr24search";
import {
	Airport,
	BoundingBox,
	DepartureKind,
	DisplayData,
	EnvironmentOverlays,
	FlightData,
	FlightID,
	FlightMetadata,
	ForeignFlightData,
	ForeignFlightDataDisplay,
	Location,
	TrackingKind,
	Trail,
} from "./schema";
import { Trace } from "./schema_external/adsbexchange_trace";
import { FR24PlaybackResult } from "./schema_external/fr24_flightplayback";
import { FullTimeData } from "./schema_external/fr24_flight_list";
import {
	findAirportInBox,
	findNavaidsInBox,
	findRunwaysInBox,
	loadAllSync,
} from "./csv_handler";
import type { TopoOrGeo } from "./map";
import {
	bboxForFlightDegrees,
	mergeBoxQueries,
	referenceLonForFlight,
	shiftFeatureCollectionToRef,
} from "./map";
import { feature as topoFeature } from "topojson-client";
// import { decompress } from "@skhaz/zstd";
import { decompress } from "fzstd";

loadAllSync();

const cachedLandTopo: Record<"10m" | "50m" | "110m", TopoOrGeo | null> = {
	"10m": null,
	"50m": null,
	"110m": null,
};

async function loadLandTopoOnce(
	res: "10m" | "50m" | "110m",
): Promise<TopoOrGeo> {
	if (cachedLandTopo[res]) return cachedLandTopo[res] as TopoOrGeo;
	try {
		// @ts-ignore
		const mod = require(`world-atlas/land-${res}.json`);
		const data = (mod as any).default ?? mod;
		cachedLandTopo[res] = data as TopoOrGeo;
		return cachedLandTopo[res] as TopoOrGeo;
	} catch (e) {
		const empty: any = { type: "FeatureCollection", features: [] };
		cachedLandTopo[res] = empty;
		return cachedLandTopo[res] as TopoOrGeo;
	}
}

async function getFlightInZone(
	bound: BoundingBox,
): Promise<ForeignFlightData[]> {
	const bottom_left: Location = bound.min;
	const top_right: Location = bound.max;
	const response = await fetch(
		`https://globe.adsbexchange.com/re-api/?binCraft&zstd&box=${
			bottom_left.lat - 3 < -180 ? -180 : bottom_left.lat - 3
		},${top_right.lat + 3 > 180 ? 180 : top_right.lat + 3},${
			bottom_left.long - 3 < -90 ? -90 : bottom_left.long - 3
		},${top_right.long + 3 > 90 ? 90 : top_right.long + 3}`,
		{
			headers: {
				Referer: "https://globe.adsbexchange.com/",
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
			},
			cache: "no-store",
		},
	);
	if (!response.ok) {
		throw new Error(`HTTP error! Status: ${response.status}`);
	}
	const body = await response.bytes();
	// const decompressor = new Decompressor();
	// await decompressor.init();
	const data = decompress(Buffer.from(body));

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
		const hex = (hexInt & 0xffffff).toString(16).padStart(6, "0");

		const long = view.getInt32(base + 8, true) / 1e6;
		const lat = view.getInt32(base + 12, true) / 1e6;

		const callsignBytes = data.subarray(base + 78, base + 86);
		let end = callsignBytes.indexOf(0);
		if (end === -1) end = 8;
		const callsign = new TextDecoder()
			.decode(callsignBytes.subarray(0, end))
			.trim();

		const alt = validity1 & 16 ? view.getInt16(base + 20, true) * 25 : null;
		const speed =
			validity1 & 128 ? view.getInt16(base + 34, true) / 10.0 : null;

		const validity2 = view.getUint8(base + 74);
		const track = validity2 & 8 ? view.getInt16(base + 40, true) / 90.0 : null;

		arr.push({
			id: { hex, callsign, fr24_hex8: null },
			loc: {
				loc: {
					lat,
					long,
				},
				alt: alt,
				speed: speed,
				track: track,
			},
		});
	}
	return arr;
}

export function getOverlayInZone(bound: BoundingBox): EnvironmentOverlays {
	const bottom_left: Location = bound.min;
	const top_right: Location = bound.max;
	const runways = findRunwaysInBox(
		bottom_left.lat,
		bottom_left.long,
		top_right.lat,
		top_right.long,
	);
	const navaids = findNavaidsInBox(
		bottom_left.lat,
		bottom_left.long,
		top_right.lat,
		top_right.long,
	);
	const airports = findAirportInBox(
		bottom_left.lat,
		bottom_left.long,
		top_right.lat,
		top_right.long,
	);
	return { runways, navaids, airports };
}

export function getOverlayInSplitZone(
	boxes: BoundingBox[],
): EnvironmentOverlays {
	const runways = mergeBoxQueries(
		boxes,
		(b) => findRunwaysInBox(b.min.lat, b.min.long, b.max.lat, b.max.long),
		(r) => String(r.id),
	);
	const navaids = mergeBoxQueries(
		boxes,
		(b) => findNavaidsInBox(b.min.lat, b.min.long, b.max.lat, b.max.long),
		(n) => String(n.id),
	);
	const airports = mergeBoxQueries(
		boxes,
		(b) => findAirportInBox(b.min.lat, b.min.long, b.max.lat, b.max.long),
		(a) => String(a.id ?? a.ident ?? a.iata ?? a.name ?? JSON.stringify(a)),
	);
	return { runways, navaids, airports };
}

async function getFr24Hex(id: FlightID): Promise<FlightID> {
	const response = await fetch(
		`https://www.flightradar24.com/v1/search/web/find?query=${id.callsign}&limit=50`,
		{ next: { revalidate: 3600 } },
	);
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
	return { ...id, fr24_hex8: entry.id };
}

async function getTrailADSBExchange(id: FlightID): Promise<Trail[]> {
	const response = await fetch(
		`https://globe.adsbexchange.com/data/traces/${id.hex.substring(4, 6)}/trace_full_${id.hex}.json`,
		{
			headers: {
				Referer: "https://globe.adsbexchange.com/",
				"User-Agent":
					"User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
			},
			cache: "no-store",
		},
	);
	const result: Trace = await response.json();
	let prev_loc: Location | null = null;
	let prev_speed: number | null = null;
	let prev_track: number | null = null;
	for (const dt of result.trace) {
		if (dt[1] !== null && dt[2] !== null) {
			prev_loc = <Location>{ lat: dt[1], long: dt[2] };
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
	const max_timedelta = result.trace
		.map((x) => x[0])
		.reduce((prev, current) => (prev > current ? prev : current), 0);
	const base_time = result.timestamp - max_timedelta;
	if (prev_loc === null) return [];
	if (prev_speed === null) return [];
	if (prev_track === null) return [];
	let arr: Trail[] = [];
	for (const dt of result.trace) {
		if (dt[1] !== null && dt[2] !== null) {
			prev_loc = <Location>{ lat: dt[1], long: dt[2] };
		}
		if (dt[4] !== null) prev_speed = dt[4];
		if (dt[5] !== null) prev_track = dt[5];
		arr.push({
			timestamp: dt[0] + base_time,
			loc: {
				loc: <Location>prev_loc,
				alt: dt[3] === "ground" ? 0 : dt[3],
				speed: prev_speed,
				track: prev_track,
			},
		});
	}
	return arr;
}

function extractTrailFR24(data: FR24PlaybackResult): Trail[] {
	if (data.result.response.data.flight.track === undefined) {
		return [];
	}
	return data.result.response.data.flight.track.map((track) => {
		return {
			timestamp: track.timestamp,
			loc: {
				loc: {
					lat: track.latitude,
					long: track.longitude,
				},
				alt: track.altitude.feet,
				speed: track.speed.kts,
				track: track.heading,
			},
		};
	});
}

async function getTrailFR24(id: FlightID): Promise<Trail[]> {
	id = await getFr24Hex(id);
	const response = await fetch(
		`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${id.fr24_hex8}&timestamp=0`,
		{ cache: "no-store" },
	);
	const data: FR24PlaybackResult = await response.json();
	return extractTrailFR24(data);
}

async function getFr24AirportLocation(
	iata_code: string,
): Promise<Airport | null> {
	const response = await fetch(
		`https://www.flightradar24.com/v1/search/web/find?query=${iata_code}&limit=50`,
		{ next: { revalidate: 86400 } },
	);
	if (!response.ok) {
		throw new Error(`HTTP error! Status: ${response.status}`);
	}
	const result: FR24SearchResult = await response.json();
	const entry = getAirport(iata_code, result);
	if (entry === null) {
		return null;
	}
	return {
		code: entry.id,
		name: entry.label,
		loc: { lat: entry.detail.lat, long: entry.detail.lon },
	};
}

async function getEstFR24(id: FlightID): Promise<FullTimeData | null> {
	const response = await fetch(
		`https://api.flightradar24.com/common/v1/flight/list.json?query=${id.callsign}&fetchBy=reg&filterBy=historic&limit=5&page=1&timestamp=0`,
		{ cache: "no-store" },
	);
	if (!response.ok) {
		throw new Error(`HTTP error! Status: ${response.status}`);
	}
	return (await response.json())?.result?.response?.data?.[0]?.time ?? null;
}

function departureKindMapping(
	str: "estimated" | "landed" | "scheduled" | "diverted" | string,
): DepartureKind {
	const mapping: Record<string, DepartureKind> = {
		estimated: DepartureKind.Departed,
		landed: DepartureKind.Arrived,
		scheduled: DepartureKind.Scheduled,
		diverted: DepartureKind.Diverted,
	};
	return mapping[str] ?? DepartureKind.Departed;
}

async function getFlightData(id: FlightID): Promise<FlightData | null> {
	id = await getFr24Hex(id);
	const response = await fetch(
		`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${id.fr24_hex8}&timestamp=0`,
		{ cache: "no-store" },
	);
	if (!response.ok) {
		throw new Error(`HTTP error! Status: ${response.status}`);
	}
	const data: FR24PlaybackResult = await response.json();
	const trails = extractTrailFR24(data) || (await getTrailADSBExchange(id));
	if (trails.length === 0) {
		return null;
	}
	const curr = trails[trails.length - 1];
	let metadata: FlightMetadata | null = null;
	const airport_data = data.result.response.data.flight.airport;
	if (airport_data !== undefined) {
		const time_data = await getEstFR24(id);
		metadata = {
			src: await getFr24AirportLocation(airport_data.origin.code.iata),
			dest: await getFr24AirportLocation(airport_data.destination.code.iata),
			real: airport_data.real
				? await getFr24AirportLocation(airport_data.real.code.iata)
				: null,
			time_data: time_data,
			status: departureKindMapping(
				data.result.response.data.flight.status?.generic.status.text ??
					"estimated",
			),
		};
	}
	return {
		id: id,
		trails: trails,
		curr: curr,
		metadata: metadata,
	};
}

function zoomToDegreeRadius(zoom = 10): number {
	const z = Math.max(0, Math.min(15, zoom));
	const base = 0.025; // degrees at zoom=10 (≈2.5km at equator); adjust to taste
	return base * Math.pow(2, 10 - z);
}

/** Compute a sensible zoom level for a tracked flight using speed, altitude
 * and recent climb/descent rate. Higher zoom -> more zoomed-in (smaller
 * geographic radius). Returns an integer zoom clamped to [2, 10].
 */
function computeZoomForFlight(data: FlightData): number {
	const DEFAULT = 6;
	try {
		const curr = data.curr.loc;
		const speed = curr.speed ?? 0; // kts
		const alt = curr.alt ?? 0; // feet

		let z = DEFAULT;

		// On ground / taxi -> close view
		if (speed < 80) {
			z = Math.max(z, 9);
		}

		// Low altitude -> closer
		if (alt < 5000) {
			z = Math.max(z, 9);
		}

		// Typical cruise -> medium zoom
		if (speed >= 250 && alt >= 20000) {
			z = Math.min(z, DEFAULT);
		}

		// Estimate climb/descent rate (feet per minute) from recent trail points
		let fpm = 0;
		const trails = data.trails || [];
		if (trails.length >= 2) {
			const last = trails[trails.length - 1];
			let i = trails.length - 2;
			while (
				i >= 0 &&
				(trails[i].loc.alt === null || trails[i].loc.alt === undefined)
			)
				i--;
			if (i >= 0) {
				const prev = trails[i];
				const dt = last.timestamp - prev.timestamp || 1;
				const dalt = (last.loc.alt ?? alt) - (prev.loc.alt ?? alt);
				fpm = (dalt / dt) * 60;
			}
		}

		const absf = Math.abs(fpm);
		if (absf > 2000) z = Math.max(z, 8);
		else if (absf > 500) z = Math.max(z, 7);

		return Math.min(10, Math.max(2, Math.round(z)));
	} catch (e) {
		return DEFAULT;
	}
}

/** normalize longitude into [-180, 180) */
function normalizeLon(lon: number): number {
	return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function getViewBoundingBox(
	tracking: TrackingKind,
	center_loc: Location,
	forward_ratio = 1,
	zoom?: number,
): { unified: BoundingBox; split: BoundingBox[] } {
	if (tracking.kind === "flight") {
		if (zoom !== undefined) {
			const center = tracking.flight.curr.loc.loc;
			const radius = zoomToDegreeRadius(zoom);
			let centerLat = center.lat;
			if (centerLat - radius < -90) centerLat = -90 + radius;
			if (centerLat + radius > 90) centerLat = 90 - radius;
			const minLat = Math.max(-90, centerLat - radius);
			const maxLat = Math.min(90, centerLat + radius);
			let minLon = center.long - radius;
			let maxLon = center.long + radius;
			minLon = normalizeLon(minLon);
			maxLon = normalizeLon(maxLon);
			const box = {
				min: { lat: minLat, long: minLon },
				max: { lat: maxLat, long: maxLon },
			};
			let span = maxLon - minLon;
			if (span < 0) span += 360;
			if (span <= 180) {
				return { unified: box, split: [box] };
			}
			return {
				unified: box,
				split: [
					{
						min: { lat: minLat, long: minLon },
						max: { lat: maxLat, long: 180 },
					},
					{
						min: { lat: minLat, long: -180 },
						max: { lat: maxLat, long: maxLon },
					},
				],
			};
		}
		return bboxForFlightDegrees(tracking.flight.curr.loc, 1);
	}

	const center =
		tracking.kind === "static_airport"
			? tracking.airport.loc
			: tracking.kind === "static_location"
				? tracking.location
				: center_loc;

	const radius = zoomToDegreeRadius(zoom ?? 10);
	// If the requested radius would cross the poles, recenter the view latitude
	// so the box stays symmetric around the center as much as possible while
	// keeping latitude inside [-90, 90]. This avoids degenerate boxes pinned
	// to the pole.
	let centerLat = center.lat;
	if (centerLat - radius < -90) centerLat = -90 + radius;
	if (centerLat + radius > 90) centerLat = 90 - radius;
	const minLat = Math.max(-90, centerLat - radius);
	const maxLat = Math.min(90, centerLat + radius);
	let minLon = center.long - radius;
	let maxLon = center.long + radius;
	minLon = normalizeLon(minLon);
	maxLon = normalizeLon(maxLon);
	const box = {
		min: { lat: minLat, long: minLon },
		max: { lat: maxLat, long: maxLon },
	};

	let span = maxLon - minLon;
	if (span < 0) span += 360;

	if (span <= 180) {
		return { unified: box, split: [box] };
	}

	return {
		unified: box,
		split: [
			{ min: { lat: minLat, long: minLon }, max: { lat: maxLat, long: 180 } },
			{ min: { lat: minLat, long: -180 }, max: { lat: maxLat, long: maxLon } },
		],
	};
}

export function getVisualBearing(tracking: TrackingKind): number {
	if (tracking.kind === "flight") {
		return tracking.flight.curr.loc.track ?? 0;
	}
	return 0;
}

export default async function getData({
	locParam,
}: {
	locParam: string;
}): Promise<DisplayData> {
	let kind: TrackingKind | null = null;
	let zoom: number = 5;
	let location: Location | null = null;
	const fwd = 1.3;
	if (locParam.startsWith("airport:")) {
		const params = locParam.substring(8).split(",");
		const airport = await getFr24AirportLocation(params[0]);
		if (airport === null) {
			throw new Error(`Airport ${params[0]} not found`);
		}
		if (params[1]) {
			zoom = Number(params[1]);
			if (zoom < 0) zoom = 0;
			if (zoom > 10) zoom = 10;
			if (isNaN(zoom)) zoom = 5;
		}
		kind = { kind: "static_airport", airport: airport };
		location = airport.loc;
	} else if (locParam.startsWith("loc:")) {
		const params = locParam.substring(4).split(",");
		const lat = Number(params[0]);
		const long = Number(params[1]);
		if (isNaN(lat) || isNaN(long)) {
			throw new Error("Invalid location parameter");
		}
		if (lat < -90 || lat > 90 || long < -180 || long > 180) {
			throw new Error("Invalid location parameter (Out of polar coordinate)");
		}
		if (params[2]) {
			zoom = Number(params[2]);
			if (zoom < 0) zoom = 0;
			if (zoom > 10) zoom = 10;
			if (isNaN(zoom)) zoom = 5;
		}

		kind = { kind: "static_location", location: { lat: lat, long: long } };
		location = { lat: lat, long: long };
	} else if (locParam.startsWith("flight:")) {
		const params: string[] = locParam.substring(7).split(",");
		const callsign = params[0];
		const hex = params[1];
		const data = await getFlightData({
			hex: hex,
			callsign: callsign,
			fr24_hex8: null,
		});
		if (data === null) {
			throw new Error("Flight not found");
		}
		kind = { kind: "flight", flight: data };
		location = data.curr.loc.loc;

		// Compute zoom from flight speed/altitude/trail (ignore manual bbox)
		zoom = computeZoomForFlight(data);
	} else {
		throw new Error("Unknown location parameter");
	}
	const bounding_box = getViewBoundingBox(
		kind!,
		location!,
		fwd,
		zoom ?? undefined,
	);

	if (process.env.FLIGHTMAP_DEBUG === "1") {
		try {
			const bb = bounding_box.unified;
			console.log("getData: locParam, parsed zoom, radiusDeg, bounding_box:", {
				locParam,
				zoom,
				radiusDeg: zoomToDegreeRadius(zoom ?? 10),
				min: { lat: bb.min.lat.toFixed(6), long: bb.min.long.toFixed(6) },
				max: { lat: bb.max.lat.toFixed(6), long: bb.max.long.toFixed(6) },
			});
		} catch (e) {
			console.log("getData debug failed", e);
		}
	}

	let planes = [];
	for (const box of bounding_box.split) {
		planes.push(...(await getFlightInZone(box)));
	}
	planes = planes.filter(
		(item, index, self) =>
			index === self.findIndex((t) => t.id.hex === item.id.hex) &&
			(kind?.kind !== "flight" || item.id.hex !== kind.flight.id.hex),
	);
	const plane_display: ForeignFlightDataDisplay[] = planes.map((x) => {
		return {
			flight: x,
			parameter: {
				display_icon: true,
				display_label: true,
				require_zoom: 5,
			},
		};
	});
	const overlays = getOverlayInSplitZone(bounding_box.split);
	const visual_bearing = getVisualBearing(kind);

	const refLon =
		kind.kind === "flight"
			? referenceLonForFlight(kind.flight.curr.loc)
			: (location?.long ?? 0);
	// choose resolution: default 110m, medium 50m, high 10m
	let res: "10m" | "50m" | "110m" = "110m";
	if (zoom >= 5) res = "10m";
	else if (zoom > 2 && zoom < 5) res = "50m";

	// Development override: allow forcing 50m topo even at low zooms to
	// diagnose seam/render issues. Set env FLIGHTMAP_FORCE_50M=1 to enable.
	if (process.env.FLIGHTMAP_FORCE_50M === "1") {
		res = "50m";
	}

	let topo = await loadLandTopoOnce(res);

	let land_geo: TopoOrGeo = { type: "FeatureCollection", features: [] } as any;
	if (topo) {
		if ((topo as any).type === "Topology") {
			const topoObj = topo as any;
			const key =
				topoObj.objects && topoObj.objects.land
					? "land"
					: Object.keys(topoObj.objects)[0];
			try {
				const fc = topoFeature(topoObj, topoObj.objects[key]);
				if (fc && (fc as any).type === "FeatureCollection") {
					// Do not pre-shift coordinates here; let the renderer/projector
					// handle longitude unwrapping when drawing. Keeping raw feature
					// collections avoids double-shifting and seams.
					land_geo = fc as any;
				}
			} catch (e) {
				// fallback to empty
				land_geo = { type: "FeatureCollection", features: [] } as any;
			}
		} else if ((topo as any).type === "FeatureCollection") {
			// Pass through raw feature collection; renderer will project per-point
			// using the provided refLon to ensure continuity.
			land_geo = topo as any;
		}
	}

	return {
		tracking: kind,
		center_loc: location,
		nearby: plane_display,
		overlays: overlays,
		visual_bearing,
		bound: bounding_box.unified,
		zoom,
		forward_ratio: fwd,
		land_geo,
	};
}
