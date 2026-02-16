export interface ForeignFlightData {
    callsign: string
    lat: number,
    long: number
}

export interface Trail {
    lat: number,
    long: number,
    speed: number,
    height: number
}

export interface FlightData {
    callsign: string,
    lat: number,
    long: number
    speed: number,
    height: number,
    trail: Trail[]
}

type TrackingKind =
    | { kind: 'K1' }
    | { kind: 'K2' }
    | { kind: 'K3'; dt: FlightData };

export interface DisplayData {
    tracking: TrackingKind,
    center_lat: number,
    center_long: number,
    nearby: ForeignFlightData[]
}