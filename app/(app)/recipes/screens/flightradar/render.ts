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
import type {
  FlightLocation,
  BoundingBox,
  ForeignFlightDataDisplay,
  Trail,
} from "./schema";

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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371.0;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
    zoom?: number;
    // whether to draw the aircraft glyph at center
    showAircraft?: boolean;
    // optional nearby flights to draw on the map
    nearby?: ForeignFlightDataDisplay[];
    // optional trail for the center flight (most recent first-to-last points)
    centerTrail?: Trail[];
  },
) {
  const DPR = opts.dpr ?? 1;
  const inputWidth = opts.width;
  const inputHeight = opts.height;

  // Always render into a square drawing area to keep map aspect consistent.
  const drawSize = Math.min(inputWidth, inputHeight);

  // Use `width`/`height` aliases throughout the existing codebase so older
  // references remain valid after switching to a square draw area.
  const width = drawSize;
  const height = drawSize;
  const canvas = createCanvas(
    Math.round(drawSize * DPR),
    Math.round(drawSize * DPR),
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
  // optional zoom passed by caller to control overlay filtering
  const zoom = (opts.zoom as number | undefined) ?? 5; // default to 5 for flight render context
  if (opts.boundingBox) {
    boxes = { unified: opts.boundingBox, split: [opts.boundingBox] } as any;
    refLon = opts.refLon ?? opts.boundingBox.min.long;
  } else {
    boxes = bboxForFlightDegrees(flight, forwardRatio);
    refLon = referenceLonForFlight(flight);
  }
  const combined = boxes.unified;

  // Add some padding so the rendered frame isn't overly tight. Use a larger
  // padding when the bbox was explicitly supplied, and a modest padding for
  // computed flight envelopes.
  {
    const latSpan = Math.max(1e-6, combined.max.lat - combined.min.lat);
    let lonSpan = combined.max.long - combined.min.long;
    if (lonSpan < 0) lonSpan += 360;
    const explicit = !!opts.boundingBox;
    const padFactor = explicit ? 0.45 : 0.2; // fraction of span to pad on each side
    const minPadDeg = explicit ? 0.06 : 0.02; // degrees (~6.7km vs ~2.2km)

    const padLat = Math.max(latSpan * padFactor, minPadDeg);
    const padLon = Math.max(lonSpan * padFactor, minPadDeg);

    combined.min.lat = clampLat(combined.min.lat - padLat);
    combined.max.lat = clampLat(combined.max.lat + padLat);

    combined.min.long = normalizeLon(combined.min.long - padLon);
    combined.max.long = normalizeLon(combined.max.long + padLon);
  }

  if (process.env.FLIGHTMAP_DEBUG === "1") {
    console.log("renderFrameForFlight (used bounding):", {
      DPR,
      width,
      height,
      refLon,
      bounding: {
        min: {
          lat: combined.min.lat.toFixed(6),
          long: combined.min.long.toFixed(6),
        },
        max: {
          lat: combined.max.lat.toFixed(6),
          long: combined.max.long.toFixed(6),
        },
      },
    });
  }

  // Center coordinates for the square drawing area
  const cx = drawSize / 2;
  const cy = drawSize / 2;
  const rad = degToRad(flight.track || 0);

  const doRotate = (process.env.FLIGHTMAP_NO_ROTATE || "1") !== "1";

  const nearby = opts.nearby ?? [];

  // If rotation is enabled (default), rotate canvas so track points up and
  // draw background + overlays in that rotated frame. When debugging seam
  // issues, set FLIGHTMAP_NO_ROTATE=1 to skip rotation and draw everything
  // unrotated to check whether the rotation transform causes the artifact.
  if (doRotate) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.translate(-cx, -cy);

    // Draw background into the square drawing area
    drawMapBackground(ctx, topo, combined, drawSize, drawSize, refLon);

    // Projector for overlays
    const proj = createProjector(combined, drawSize, drawSize, refLon);

    // Query overlays and dedupe
    let airports = mergeBoxQueries(
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

    // If zoom is small (wide area) or at threshold, hide airports without runways.
    if (typeof zoom === "number" && zoom <= 6) {
      const runwayByAirport = new Set<string | number>();
      for (const rw of runways) {
        if (rw.airport_ref) runwayByAirport.add(String(rw.airport_ref));
        if (rw.airport_ident) runwayByAirport.add(String(rw.airport_ident));
      }
      // keep airports that match runways by airport_ref or ident or iata
      for (let i = airports.length - 1; i >= 0; i--) {
        const a = airports[i] as any;
        const match =
          runwayByAirport.has(String(a.id)) ||
          runwayByAirport.has(String(a.ident)) ||
          runwayByAirport.has(String(a.iata));
        if (!match) airports.splice(i, 1);
      }
    }

    if (typeof zoom === "number" && zoom <= 3) {
      airports = [];
    }

    // Draw overlays in rotated frame
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1.5;
    for (const rw of runways) {
      // Skip runway data error
      const maxRunwayKm = Number(process.env.FLIGHTMAP_MAX_RUNWAY_KM ?? 100);
      const leLon = rw.le_long;
      const heLon = rw.he_long;
      const distKm = haversineKm(rw.le_lat, leLon, rw.he_lat, heLon);
      if (!isNaN(maxRunwayKm) && distKm > maxRunwayKm) {
        if (process.env.FLIGHTMAP_DEBUG === "1") {
          console.log("skipping runway (too long)", {
            id: rw.id ?? null,
            distKm,
          });
        }
        continue;
      }
      const [x1, y1] = proj.project(
        rw.le_lat,
        shiftLonToRef(rw.le_long, refLon),
      );
      const [x2, y2] = proj.project(
        rw.he_lat,
        shiftLonToRef(rw.he_long, refLon),
      );
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

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    for (const n of navaids) {
      const [x, y] = proj.project(n.lat, shiftLonToRef(n.lon, refLon));
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore(); // overlays in rotated frame
    ctx.restore(); // finish rotation
  } else {
    // No rotation: draw background and overlays directly
    drawMapBackground(ctx, topo, combined, width, height, refLon);

    const proj = createProjector(combined, width, height, refLon);

    // Draw center trail (if provided) as a polyline in map coordinates.
    try {
      const trail = opts.centerTrail ?? [];
      if (trail && trail.length > 1) {
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        let started = false;
        for (const t of trail) {
          const lat = t.loc.loc.lat;
          const lon = shiftLonToRef(t.loc.loc.long, refLon);
          const [x, y] = proj.project(lat, lon);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    } catch (e) {
      // ignore
    }
    let airports = mergeBoxQueries(
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

    // If zoom is small (wide area) or at threshold, hide airports without runways.
    if (typeof zoom === "number" && zoom <= 6) {
      const runwayByAirport = new Set<string | number>();
      for (const rw of runways) {
        if (rw.airport_ref) runwayByAirport.add(String(rw.airport_ref));
        if (rw.airport_ident) runwayByAirport.add(String(rw.airport_ident));
      }
      for (let i = airports.length - 1; i >= 0; i--) {
        const a = airports[i] as any;
        const match =
          runwayByAirport.has(String(a.id)) ||
          runwayByAirport.has(String(a.ident)) ||
          runwayByAirport.has(String(a.iata));
        if (!match) airports.splice(i, 1);
      }
    }

    if (typeof zoom === "number" && zoom <= 3) {
      airports = [];
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1.5;
    for (const rw of runways) {
      // Skip runway data error
      const maxRunwayKm = Number(process.env.FLIGHTMAP_MAX_RUNWAY_KM ?? 100);
      const leLon = rw.le_long;
      const heLon = rw.he_long;
      const distKm = haversineKm(rw.le_lat, leLon, rw.he_lat, heLon);
      if (!isNaN(maxRunwayKm) && distKm > maxRunwayKm) {
        if (process.env.FLIGHTMAP_DEBUG === "1") {
          console.log("skipping runway (too long)", {
            id: rw.id ?? null,
            distKm,
          });
        }
        continue;
      }
      const [x1, y1] = proj.project(
        rw.le_lat,
        shiftLonToRef(rw.le_long, refLon),
      );
      const [x2, y2] = proj.project(
        rw.he_lat,
        shiftLonToRef(rw.he_long, refLon),
      );
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

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    for (const n of navaids) {
      const [x, y] = proj.project(n.lat, shiftLonToRef(n.lon, refLon));
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Draw nearby flights (icons + optional labels)
  try {
    const proj = createProjector(combined, width, height, refLon);
    if (process.env.FLIGHTMAP_DEBUG === "1") {
      console.log("render: nearby count", nearby.length);
      if (nearby.length > 0) {
        const s = nearby[0].flight as any;
        console.log("render: nearby sample", { id: s.id, loc: s.loc });
      }
    }
    for (const entry of nearby) {
      const ff = entry.flight;
      const lat = ff.loc.loc.lat;
      const lon = shiftLonToRef(ff.loc.loc.long, refLon);
      const [x, y] = proj.project(lat, lon);

      const track = ff.loc.track ?? 0;
      const planeSize = 6;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-degToRad(track || 0));
      ctx.fillStyle = "#555";
      ctx.beginPath();
      ctx.moveTo(0, -planeSize);
      ctx.lineTo(planeSize / 2, planeSize / 2);
      ctx.lineTo(-planeSize / 2, planeSize / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // label only when zoom meets requirement
      const req = entry.parameter?.require_zoom ?? 0;
      if (typeof zoom === "number" && zoom >= req) {
        ctx.fillStyle = "#000";
        ctx.font = "900 14px sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(
          ff.id.callsign || ff.id.hex || "",
          Math.round(x + planeSize + 4),
          Math.round(y - 6),
        );
      }
    }
  } catch (e) {
    // ignore
  }

  // Draw visible bounding box (for debugging) in canvas coordinates
  if (process.env.FLIGHTMAP_DEBUG === "1") {
    try {
      const bbMin = combined.min;
      const bbMax = combined.max;
      const [x1, y1] = createProjector(combined, width, height, refLon).project(
        bbMin.lat,
        bbMin.long,
      );
      const [x2, y2] = createProjector(combined, width, height, refLon).project(
        bbMax.lat,
        bbMax.long,
      );
      ctx.save();
      ctx.strokeStyle = "rgba(255,0,0,0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.abs(x2 - x1),
        Math.abs(y2 - y1),
      );
      ctx.restore();
    } catch (e) {
      // ignore
    }
  }

  // Draw aircraft glyph at center (upright) when requested
  // Default to false to avoid plotting a plane for static locations/airports
  const showAircraft = opts.showAircraft ?? false;
  if (process.env.FLIGHTMAP_DEBUG === "1") {
    try {
      console.log("render: center-plane", {
        showAircraft,
        passed: opts.showAircraft,
        zoom: typeof zoom === "number" ? zoom : null,
        ident: (flight as any)?.ident ?? (flight as any)?.id?.callsign ?? null,
      });
    } catch (e) {
      // ignore
    }
  }
  if (showAircraft) {
    // Draw the aircraft glyph rotated to the flight's bearing so it points
    // in the correct direction on the final image. Keep the identifying
    // label horizontal by drawing it after restoring the rotation.
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.translate(cx, cy);
    if (!doRotate) {
      ctx.rotate(rad); // when not rotating, point glyph along track
    }
    const planeSize = Math.max(10, Math.min(24, (width + height) / 60));
    ctx.beginPath();
    ctx.moveTo(0, -planeSize);
    ctx.lineTo(planeSize / 2, planeSize / 2);
    ctx.lineTo(-planeSize / 2, planeSize / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Label horizontally (not rotated)
    ctx.fillStyle = "#000";
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText((flight as any).ident || "", cx + planeSize + 6, cy);
  }
  ctx.imageSmoothingEnabled = false;
  const buf = canvas.toBuffer("image/png");
  // Optional debug dump
  dumpDebugPNG(buf, "trmnl_flightmap_debug.png");
  return buf;
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
