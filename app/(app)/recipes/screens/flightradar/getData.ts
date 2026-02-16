export interface Location {
    lat: number,
    long: number
}

export interface ForeignFlightData {
    callsign: string,
    loc: Location
}

export interface Trail {
    loc: Location,
    speed: number,
    height: number
}

export interface FlightData {
    callsign: string,
    loc: Location,
    speed: number,
    height: number,
    track: number,
    trail: Trail[]
}

export interface Airport {
    code: string,
    loc: Location
}

type TrackingKind =
    | { kind: 'static_location', location: Location }
    | { kind: 'static_airport', airport: Airport }
    | { kind: 'K3'; flight: FlightData };

export interface DisplayData {
    tracking: TrackingKind,
    center_loc: Location,
    nearby: ForeignFlightData[]
}