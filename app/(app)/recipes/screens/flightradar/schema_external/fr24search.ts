type ResultType = "operator" | "live" | "airport" | "schedule" | "aircraft";
type MatchType = "begins" | "contains" | "icao";
type AllDetailType = FR24AirportDetail | FR24LiveDetail | FR24OperatorDetail | FR24ScheduleDetail | FR24AircraftDetail;


export interface FR24AirportDetail {
    lat: number,
    long: number,
    size: number
}

export interface FR24AircraftDetail {
    owner: string,
    equip: string,
    hex: string,
    operator_id: number,
    logo: string
}

export interface FR24ScheduleDetail {
    logo: string,
    callsign: string,
    flight: string,
    operator: string,
    operator_id: number
}

export interface FR24LiveDetail {
    lat: number,
    long: number,
    schd_from: string,
    schd_to: string,
    ac_type: string,
    route: string, // display only
    logo: string,
    reg: string,
    callsign: string,
    flight: string,
    operator: string,
    operator_id: number
}

export interface FR24OperatorDetail {
    operator_id: number,
    iata: string,
    logo: string
}

export interface FR24ResultStats {
    all: number,
    airport: number,
    operator: number,
    live: number,
    schedule: number,
    aircraft: number
}

export interface FR24SearchEntry {
    id: string,
    label: string,
    detail: AllDetailType,
    type: ResultType,
    match: MatchType,
    name: string
}

export interface FR24SearchResult {
    result: FR24SearchEntry,
    info: {grpcEnabled: true},
    stats: {total: FR24ResultStats, count: FR24ResultStats}
}

