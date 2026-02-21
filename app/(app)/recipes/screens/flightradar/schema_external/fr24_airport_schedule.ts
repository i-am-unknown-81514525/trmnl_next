export interface FR24FlightDataPagingWrap {
  item: { current: number; total: number; limit: number };
  page: { current: number; total: number };
}

export interface FR24AirportData {
  departures?: FR24FlightDataPagingWrap;
  arrivals?: FR24FlightDataPagingWrap;
}

export interface FR24AirportResp {
  airport: { pluginData: FR24AirportData };
  airlines: FR24AirlinesData;
  aircraftImages: FR24AircraftImgData;
}

export interface FR24AirportResult {
  request: object;
  response: object;
}
