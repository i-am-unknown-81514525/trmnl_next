from pprint import pprint

import requests
import zstandard as zstd
import struct
import json
import re

def main():
    url = "https://globe.adsbexchange.com/re-api/?binCraft&zstd&box=49.964414,51.877283,-3.682461,0.821933"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "Referer": "https://globe.adsbexchange.com/"
    }

    response = requests.get(url, headers=headers)
    response.raise_for_status()

    dctx = zstd.ZstdDecompressor()
    data = dctx.decompress(response.content)

    stride = 112
    num_records = len(data) // stride
    
    aircraft_list = []
    
    for i in range(1, num_records):
        record = data[i*stride : (i+1)*stride]
        
        icao_int = struct.unpack('<I', record[0:4])[0]
        icao = f"{icao_int & 0xFFFFFF:06x}"
        
        lon_int = struct.unpack('<i', record[8:12])[0]
        lat_int = struct.unpack('<i', record[12:16])[0]
        
        lon = lon_int / 1e6
        lat = lat_int / 1e6
        
        # Telemetry
        val_16 = struct.unpack('<h', record[16:18])[0]
        val_18 = struct.unpack('<h', record[18:20])[0]
        val_20 = struct.unpack('<H', record[20:22])[0]
        val_22 = struct.unpack('<H', record[22:24])[0]
        val_24 = struct.unpack('<H', record[24:26])[0]
        val_26 = struct.unpack('<H', record[26:28])[0]
        val_28 = struct.unpack('<H', record[28:30])[0]
        val_30 = struct.unpack('<H', record[30:32])[0]

        alt_baro = val_20 * 25 if val_20 < 0x8000 else None
        alt_geom = val_26 * 4 if val_26 != 0xffff else None
        
        baro_rate = val_16 * 8
        geom_rate = val_18 * 8

        # val_28 seems to be Baro Setting (e.g. 10136 -> 1013.6 hPa)
        baro_setting = val_28 / 10.0 if val_28 != 0 else None
        
        # val_30 seems to be Squawk (hex)
        squawk = f"{val_30:04x}" if val_30 != 0 else None

        # Parse strings
        string_data = record[72:]
        matches = list(re.finditer(rb'[A-Z0-9\-: ]{2,}', string_data))
        
        callsign = record[78:78+8].decode().strip()
        type_code = record[88:88+4].decode()
        registration = record[92:].split(b'\x00', 1)[0].decode()
        
        # strings = [m.group().decode('ascii').strip() for m in matches]
        # strings = [s for s in strings if s]
        #
        # if len(strings) >= 1:
        #     callsign = strings[0]
        # if len(strings) >= 2:
        #     s2 = strings[1]
        #     if len(s2) > 4 and len(strings) == 2:
        #         type_code = s2[:4]
        #         registration = s2[4:]
        #     else:
        #         type_code = strings[1]
        #         if len(strings) >= 3:
        #             registration = strings[2]
        #
        # if callsign.startswith(':'):
        #     callsign = callsign[1:]
            
        aircraft = {
            "hex": icao,
            "lat": lat,
            "lon": lon,
            "alt_baro": alt_baro,
            "alt_geom": alt_geom,
            "baro_rate": baro_rate,
            "geom_rate": geom_rate,
            # "gs": gs,
            # "track": track,
            "baro_setting": baro_setting,
            "squawk": squawk,
            "flight": callsign,
            "t": type_code,
            "r": registration,
            "record": record
        }
        aircraft_list.append(aircraft)

    pprint(aircraft_list[:300])

if __name__ == "__main__":
    main()
