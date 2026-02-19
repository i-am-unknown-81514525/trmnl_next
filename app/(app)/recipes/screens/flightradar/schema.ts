import type {FullTimeData} from "./schema_external/fr24_flight_list";
import type {Navaid, Runway, AirportExtended} from "./schema_external/scraped_data";
import type {TopoOrGeo} from "./map";

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

export enum DepartureKind {
    Scheduled = 0,
    Departed = 1,
    Diverted = 2,
    Arrived = 3
}

export interface FlightMetadata {
    src: Airport | null,
    dest: Airport | null,
    real: Airport | null,
    time_data: FullTimeData | null,
    status: DepartureKind | null,
}

export interface FlightData {
    id: FlightID
    trails: Trail[]
    metadata: FlightMetadata | null
    curr: Trail
}

export interface Airport {
    code: string,
    name: string,
    loc: Location
}

export type TrackingKind =
    | { kind: 'static_location', location: Location }
    | { kind: 'static_airport', airport: Airport }
    | { kind: 'flight'; flight: FlightData };

export interface ForeignFlightDataDisplayParameter {
    display_icon: boolean,
    display_label: boolean,
    require_zoom: number // zoom level must be >= require_zoom to display
}

export interface ForeignFlightDataDisplay {
    flight: ForeignFlightData,
    parameter: ForeignFlightDataDisplayParameter
}

export interface EnvironmentOverlays {
    runways: Runway[]
    navaids: Navaid[]
    airports: AirportExtended[]
};

export interface BoundingBox {
    min: Location,
    max: Location
}

export interface DisplayData {
    tracking: TrackingKind,
    center_loc: Location,
    nearby: ForeignFlightDataDisplay[]
    overlays: EnvironmentOverlays,
    bound: BoundingBox,
    visual_bearing: number,
    forward_ratio: number,
    land_geo: TopoOrGeo
}