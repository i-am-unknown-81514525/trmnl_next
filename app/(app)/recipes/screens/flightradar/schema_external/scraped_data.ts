export interface Runway {
  id: string;
  airport_ref: string;
  airport_ident: string;
  length_ft: number;
  width_ft: number;
  surface: string | null;
  lighted: boolean;
  closed: boolean;
  le_ident: string | null;
  le_lat: number;
  le_long: number;
  le_heading_degT: number | null;
  he_ident: string | null;
  he_lat: number;
  he_long: number;
  he_heading_degT: number | null;
}

export interface Navaid {
  id: string;
  ident: string;
  name: string;
  type: string | null;
  frequency_khz?: number | null;
  lat: number;
  lon: number;
  associated_airport?: string | null;
}

export interface AirportExtended {
  id: string;
  ident: string | null;
  iata: string | null;
  name: string | null;
  lat: number;
  lon: number;
  runways: Runway[];
}
