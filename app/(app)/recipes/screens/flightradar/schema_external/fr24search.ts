type ResultType = "operator" | "live" | "airport" | "schedule" | "aircraft";
type MatchType = "begins" | "contains" | "icao" | "iata";
type AllDetailType =
	| FR24AirportDetail
	| FR24LiveDetail
	| FR24OperatorDetail
	| FR24ScheduleDetail
	| FR24AircraftDetail;

export interface FR24AirportDetail {
	lat: number;
	lon: number;
	size: number;
}

export interface FR24AircraftDetail {
	owner: string;
	equip: string;
	hex: string;
	operator_id: number;
	logo: string;
}

export interface FR24ScheduleDetail {
	logo: string;
	callsign: string;
	flight: string;
	operator: string;
	operator_id: number;
}

export interface FR24LiveDetail {
	lat: number;
	long: number;
	schd_from: string;
	schd_to: string;
	ac_type: string;
	route: string; // display only
	logo: string;
	reg: string;
	callsign: string;
	flight: string;
	operator: string;
	operator_id: number;
}

export interface FR24OperatorDetail {
	operator_id: number;
	iata: string;
	logo: string;
}

export interface FR24ResultStats {
	all: number;
	airport: number;
	operator: number;
	live: number;
	schedule: number;
	aircraft: number;
}

export interface FR24SearchEntry {
	id: string;
	label: string;
	detail: AllDetailType;
	type: ResultType;
	match: MatchType;
}

export interface FR24SearchResult {
	results: FR24SearchEntry[];
	info: { grpcEnabled: true };
	stats: { total: FR24ResultStats; count: FR24ResultStats };
}

export function getLive(
	callsign: string,
	result: FR24SearchResult,
): {
	id: string;
	label: string;
	detail: FR24LiveDetail;
	type: ResultType;
	match: MatchType;
} | null {
	for (let i = 0; i < result.results.length; i++) {
		const entry: FR24SearchEntry = result.results[i];
		if (entry.type !== "live") {
			continue;
		}
		const detail: FR24LiveDetail = <FR24LiveDetail>entry.detail;
		if (detail.callsign === callsign) {
			return {
				id: entry.id,
				label: entry.label,
				detail: detail,
				type: entry.type,
				match: entry.match,
			};
		}
	}
	return null;
}

export function getAirport(
	code: string,
	result: FR24SearchResult,
): {
	id: string;
	label: string;
	detail: FR24AirportDetail;
	type: ResultType;
	match: MatchType;
} | null {
	for (let i = 0; i < result.results.length; i++) {
		const entry: FR24SearchEntry = result.results[i];
		if (entry.type !== "airport") {
			continue;
		}
		const detail: FR24AirportDetail = <FR24AirportDetail>entry.detail;
		if (entry.match === "iata" && entry.id === code) {
			return {
				id: entry.id,
				label: entry.label,
				detail: detail,
				type: entry.type,
				match: entry.match,
			};
		}
	}
	return null;
}
