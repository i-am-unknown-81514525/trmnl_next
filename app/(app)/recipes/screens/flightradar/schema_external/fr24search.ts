type ResultType = "operator" | "live" | "airport" | "schedule" | "aircraft"
type MatchType = "begins" | "contains" | "icao"


export interface FR24SearchResult {
    result: FR24SearchEntry
}

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

export interface FR24SearchEntry {

}