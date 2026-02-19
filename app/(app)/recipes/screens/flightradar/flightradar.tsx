import React from "react";
import getData from "./getData";
import type { DisplayData, FlightLocation } from "./schema";
import { renderFrameForFlight } from "./render";

export default async function FlightRadar({
	locParam = "loc:51.47,-0.45,8",
}: {
	locParam?: string;
}) {
	const data: DisplayData = await getData({ locParam });

	let flightLoc: FlightLocation = {
		loc: data.center_loc,
		track: 0,
		alt: 0,
		speed: 0,
	};
	if (data.tracking.kind === "flight") {
		flightLoc = data.tracking.flight.curr.loc;
	}

	// render map image server-side
	let mapImg: string | null = null;
	try {
		const buf = await renderFrameForFlight(data.land_geo as any, flightLoc, {
			width: 360,
			height: 200,
		});
		mapImg = `data:image/png;base64,${buf.toString("base64")}`;
	} catch (e) {
		mapImg = null;
	}

	// format nearby list
	const nearbyItems = data.nearby || [];

	// details depending on type
	function Details() {
		if (data.tracking.kind === "flight") {
			const md = data.tracking.flight.metadata;
			return (
				<div>
					<h3 className="text-lg font-bold">Flight Details</h3>
					<div>Callsign: {data.tracking.flight.id.callsign}</div>
					<div>Hex: {data.tracking.flight.id.hex}</div>
					<div>Est: {md?.time_data ? JSON.stringify(md.time_data) : "N/A"}</div>
					<div>
						Src: {md?.src?.code ?? "N/A"} Dest: {md?.dest?.code ?? "N/A"}
					</div>
				</div>
			);
		}
		if (data.tracking.kind === "static_airport") {
			const ap = data.tracking.airport;
			return (
				<div>
					<h3 className="text-lg font-bold">Airport</h3>
					<div>
						{ap.code} — {ap.name}
					</div>
					<div>Combined departures/arrivals placeholder</div>
				</div>
			);
		}

		return (
			<div className="flex flex-col items-center justify-center h-full">
				<h3 className="text-4xl font-mono">{new Date().toUTCString()}</h3>
				<div className="text-sm mt-2">UTC Time (location)</div>
			</div>
		);
	}

	return (
		<div className="flex w-full h-full p-4 gap-4 bg-white">
			<div className="w-2/3 pr-2">
				<h2 className="text-2xl font-semibold mb-2">Nearby Flights</h2>
				<ul className="space-y-2 overflow-auto max-h-130">
					{nearbyItems.map((n, i) => (
						<li key={i} className="p-2 border rounded hover:bg-gray-50">
							<div className="font-medium">
								{n.flight.id.callsign} ({n.flight.id.hex})
							</div>
							<div className="text-sm text-gray-600">
								{n.flight.loc.loc.lat.toFixed(3)},{" "}
								{n.flight.loc.loc.long.toFixed(3)}
							</div>
						</li>
					))}
				</ul>
			</div>

			<div className="w-1/3 flex flex-col gap-2">
				<div className="h-48 bg-gray-100 border rounded overflow-hidden flex items-center justify-center">
					{mapImg ? (
						<img
							src={mapImg}
							alt="map"
							className="w-full h-full object-cover"
						/>
					) : (
						<div>No map available</div>
					)}
				</div>
				<div className="flex-1 border rounded p-3">
					<Details />
				</div>
			</div>
		</div>
	);
}
// https://api.flightradar24.com/common/v1/flight-playback.json?flightId=3e1f9a70&timestamp=1769798100
// [8:38 PM]https://www.flightradar24.com/aircraft/images/?aircraft=4073A0
// [8:39 PM]https://www.flightradar24.com/v1/search/web/find?query=EZY16CH&limit=50 8 digit id available from here, with the other flight ID: U22934
// [8:40 PM]https://api.flightradar24.com/common/v1/flight/list.json?&fetchBy=flight&page=1&limit=25&query=U22934 use the flight id, and find the one in the correct time to get the hex id: 4073A0
// [8:40 PM]and you can get the image
