import { feature as topoFeature } from 'topojson-client';
import type {FeatureCollection} from "geojson";
import {BoundingBox, FlightLocation} from "./schema";
import {clampLat, normalizeLon, degToRad} from "./map_utils";

export function bboxForFlightDegrees(flight: FlightLocation, forwardRatio: number = 1.5) : BoundingBox[] {
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

    if (span <= 180) {
        return [
            {
                min: {
                    lat: minLat,
                    long: rawMinLon
                },
                max: {
                    lat: maxLat,
                    long: rawMaxLon
                }
            }
        ];
    }
    return [
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
    ];
}