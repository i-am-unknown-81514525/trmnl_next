import { createCanvas } from "@napi-rs/canvas";
import fs from "fs";
import {
	bboxForFlightDegrees,
	referenceLonForFlight,
	drawMapBackground,
	shiftLonToRef,
	mergeBoxQueries,
} from "./map";
import {
	findAirportInBox,
	findRunwaysInBox,
	findNavaidsInBox,
} from "./csv_handler";
import { clampLat, normalizeLon, degToRad } from "./map_utils";
import type { TopoOrGeo } from "./map";
import type { FlightLocation, BoundingBox } from "./schema";

function combineBoxesToContinuous(
	boxes: BoundingBox[],
	refLon: number,
): BoundingBox {
	const shift = (lon: number) => {
		let v = normalizeLon(lon);
		while (v - refLon > 180) v -= 360;
		while (v - refLon <= -180) v += 360;
		return v;
	};
	const lons: number[] = [];
	const lats: number[] = [];
	for (const b of boxes) {
		lons.push(shift(b.min.long), shift(b.max.long));
		lats.push(b.min.lat, b.max.lat);
	}
	const minLon = Math.min(...lons);
	const maxLon = Math.max(...lons);
	const minLat = Math.max(-90, Math.min(...lats));
	const maxLat = Math.min(90, Math.max(...lats));
	return {
		min: { lat: minLat, long: minLon },
		max: { lat: maxLat, long: maxLon },
	};
}

function createProjector(
	bbox: BoundingBox,
	width: number,
	height: number,
	refLon: number,
) {
	const ref = normalizeLon(refLon);
	const shiftLon = (lon: number) => {
		let v = normalizeLon(lon);
		while (v - ref > 180) v -= 360;
		while (v - ref <= -180) v += 360;
		return v;
	};
	const minLon = shiftLon(bbox.min.long);
	const maxLon = shiftLon(bbox.max.long);
	const minLat = clampLat(bbox.min.lat);
	const maxLat = clampLat(bbox.max.lat);
	const lonSpan = maxLon - minLon || 1e-6;
	const latSpan = maxLat - minLat || 1e-6;
	const scaleX = width / lonSpan;
	const scaleY = height / latSpan;
	const scale = Math.min(scaleX, scaleY);
	const pxWidth = lonSpan * scale;
	const pxHeight = latSpan * scale;
	const offsetX = (width - pxWidth) / 2;
	const offsetY = (height - pxHeight) / 2;
	return {
		project: (lat: number, lon: number): [number, number] => {
			const sx = (shiftLon(lon) - minLon) * scale + offsetX;
			const sy = (maxLat - clampLat(lat)) * scale + offsetY;
			return [sx, sy];
		},
	};
}

export async function renderFrameForFlight(
	topo: TopoOrGeo,
	flight: FlightLocation,
	opts: {
		width: number;
		height: number;
		dpr?: number;
		forwardRatio?: number;
		// optional precomputed bounding box (used for static airport/loc zoom)
		boundingBox?: BoundingBox;
		// optional reference longitude to unwrap geometries
		refLon?: number;
	},
) {
	const DPR = opts.dpr ?? 1;
	const width = opts.width;
	const height = opts.height;

	const canvas = createCanvas(
		Math.round(width * DPR),
		Math.round(height * DPR),
	);
	const ctx = canvas.getContext("2d")!;
	ctx.scale(DPR, DPR);

	// Debug: log basic render params when requested
	if (process.env.FLIGHTMAP_DEBUG === "1") {
		console.log("renderFrameForFlight", {
			DPR,
			width,
			height,
			refLon: referenceLonForFlight(flight),
		});
		if ((topo as any)?.type === "FeatureCollection") {
			console.log("land features:", (topo as any).features?.length ?? 0);
		} else if ((topo as any)?.type === "Topology") {
			console.log(
				"topology objects:",
				Object.keys((topo as any).objects ?? {}).join(","),
			);
		}
	}

	const forwardRatio = opts.forwardRatio ?? 2.0;

	// If caller provided an explicit bounding box (e.g. static airport + zoom), use it.
	let boxes;
	let refLon: number;
	if (opts.boundingBox) {
		boxes = { unified: opts.boundingBox, split: [opts.boundingBox] } as any;
		refLon = opts.refLon ?? opts.boundingBox.min.long;
	} else {
		boxes = bboxForFlightDegrees(flight, forwardRatio);
		refLon = referenceLonForFlight(flight);
	}
	const combined = boxes.unified;

	const cx = width / 2;
	const cy = height / 2;
	const rad = degToRad(flight.track || 0);

	// Rotate canvas so track points up, draw background + overlays in rotated frame
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(-rad);
	ctx.translate(-cx, -cy);

	// Draw background
	drawMapBackground(ctx, topo, combined, width, height, refLon);

	// Projector for overlays
	const proj = createProjector(combined, width, height, refLon);

	// Query overlays and dedupe
	const airports = mergeBoxQueries(
		boxes.split,
		(b) => findAirportInBox(b.min.lat, b.min.long, b.max.lat, b.max.long),
		(a: any) => String(a.id),
	);
	const navaids = mergeBoxQueries(
		boxes.split,
		(b) => findNavaidsInBox(b.min.lat, b.min.long, b.max.lat, b.max.long),
		(n: any) => String(n.id),
	);
	const runways = mergeBoxQueries(
		boxes.split,
		(b) => findRunwaysInBox(b.min.lat, b.min.long, b.max.lat, b.max.long),
		(r: any) => String(r.id),
	);

	// Draw overlays in rotated frame
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	ctx.strokeStyle = "#444";
	ctx.lineWidth = 1.5;
	for (const rw of runways) {
		const [x1, y1] = proj.project(rw.le_lat, shiftLonToRef(rw.le_long, refLon));
		const [x2, y2] = proj.project(rw.he_lat, shiftLonToRef(rw.he_long, refLon));
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.stroke();
	}

	ctx.fillStyle = "#000";
	for (const a of airports) {
		const [x, y] = proj.project(a.lat, shiftLonToRef(a.lon, refLon));
		ctx.beginPath();
		ctx.arc(x, y, 3, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.strokeStyle = "#222";
	ctx.lineWidth = 1;
	for (const n of navaids) {
		const [x, y] = proj.project(n.lat, shiftLonToRef(n.lon, refLon));
		ctx.beginPath();
		ctx.arc(x, y, 2.5, 0, Math.PI * 2);
		ctx.stroke();
	}

	ctx.restore(); // overlays in rotated frame
	ctx.restore(); // finish rotation

	// Draw aircraft glyph at center (upright)
	ctx.save();
	ctx.fillStyle = "#000";
	ctx.translate(cx, cy);
	const planeSize = Math.max(10, Math.min(24, (width + height) / 60));
	ctx.beginPath();
	ctx.moveTo(0, -planeSize);
	ctx.lineTo(planeSize / 2, planeSize / 2);
	ctx.lineTo(-planeSize / 2, planeSize / 2);
	ctx.closePath();
	ctx.fill();
	ctx.restore();

	// Label horizontally
	ctx.fillStyle = "#000";
	ctx.font = "12px sans-serif";
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	ctx.fillText((flight as any).ident || "", cx + planeSize + 6, cy);

	return canvas.toBuffer("image/png");
}

// Optional helper: dump debug PNG when env var set
export function dumpDebugPNG(buf: Buffer, name = "trmnl_flightmap_debug.png") {
	try {
		if (process.env.FLIGHTMAP_DEBUG_DUMP === "1") {
			const out = `/tmp/${name}`;
			fs.writeFileSync(out, buf);
			console.log(`wrote debug png to ${out}`);
		}
	} catch (e) {
		console.warn("failed to dump debug png", e);
	}
}
