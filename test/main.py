import requests
import zstandard as zstd
import struct
import json
import re

# ADSBExchange binCraft format decoder
# Format:
# - Zstandard compressed
# - Header (112 bytes): Timestamp, Count, Stride (112), Global
# - Records (112 bytes each):
#   - 0-4: ICAO Address (uint32, masked)
#   - 8-12: Longitude (int32 / 1e6)
#   - 12-16: Latitude (int32 / 1e6)
#   - 20-22: Speed (uint16, 0.1 knots?)
#   - 22-24: Track (uint16, 0.1 degrees?)
#   - 24-26: Altitude (uint16, feet?)
#   - 26-28: Vertical Rate? (int16?)
#   - 72+: Packed strings (Callsign, Type, Registration) separated by nulls/padding

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
    
    # Skip record 0 (Header)
    for i in range(1, num_records):
        record = data[i*stride : (i+1)*stride]
        
        # Decode fixed fields
        icao_int = struct.unpack('<I', record[0:4])[0]
        icao = f"{icao_int & 0xFFFFFF:06x}"
        
        lon_int = struct.unpack('<i', record[8:12])[0]
        lat_int = struct.unpack('<i', record[12:16])[0]
        
        lon = lon_int / 1e6
        lat = lat_int / 1e6
        
        # Telemetry
        speed_raw = struct.unpack('<H', record[20:22])[0]
        track_raw = struct.unpack('<H', record[22:24])[0]
        alt_raw = struct.unpack('<H', record[24:26])[0]
        
        # Handle invalid/no data values (often 0xffff or similar)
        gs = speed_raw / 10.0 if speed_raw < 65000 else None
        track = track_raw / 10.0 if track_raw < 65000 else None
        alt_baro = alt_raw if alt_raw < 65000 else None # Altitude in feet?
        
        # Parse strings from offset 72 onwards
        string_data = record[72:]
        
        # Extract printable strings
        matches = list(re.finditer(rb'[A-Z0-9\-: ]{2,}', string_data))
        
        callsign = ""
        type_code = ""
        registration = ""
        
        strings = [m.group().decode('ascii').strip() for m in matches]
        strings = [s for s in strings if s]
        
        if len(strings) >= 1:
            callsign = strings[0]
        if len(strings) >= 2:
            s2 = strings[1]
            if len(s2) > 4 and len(strings) == 2:
                type_code = s2[:4]
                registration = s2[4:]
            else:
                type_code = strings[1]
                if len(strings) >= 3:
                    registration = strings[2]
                
        if callsign.startswith(':'):
            callsign = callsign[1:]
            
        aircraft = {
            "hex": icao,
            "lat": lat,
            "lon": lon,
            "alt_baro": alt_baro,
            "gs": gs,
            "track": track,
            "flight": callsign,
            "t": type_code,
            "r": registration
        }
        aircraft_list.append(aircraft)
        
    print(json.dumps(aircraft_list, indent=2))

if __name__ == "__main__":
    main()
