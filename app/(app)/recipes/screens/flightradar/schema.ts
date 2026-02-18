export interface Location {
    lat: number,
    long: number
}

export interface FlightLocation {
    loc: Location,
    track: number,
    alt: number,
    speed: number
}

export interface PartialFlightLocation {
    loc: Location,
    track: number | null,
    alt: number | null,
    speed: number | null
}

export interface FlightID {
    hex: string,
    callsign: string,
    fr24_hex8: string | null;
}

export interface ForeignFlightData {
    id: FlightID
    loc: FlightLocation | PartialFlightLocation
}

export interface Trail {
    timestamp: number,
    loc: FlightLocation
}

export interface FlightData {
    id: FlightID
    trails: Trail[]
}

export interface Airport {
    code: string,
    name: string,
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