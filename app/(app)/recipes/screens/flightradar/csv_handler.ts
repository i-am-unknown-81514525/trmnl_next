import fs from 'fs';
import { parse } from 'csv-parse/sync';
import Flatbush from 'flatbush';
import {AirportExtended, Runway, Navaid} from "./schema_external/scraped_data";
