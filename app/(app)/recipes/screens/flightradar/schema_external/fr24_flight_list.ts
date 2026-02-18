// Although this API contain a lot of data, most of it is covered by alternative api from flight playback,
// so only the specific helpful data is listed in schema.

export interface TimeData {
    departure: number | null,
    arrival: number | null
}

export interface OtherTimeData {
    eta: number | null,
    updated: number | null,
    duration: number | null
}

export interface FullTimeData {
    scheduled: TimeData,
    real: TimeData,
    estimated: TimeData,
    other: OtherTimeData
}

// data.result.response.data[0]?.time
