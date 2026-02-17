export interface FlightIdentification {
    id: string,
    number: {default: string},
    callsign: string
}

export interface FlightStatusData {
    status: {
        text: "estimated" | "landed" | "scheduled" | string,
        type: "arrival" | string,
        color: "green" | "gray" | "yellow" | string | null,
        diverted: null
    }
}

export interface FlightStatus {
    live: boolean,
    text: "Scheduled" | string,
    icon: "green" | "red" | "yellow" | string | null,
    estimated: null,
    ambiguous: boolean,
    generic:
}

export interface FR24PlaybackResult {
    result: {
        response: {
            timestamp: number,
            altitudeFiltered: boolean,
            data: {
                flight: {
                    identification: FlightIdentification
                }
                aircraftImage: {}
            }
        }
    }
}