export interface FlightIdentification {
    id: string,
    number: {default: string | null},
    callsign: string
}

export interface FlightStatusData {
    status: {
        text: "estimated" | "landed" | "scheduled" | string,
        type: "arrival" | string,
        color: "green" | "gray" | "yellow" | string | null, // default: red if null?
        diverted: string | null // Airport code
    },
    eventTime: {
        utc: number | null, // For est arrival
        local: number | null
    }
}

export interface FlightStatus {
    live: boolean,
    text: "Scheduled" | string,
    icon: "green" | "red" | "yellow" | string | null, // default: red if null? // nvm it can still be yellow when null
    // diversion show red
    estimated: null,
    ambiguous: boolean,
    generic: FlightStatusData
}

export interface AirCraftModel {
    code: string,
    text: string
}

export interface AirCraftIdentification {
    model: string,
    registration: string,
    serialNo: string | number | null | any,
    age: {availability: boolean},
}

export interface Airline {
    name: string,
    code: {
        iata: string,
        icao: string
    },
    short?: string
}

export interface Country {
    name: string,
    code: string,
    id: number
}

export interface Timezone {
    name: string,
    offset: number,
    abbr: string,
    abbrName: string,
    isDst: boolean
}

export interface Airport {
    name: string,
    code: {
        iata: string,
        icao: string
    },
    position: {
        latitude: number,
        longitude: number,
        country: Country,
        region: {city: string},
        timezone: Timezone
    }
}

export interface FR24PlaybackResult {
    result: {
        response: {
            timestamp: number,
            altitudeFiltered: boolean,
            data: {
                flight: {
                    identification?: FlightIdentification // turn out some plane show absolutely nothing
                    status?: FlightStatus,
                    aircraft?: {
                        model: AirCraftModel,
                        identification: AirCraftIdentification,
                        availability: {serialNo: boolean, age: boolean}
                    },
                    owner?: Airline,
                    airline?: Airline,
                    airport: {
                        origin: Airport,
                        destination: Airport,
                        real: Airport | null // diversion
                    }
                }
                aircraftImage: {}
            }
        }
    }
}

// Example of nothing
// {"result":{"request":{"callback":null,"device":null,"flightId":"3E607C84","format":"json","pk":null,"timestamp":1771257600,"token":null},"response":{"data":{"flight":{"availability":{"ems":false}}}}}}

