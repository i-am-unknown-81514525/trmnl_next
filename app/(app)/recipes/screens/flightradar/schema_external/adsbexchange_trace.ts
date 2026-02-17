type TimeOffset = number;
type Latitude = number | null;
type Longitude = number | null;
type BaroAlt = number;
type GroudSpeed = number | null;
type Track = number | null;
type StatusFlag = number;
type VerRate = number | null;
export interface AdsbIcaoNtV0 {
    type: "adsb_icao_nt",
    flight: string,
    alt_geom: number,
    track: number,
    geom_rate: number,
    squawk: string,
    nic: number,
    rc: number,
    version: 0,
    nac_p: number,
    nac_v: number,
    sil: number,
    sil_type: string,
    alert: number,
    spi: number
}
export interface AdsbIcaoNtV2 {
    type: "adsb_icao_nt",
    flight: string,
    alt_geom: number,
    ias?: number, // Most don't have this
    tas?: number, // Most don't have this
    mach?: number, // Most don't have this
    wd?: number, // Most don't have this
    ws?: number, // Most don't have this
    track: number,
    track_rate? : number, // most don't have this
    roll?: number, // most don't have this
    mag_heading?: number, // most don't have this
    true_heading? : number, // Most don't have this
    baro_rate?: number, // about half have this
    geom_rate: number,
    squawk: string,
    emergency: string,
    category: string,
    // Most don't have this
    nav_qnh?: number,
    nav_altitude_mcp?: number,
    nav_altitude_fms?: number, // this is even fewer
    nav_modes?: string[], // this is even fewer
    // Section end
    nic: number,
    rc: number,
    version: 2,
    nic_baro: number
    nac_p: number,
    nac_v: number,
    sil: number,
    sil_type: string,
    gva: number,
    sda: number
    alert: number,
    spi: number
}
type ExtData = AdsbIcaoNtV0 | AdsbIcaoNtV2 | null | object
type SignalSource = "adsb_icao" | string
type GeoMetricAlt = number | null
type GeoVerRate = number | null
type TAS = number | null
type Roll = number | null
type TraceRecord = [TimeOffset, Latitude, Longitude, BaroAlt, GroudSpeed, Track, StatusFlag, VerRate, ExtData, SignalSource, GeoMetricAlt, GeoVerRate, TAS, Roll];

export interface Trace {
    icao: string,
    r: string,
    t: string,
    dbFlags: number,
    desc: string,
    timestamp: number,
    trace: TraceRecord[]
}