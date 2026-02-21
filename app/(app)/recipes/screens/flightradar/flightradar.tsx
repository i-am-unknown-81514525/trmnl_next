import React from "react";
import { PreSatori } from "@/utils/pre-satori";
import type { DisplayData, FlightLocation } from "./schema";
import { renderFrameForFlight } from "./render";
import getData from "./getData";

// 	width = 800,
// 	height = 480,
// 	...data
// }: DisplayData & { width?: number; height?: number }) {
// 	// const locParam = props.locParam ?? "loc:51.47,-0.45,8";
// 	//
// 	// // Prefer data passed in via props (render pipeline). Only fall back to
// 	// // explicit fetch when no data was provided (standalone invocation).
// 	// let data: DisplayData;
// 	// if (props && (props as DisplayData).tracking) {
// 	// 	data = props as DisplayData;
// 	// } else {
// 	// 	const { default: getData } = await import("./getData");
// 	// 	data = await getData({ locParam });
// 	// }

export default async function FlightRadar(
  props?: Partial<DisplayData> & { locParam?: string },
) {
  // If the renderer passed full DisplayData as `props`, prefer it.
  // Otherwise derive `locParam` and fetch via `getData`.
  let data: DisplayData;
  if (props && (props as DisplayData).tracking) {
    // Pre-filter incoming DisplayData props to avoid sending huge
    // objects (notably large topo feature collections) into this
    // server component. We create a small trimmed copy and use that
    // for rendering.
    const raw = props as DisplayData;

    const toRad = (d: number) => (d * Math.PI) / 180;
    const haversine = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => {
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // nearby trimming: by max distance and count
    const maxNearbyKm = Number(process.env.FLIGHTMAP_NEARBY_MAX_KM ?? 250);
    const maxNearbyCount = Number(process.env.FLIGHTMAP_NEARBY_MAX_COUNT ?? 60);
    let nearbyFiltered = (raw.nearby ?? []).slice();
    if (raw.center_loc) {
      nearbyFiltered = nearbyFiltered
        .map((n) => ({
          item: n,
          d: haversine(
            n.flight.loc.loc.lat,
            n.flight.loc.loc.long,
            raw.center_loc!.lat,
            raw.center_loc!.long,
          ),
        }))
        .filter((x) => x.d <= maxNearbyKm)
        .sort((a, b) => a.d - b.d)
        .slice(0, maxNearbyCount)
        .map((x) => x.item);
    } else {
      nearbyFiltered = nearbyFiltered.slice(0, maxNearbyCount);
    }

    // land_geo trimming: keep only features overlapping the view bbox
    const bound = raw.bound;
    const padDeg = 0.5;
    const bbMinLat = bound.min.lat - padDeg;
    const bbMaxLat = bound.max.lat + padDeg;
    const bbMinLon = bound.min.long - padDeg;
    const bbMaxLon = bound.max.long + padDeg;

    function featureBBox(feature: any) {
      let minLat = 90;
      let maxLat = -90;
      let minLon = 180;
      let maxLon = -180;
      function walk(coords: any) {
        if (typeof coords[0] === "number" && typeof coords[1] === "number") {
          const lon = coords[0];
          const lat = coords[1];
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          return;
        }
        for (const c of coords) walk(c);
      }
      try {
        const geom = feature.geometry || feature;
        if (!geom || !geom.coordinates) return null;
        walk(geom.coordinates);
        return { minLat, maxLat, minLon, maxLon };
      } catch (e) {
        return null;
      }
    }

    let landFiltered = raw.land_geo;
    try {
      if (raw.land_geo && (raw.land_geo as any).type === "FeatureCollection") {
        const feats = (raw.land_geo as any).features || [];
        const kept: any[] = [];
        for (const f of feats) {
          const fb = featureBBox(f);
          if (!fb) continue;
          if (
            fb.maxLat >= bbMinLat &&
            fb.minLat <= bbMaxLat &&
            fb.maxLon >= bbMinLon &&
            fb.minLon <= bbMaxLon
          ) {
            kept.push(f);
          }
        }
        landFiltered = { type: "FeatureCollection", features: kept } as any;
      }
    } catch (e) {
      landFiltered = raw.land_geo;
    }

    data = {
      ...raw,
      nearby: nearbyFiltered,
      land_geo: landFiltered,
    } as DisplayData;
    if (process.env.FLIGHTMAP_DEBUG === "1") {
      console.log(
        "FlightRadar: rendering with provided DisplayData props (filtered)",
      );
    }
  } else {
    const locParam = props?.locParam ?? "loc:51.47,-0.45,0";
    if (process.env.FLIGHTMAP_DEBUG === "1") {
      console.log("FlightRadar: rendering with locParam:", locParam);
    }
    data = await getData({ locParam });
  }

  let flightLoc: FlightLocation = {
    loc: data.center_loc,
    track: 0,
    alt: 0,
    speed: 0,
  };
  if (data.tracking.kind === "flight") {
    flightLoc = data.tracking.flight.curr.loc;
  }
  // format nearby list
  const nearbyItems = data.nearby || [];

  const filteredNearby = nearbyItems.filter(
    (x) =>
      data.tracking.kind !== "flight" ||
      x.flight.id.callsign !== data.tracking.flight.id.callsign,
  );
  // render map image server-side
  let mapImg: string | null = null;
  try {
    const bbox = data.bound;
    const avgLon = (bbox.min.long + bbox.max.long) / 2;
    // normalize avgLon into [-180,180)
    const refLon = ((((avgLon + 180) % 360) + 360) % 360) - 180;
    const buf = await renderFrameForFlight(data.land_geo as any, flightLoc, {
      width: 300,
      height: 300,
      // pass the precomputed bounding box from getData so zoom is respected
      boundingBox: data.bound,
      refLon,
      zoom: data.zoom,
      // show the central aircraft glyph when we're tracking a flight so the
      // map isn't empty even if no topo/land geometry is available.
      showAircraft: data.tracking.kind === "flight",
      nearby: filteredNearby,
      centerTrail:
        data.tracking.kind === "flight"
          ? data.tracking.flight.trails
          : undefined,
    });
    mapImg = `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    mapImg = null;
  }

  // sort nearby: moving (>25 kt) first, then by distance (km) ascending
  const sortedNearby = [...filteredNearby].sort((a, b) => {
    const aSpeed = a.flight.loc.speed ?? 0;
    const bSpeed = b.flight.loc.speed ?? 0;
    const aMoving = aSpeed > 25 ? 1 : 0;
    const bMoving = bSpeed > 25 ? 1 : 0;
    if (aMoving !== bMoving) return bMoving - aMoving; // moving first
    if (!data.center_loc) return 0;
    const aLoc = a.flight.loc.loc;
    const bLoc = b.flight.loc.loc;
    const aDist = haversineKm(
      aLoc.lat,
      aLoc.long,
      data.center_loc.lat,
      data.center_loc.long,
    );
    const bDist = haversineKm(
      bLoc.lat,
      bLoc.long,
      data.center_loc.lat,
      data.center_loc.long,
    );
    return aDist - bDist;
  });

  // compute great-circle distance in kilometers between two lat/lon points
  function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371; // km
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

  // details depending on type
  function Details() {
    const containerStyle: React.CSSProperties = {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "flex-start",
      boxSizing: "border-box",
      color: "#000",
    };

    const titleStyle: React.CSSProperties = {
      fontSize: 16,
      fontWeight: 900,
      margin: 0,
      marginBottom: 6,
    };

    const monoLarge: React.CSSProperties = {
      fontFamily: "monospace",
      fontSize: 28,
      lineHeight: 1.05,
      margin: 0,
    };

    const smallMuted: React.CSSProperties = {
      fontSize: 12,
      color: "#555",
      marginTop: 6,
    };

    const formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (data.tracking.kind === "flight") {
      const md = data.tracking.flight.metadata;
      let content = "";
      if (md?.time_data?.real.departure) {
        content +=
          "Departure - " +
          formatter.format(new Date(md.time_data.real.departure * 1000));
      } else if (md?.time_data?.estimated.departure) {
        content +=
          "Est. Depart - " +
          formatter.format(new Date(md.time_data.estimated.departure * 1000));
      } else if (md?.time_data?.scheduled.departure) {
        content +=
          "Scheduled - " +
          formatter.format(new Date(md.time_data.scheduled.departure * 1000));
      } else {
        content += "Departure - N/A";
      }
      content += "\n";
      if (md?.time_data?.real.arrival) {
        content +=
          "Arrival - " +
          formatter.format(new Date(md.time_data.real.arrival * 1000));
      } else if (md?.time_data?.estimated.arrival) {
        content +=
          "Est. Arrival - " +
          formatter.format(new Date(md?.time_data.estimated.arrival * 1000));
      } else if (md?.time_data?.scheduled.arrival) {
        content +=
          "Sch. Arrival - " +
          formatter.format(new Date(md?.time_data.scheduled.arrival * 1000));
      } else {
        content += "Arrival - N/A";
      }

      const coord = `${data.tracking.flight.curr.loc.loc.lat.toFixed(4)}, ${data.tracking.flight.curr.loc.loc.long.toFixed(4)}`;
      const attr = `${data.tracking.flight.curr.loc.speed} kt - ${data.tracking.flight.curr.loc.alt} ft - ${data.tracking.flight.curr.loc.track}°`;

      return (
        <div style={containerStyle}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            Callsign: {data.tracking.flight.id.callsign} Hex:{" "}
            {data.tracking.flight.id.hex}
          </div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{content}</div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            Src: {md?.src?.code ?? "N/A"} - Dest: {md?.dest?.code ?? "N/A"}
          </div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{coord}</div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{attr}</div>
        </div>
      );
    }

    if (data.tracking.kind === "static_airport") {
      const ap = data.tracking.airport;
      interface DisplayFlight {
        time: number | null; // Est. Departure/Arrival Time
        callsign: string | null;
        airline: string | null;
        alt_loc: string | null; // Departure/Arrival location (differ to current)
        kind: "departure" | "arrival";
        accuracy: "real" | "estimated" | "scheduled" | null;
      }
      interface DisplayFlightTimed {
        time: number; // Est. Departure/Arrival Time
        callsign: string | null;
        airline: string | null;
        alt_loc: string | null; // Departure/Arrival location (differ to current)
        kind: "departure" | "arrival";
        accuracy: "estimated" | "scheduled";
      }
      const departure_flight: DisplayFlight[] =
        data.tracking.airport.departures?.map((x) => ({
          time:
            x.flight.time.real.departure ||
            x.flight.time.estimated.departure ||
            x.flight.time.scheduled.departure ||
            null,
          callsign: x.flight.identification?.callsign || null,
          airline: x.flight.airline?.short || x.flight.airline?.name || null,
          alt_loc:
            x.flight.airport?.real?.code?.iata ||
            x.flight.airport?.destination?.code?.iata ||
            null,
          kind: "departure",
          accuracy: x.flight.time.real.departure
            ? "real"
            : x.flight.time.estimated.departure
              ? "estimated"
              : x.flight.time.scheduled.departure
                ? "scheduled"
                : null,
        })) || [];
      const arrival_flight: DisplayFlight[] =
        data.tracking.airport.departures?.map((x) => ({
          time:
            x.flight.time.real.arrival ||
            x.flight.time.estimated.arrival ||
            x.flight.time.scheduled.arrival ||
            null,
          callsign: x.flight.identification?.callsign || null,
          airline: x.flight.airline?.short || x.flight.airline?.name || null,
          alt_loc: x.flight.airport?.origin?.code?.iata || null,
          kind: "arrival",
          accuracy: x.flight.time.real.arrival
            ? "real"
            : x.flight.time.estimated.arrival
              ? "estimated"
              : x.flight.time.scheduled.arrival
                ? "scheduled"
                : null,
        })) || [];
      const curr = Date.now() / 1000 - 60; // 1 minutes toralence :)
      // @ts-ignore
      const combined: DisplayFlightTimed[] = [
        ...departure_flight,
        ...arrival_flight,
      ]
        .filter(
          (x) =>
            x.time && x.time >= curr && x.accuracy && x.accuracy !== "real",
        ) // filter happened event
        // @ts-ignore the filter prevented time to bu nullable
        .toSorted((a, b) => a.time - b.time);
      function capitalizeWords(string: string): string {
        return string
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }

      return (
        <div>
          <ul
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              height: "100%",
              overflow: "hidden",
              padding: 0,
              margin: 0,
              listStyle: "none",
            }}
          >
            {combined.map((n, i) => {
              return (
                <li
                  key={i}
                  style={{
                    padding: "2px 2px",
                    borderBottom: "1px solid #ffffff",
                    background: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      ...containerStyle,
                      fontWeight: 900,
                      fontSize: 16,
                      alignItems: "start",
                      textAlign: "left",
                    }}
                  >
                    {n.callsign || "N/A"}
                    {" - "}
                    {/*<td>{n.airline || "N/A"}</td>*/}

                    {capitalizeWords(n.kind)[0]}
                    {"."}

                    {" - "}

                    {capitalizeWords(n.accuracy)[0]}
                    {"."}

                    {" - "}
                    {formatter.format(new Date(n.time * 1000))}
                    {" - "}
                    {n.alt_loc || "N/A"}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
  }

  return (
    <PreSatori width={800} height={480}>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "center",
          padding: 8,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            border: "16px solid #000",
            borderRadius: 10,
            overflow: "hidden",
            background: "#fff",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              padding: 16,
              gap: 16,
              backgroundColor: "#ffffff",
              color: "#000000",
            }}
          >
            {/* Left column */}
            <div
              style={{
                width: 360,
                minWidth: 320,
                maxWidth: 480,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 300,
                  height: 300,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#ffffff",
                  border: "1px solid #ffffff",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                {mapImg ? (
                  <picture>
                    <source srcSet={mapImg} type="image/png" />
                    <img
                      src={mapImg}
                      alt="map"
                      width={300}
                      height={300}
                      style={{
                        width: "100%",
                        height: "100%",
                        maxWidth: "300px",
                        objectFit: "contain",
                        filter: "grayscale(100%) contrast(0.95) brightness(1)",
                      }}
                    />
                  </picture>
                ) : (
                  <div style={{ margin: "auto" }}>No map available</div>
                )}
              </div>
              <div
                style={{
                  flex: 1,
                  border: "1px solid #ffffff",
                  borderRadius: 6,
                  padding: 0,
                  boxSizing: "border-box",
                  height: 180,
                }}
              >
                <Details />
              </div>
            </div>

            {/* Right column */}
            <div
              style={{
                flex: 1,
                paddingLeft: 8,
                boxSizing: "border-box",
                height: "100%",
                borderRight: "1px solid #000",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
              }}
            >
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  height: "100%",
                  overflow: "hidden",
                  padding: 0,
                  margin: 0,
                  listStyle: "none",
                }}
              >
                {sortedNearby.map((n, i) => {
                  const loc = n.flight.loc.loc;
                  const track = n.flight.loc.track ?? 0;
                  const alt = n.flight.loc.alt ?? 0;
                  const speed = n.flight.loc.speed ?? 0;
                  const distKm = data.center_loc
                    ? haversineKm(
                        loc.lat,
                        loc.long,
                        data.center_loc.lat,
                        data.center_loc.long,
                      ).toFixed(1)
                    : "-";
                  return (
                    <li
                      key={i}
                      style={{
                        padding: "12px 14px",
                        borderBottom: "1px solid #ffffff",
                        background: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          minWidth: 150,
                        }}
                      >
                        <div style={{ fontSize: 22, fontWeight: 900 }}>
                          {n.flight.id.callsign || "N/A"} ({n.flight.id.hex})
                        </div>
                        <div
                          style={{
                            fontSize: 22,
                            color: "#000",
                            fontWeight: 900,
                          }}
                        >
                          {Math.round(alt)} m - {Math.round(speed)} kt -{" "}
                          {Math.round(track)}°
                        </div>
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          display: "flex",
                          flexDirection: "column",
                          minWidth: 150,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 22,
                            color: "#000",
                            fontWeight: 900,
                          }}
                        >
                          {loc.lat.toFixed(4)}, {loc.long.toFixed(4)}
                        </div>
                        <div
                          style={{
                            fontSize: 22,
                            color: "#555",
                            fontWeight: 900,
                          }}
                        >
                          {distKm} km
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </PreSatori>
  );
}
// https://api.flightradar24.com/common/v1/flight-playback.json?flightId=3e1f9a70&timestamp=1769798100
// [8:38 PM]https://www.flightradar24.com/aircraft/images/?aircraft=4073A0
// [8:39 PM]https://www.flightradar24.com/v1/search/web/find?query=EZY16CH&limit=50 8 digit id available from here, with the other flight ID: U22934
// [8:40 PM]https://api.flightradar24.com/common/v1/flight/list.json?&fetchBy=flight&page=1&limit=25&query=U22934 use the flight id, and find the one in the correct time to get the hex id: 4073A0
// [8:40 PM]and you can get the image
