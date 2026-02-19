import { feature as topoFeature } from 'topojson-client';
import type { FeatureCollection, Feature, Geometry, Position, GeoJsonProperties } from 'geojson';
import type { Topology } from 'topojson-specification';
import type { SKRSContext2D } from '@napi-rs/canvas';
export type TopoOrGeo = Topology | FeatureCollection<Geometry, GeoJsonProperties>;
import {BoundingBox, FlightLocation} from "./schema";
import {clampLat, normalizeLon, degToRad} from "./map_utils";

// Accept either DOM CanvasRenderingContext2D or SKRSContext2D from @napi-rs/canvas
type CanvasLike = CanvasRenderingContext2D | SKRSContext2D;

export function bboxForFlightDegrees(flight: FlightLocation, forwardRatio: number = 1.5) : { unified: BoundingBox, split: BoundingBox[] } {
    const baseDeg = 0.02;
    const speedScale = 200; // kt
    const altScale = 10000; // ft

    const speedMul: number = 1.5;
    const altMul: number = 0.8;

    const speedFactor = Math.min(1, Math.sqrt(flight.speed / speedScale));
    const altFactor = Math.min(1, Math.sqrt(flight.alt / altScale));

    const halfDeg = baseDeg * (1 + speedMul * speedFactor + altMul * altFactor);

    const fwd: number = halfDeg * forwardRatio;
    const backward: number = halfDeg / forwardRatio;

    const trackRad = degToRad(flight.track);
    const latRad = degToRad(flight.loc.lat);

    const fLat = fwd * Math.cos(trackRad);
    const fLon = fwd * Math.sin(trackRad) / Math.max(1e-4, Math.cos(latRad));
    const bLat = backward * Math.cos(trackRad + Math.PI);
    const bLon = backward * Math.sin(trackRad + Math.PI) / Math.max(1e-4, Math.cos(latRad));

    const lat1 = clampLat(flight.loc.lat + fLat);
    const lon1 = normalizeLon(flight.loc.long + fLon);
    const lat2 = clampLat(flight.loc.lat + bLat);
    const lon2 = normalizeLon(flight.loc.long + bLon);

    const minLat = clampLat(Math.min(lat1, lat2));
    const maxLat = clampLat(Math.max(lat1, lat2));

    const rawMinLon = normalizeLon(Math.min(lon1, lon2));
    const rawMaxLon = normalizeLon(Math.max(lon1, lon2));

    let span = rawMaxLon - rawMinLon;
    if (span < 0) span += 360;

    const box = {
        min: {
            lat: minLat,
            long: rawMinLon
        },
        max: {
            lat: maxLat,
            long: rawMaxLon
        }
    };
    if (span <= 180) {
        return {unified: box, split: [box]};
    }
    return {
        unified: box,
        split: [
            {
                min: {
                    lat: minLat,
                    long: rawMinLon
                },
                max: {
                    lat: maxLat,
                    long: 180
                }
            },
            {
                min: {
                    lat: minLat,
                    long: -180
                },
                max: {
                    lat: maxLat,
                    long: rawMaxLon
                }
            }
        ]
    };
}

// Merge query results from 1 or 2 bounding boxes and dedupe by id.
export function mergeBoxQueries<T>(boxes: BoundingBox[], query: (b: BoundingBox) => T[], idFn: (t: T) => string): T[] {
    const out: T[] = [];
    const seen = new Set<string>();
    for (const b of boxes) {
        const hits = query(b);
        for (const h of hits) {
            const id = idFn(h);
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(h);
        }
    }
    return out;
}

// Shift a longitude into a continuous frame near a reference longitude.
export function shiftLonToRef(lon: number, refLon: number): number {
    let v = normalizeLon(lon);
    // move v so difference to ref is in (-180, 180]
    while (v - refLon > 180) v -= 360;
    while (v - refLon <= -180) v += 360;
    return v;
}

// Typed recursive coordinate shifter using a GeoJSON Position nesting union.
type GeoCoords = Position | Position[] | Position[][] | Position[][][];

function shiftCoordsRecursive(coords: GeoCoords, refLon: number): GeoCoords {
    if (!Array.isArray(coords)) return coords;

    // Position -> [lon, lat, ...]
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lon = coords[0] as number;
        const lat = coords[1] as number;
        const rest = (coords as Position).slice(2);
        return [shiftLonToRef(lon, refLon), lat, ...rest] as Position;
    }

    // Otherwise recurse into nested arrays (rings, polygons, multipolygons)
    return (coords as unknown[]).map((c) => shiftCoordsRecursive(c as GeoCoords, refLon)) as GeoCoords;
}

// Return a new FeatureCollection with all coordinates longitude-shifted to be continuous near refLon.
export function shiftFeatureCollectionToRef(fc: FeatureCollection, refLon: number): FeatureCollection {
    const out: FeatureCollection = JSON.parse(JSON.stringify(fc));
    for (const f of out.features) {
        if (!f.geometry) continue;
        const g = f.geometry as Geometry;
        if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
            // safe to treat coordinates as nested Position arrays
            // @ts-ignore assign back with properly shifted coords
            g.coordinates = shiftCoordsRecursive(g.coordinates as GeoCoords, refLon) as any;
        }
    }
    return out;
}

// Choose a reference longitude for rendering; default to the flight longitude.
export function referenceLonForFlight(flight: FlightLocation): number {
    return normalizeLon(flight.loc.long);
}

// Simple equirectangular projector centered on refLon and fit to bbox -> pixel box
function createEquirectangularProjector(bbox: BoundingBox, width: number, height: number, refLon: number) {
    const ref = normalizeLon(refLon);
    function shiftLon(lon: number) {
        let v = normalizeLon(lon);
        while (v - ref > 180) v -= 360;
        while (v - ref <= -180) v += 360;
        return v;
    }

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
        shiftLon,
        ref,
    };
}

function isFC(x: unknown): x is FeatureCollection {
    return !!x && typeof x === 'object' && (x as any).type === 'FeatureCollection' && Array.isArray((x as any).features);
}
function isTopology(x: unknown): x is Topology {
    return !!x && typeof x === 'object' && (x as any).type === 'Topology' && !!(x as any).objects;
}
function isFeature(x: unknown): x is Feature {
    return !!x && typeof x === 'object' && (x as any).type === 'Feature' && 'geometry' in (x as any);
}

// Draw ocean + land (white land, light-gray ocean borders).
// - ctx: CanvasRenderingContext2D
// - topoOrGeo: TopoJSON root or GeoJSON FeatureCollection
// - bbox: visible area
// - width/height: canvas size in px
// - refLon: reference longitude to unwrap longitudes (use flight lon)
export function drawMapBackground(ctx: CanvasLike, topoOrGeo: TopoOrGeo, bbox: BoundingBox, width: number, height: number, refLon: number) {
    const proj = createEquirectangularProjector(bbox, width, height, refLon);

    let landFC: FeatureCollection | null = null;
    if (isFC(topoOrGeo)) {
        landFC = topoOrGeo;
    } else if (isTopology(topoOrGeo)) {
        const key = topoOrGeo.objects && (topoOrGeo.objects as any).land ? 'land' : Object.keys(topoOrGeo.objects)[0];
        if (key && topoOrGeo.objects[key]) {
            const res = topoFeature(topoOrGeo, topoOrGeo.objects[key]);
            if (isFC(res)) {
                landFC = res;
            } else if (isFeature(res)) {
                landFC = { type: 'FeatureCollection', features: [res] };
            }
        }
    }

    ctx.save();
    ctx.fillStyle = '#e9eef2';
    ctx.fillRect(0, 0, width, height);

    if (landFC && landFC.features && landFC.features.length > 0) {
        ctx.beginPath();
        for (const feat of landFC.features) {
            const geom = (feat as any).geometry;
            if (!geom) continue;
            const type = geom.type;
            const coords = geom.coordinates;
            if (!coords) continue;

            const polygons = type === 'Polygon' ? [coords] : coords;
            for (const poly of polygons) {
                for (let r = 0; r < poly.length; r++) {
                    const ring = poly[r];
                    if (!ring || ring.length === 0) continue;
                    for (let i = 0; i < ring.length; i++) {
                        const [lon, lat] = ring[i];
                        const [x, y] = proj.project(lat, lon);
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                }
            }
        }
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#cfd6db';
        ctx.lineWidth = Math.max(1, Math.min(2, (width + height) / 800));
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
}

// Draw the map background rotated so that `bearingDeg` points upward on the canvas.
// - bearingDeg: flight.track in degrees (0 = north). The function rotates canvas
//   so that the track points to the top of the canvas before drawing background.
// - note: any labels that should remain horizontal must be drawn after this call.
export function drawRotatedMapBackground(ctx: CanvasLike, topoOrGeo: TopoOrGeo, bbox: BoundingBox, width: number, height: number, refLon: number, bearingDeg: number) {
    const cx = width / 2;
    const cy = height / 2;
    const rad = degToRad(bearingDeg || 0);

    ctx.save();
    // rotate so that bearing points to canvas -Y (up)
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.translate(-cx, -cy);

    // draw background in rotated frame
    drawMapBackground(ctx, topoOrGeo, bbox, width, height, refLon);

    ctx.restore();
}