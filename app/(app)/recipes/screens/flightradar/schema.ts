export interface Location {
    lat: number,
    long: number
}

export interface FlightID {
    hex: string,
    callsign: string,
    fr24_hex8: string | null;
}

export interface ForeignFlightData {
    id: FlightID
    loc: Location
}

export interface Trail {
    dt: number,
    loc: Location,
    speed: number,
    height: number,
    track: number
}

export interface FlightData {
    id: FlightID
    trails: Trail[]
}

export interface Airport {
    code: string,
    loc: Location
}

type TrackingKind =
    | { kind: 'static_location', location: Location }
    | { kind: 'static_airport', airport: Airport }
    | { kind: 'flight'; flight: FlightData };

export interface DisplayData {
    tracking: TrackingKind,
    center_loc: Location,
    nearby: ForeignFlightData[]
}