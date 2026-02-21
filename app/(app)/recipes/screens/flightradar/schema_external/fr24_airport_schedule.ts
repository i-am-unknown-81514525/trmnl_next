import type {
  FlightIdentification,
  FlightStatus,
  AirCraftModel,
  AirCraftIdentification,
  Airline,
  Airport,
  Thumbnail,
} from "./fr24_flightplayback";
import type { TimeData } from "./fr24_flight_list";

export interface FR24AirportListFlightResult {
  flight: {
    identification?: FlightIdentification; // turn out some plane show absolutely nothing
    status?: FlightStatus;
    aircraft?: {
      model: AirCraftModel;
      identification: AirCraftIdentification;
      availability: { serialNo: boolean; age: boolean };
    };
    owner?: Airline | null;
    airline?: Airline | null;
    airport?: {
      origin: Airport;
      destination: Airport;
      real: Airport | null; // diversion
    };
    time: TimeData;
  };
}

export interface FR24AirlinesData {
  codeshare: Record<string, Airline>;
}

export interface FR24FlightDataPagingWrap {
  item: { current: number; total: number; limit: number };
  page: { current: number; total: number };
  timestamp: number;
  data: FR24AirportListFlightResult[];
}

export interface FR24AirportData {
  departures?: FR24FlightDataPagingWrap;
  arrivals?: FR24FlightDataPagingWrap;
}

export interface FR24AirportDataDepartures {
  departures: FR24FlightDataPagingWrap;
}

export interface FR24AirportDataArrivals {
  arrivals: FR24FlightDataPagingWrap;
}

export interface FR24AircraftImgData {
  registration: string;
  images: {
    thumbnails: Thumbnail[];
    medium: Thumbnail[];
    large: Thumbnail[];
  };
}

export interface FR24AirportResp {
  airport: { pluginData: FR24AirportDataDepartures | FR24AirportDataArrivals };
  airlines: FR24AirlinesData;
  aircraftImages: FR24AircraftImgData[];
}

export interface FR24AirportResult {
  result: {
    request: {
      callback: null | any;
      code: string | any;
      device: null | any;
      fleet: null | any;
      format: "json" | any;
      limit: number;
      page: number;
      pk: null | any;
      plugin: ["schedule"] | string[];
      "plugin-setting": { mode: "arrivals" | "departures"; timestamp: number };
      satelliteImage: { scale: 1 | number };
      token: number | any;
    };
    response: FR24AirportResp;
  };
}
