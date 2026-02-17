from pprint import pprint

import requests
import zstandard as zstd
import struct
import json
import re
import math

# Decode assist with: https://github.com/ADSBexchange/tar1090/blob/master/html/formatter.js#

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

    # Parse header to get stride (u32 at offset 8) and version (u32 at offset 40)
    if len(data) < 44:
        return

    stride = struct.unpack('<I', data[8:12])[0]
    version = struct.unpack('<I', data[40:44])[0]
    num_records = len(data) // stride
    
    aircraft_list = []
    
    for i in range(1, num_records):
        record = data[i*stride : (i+1)*stride]
        
        icao_int = struct.unpack('<I', record[0:4])[0]
        icao = f"{icao_int & 0xFFFFFF:06x}"
        
        if version >= 20240218:
            seen = struct.unpack('<i', record[4:8])[0] / 10.0
            if len(record) >= 112:
                seen_pos = struct.unpack('<i', record[108:112])[0] / 10.0
            else:
                seen_pos = None
        else:
            seen_pos = struct.unpack('<H', record[4:6])[0] / 10.0
            seen = struct.unpack('<H', record[6:8])[0] / 10.0

        lon_int = struct.unpack('<i', record[8:12])[0]
        lat_int = struct.unpack('<i', record[12:16])[0]
        
        lon = lon_int / 1e6
        lat = lat_int / 1e6
        
        # Telemetry (using signed shorts 'h' where JS uses s16)
        # Offsets based on JS:
        # 16: baro_rate, 18: geom_rate
        # 20: alt_baro, 22: alt_geom
        # 24: nav_altitude_mcp, 26: nav_altitude_fms
        # 28: nav_qnh
        # 30: nav_heading
        # 32: squawk (u16)
        # 34: gs, 36: mach, 38: roll
        # 40: track, 42: track_rate
        # 44: mag_heading, 46: true_heading
        # 48: wd, 50: ws, 52: oat, 54: tat
        # 56: tas, 58: ias, 60: rc, 62: messages
        
        baro_rate = struct.unpack('<h', record[16:18])[0] * 8
        geom_rate = struct.unpack('<h', record[18:20])[0] * 8
        
        alt_baro = struct.unpack('<h', record[20:22])[0] * 25
        alt_geom = struct.unpack('<h', record[22:24])[0] * 25
        
        nav_altitude_mcp = struct.unpack('<H', record[24:26])[0] * 4
        nav_altitude_fms = struct.unpack('<H', record[26:28])[0] * 4

        # val_28 is nav_qnh / 10
        baro_setting = struct.unpack('<h', record[28:30])[0] / 10.0
        nav_heading = struct.unpack('<h', record[30:32])[0] / 90.0
        
        # Squawk is at 32 (u16)
        squawk_int = struct.unpack('<H', record[32:34])[0]
        squawk = f"{squawk_int:04x}" if squawk_int != 0 else None
        
        gs = struct.unpack('<h', record[34:36])[0] / 10.0
        mach = struct.unpack('<h', record[36:38])[0] / 1000.0
        roll = struct.unpack('<h', record[38:40])[0] / 100.0
        track = struct.unpack('<h', record[40:42])[0] / 90.0
        track_rate = struct.unpack('<h', record[42:44])[0] / 100.0

        mag_heading = struct.unpack('<h', record[44:46])[0] / 90.0
        true_heading = struct.unpack('<h', record[46:48])[0] / 90.0

        wd = struct.unpack('<h', record[48:50])[0]
        ws = struct.unpack('<h', record[50:52])[0]
        oat = struct.unpack('<h', record[52:54])[0]
        tat = struct.unpack('<h', record[54:56])[0]

        tas = struct.unpack('<H', record[56:58])[0]
        ias = struct.unpack('<H', record[58:60])[0]
        rc = struct.unpack('<H', record[60:62])[0]
        messages = struct.unpack('<H', record[62:64])[0]

        category = f"{record[64]:02X}" if record[64] else None
        nic = record[65]
        nav_modes_raw = record[66]
        airground = record[68] & 0x0F
        
        # RSSI
        rssi_raw = record[105]
        if version >= 20250403:
            rssi = (rssi_raw * (50 / 255)) - 50
        else:
            rssi_level = (rssi_raw * rssi_raw) / 65025.0 + 1.125e-5
            rssi = 10 * math.log10(rssi_level)

        # Validity flags at offset 73
        validity1 = record[73]
        validity2 = record[74]
        validity3 = record[75]
        validity4 = record[76]
        validity5 = record[77]
        
        if not (validity1 & 64): # Lat/Lon valid bit
            lat = None
            lon = None
            seen_pos = None
            
        if not (validity1 & 16): # Baro Alt valid bit
            alt_baro = None
            
        if not (validity1 & 32): # Geom Alt valid bit
            alt_geom = None

        if not (validity1 & 128): gs = None

        if not (validity2 & 1): ias = None
        if not (validity2 & 2): tas = None
        if not (validity2 & 4): mach = None
        if not (validity2 & 8): track = None # calc_track if 0, but treating as invalid for reported track
        if not (validity2 & 16): track_rate = None
        if not (validity2 & 32): roll = None
        if not (validity2 & 64): mag_heading = None
        if not (validity2 & 128): true_heading = None

        if not (validity3 & 1): baro_rate = None
        if not (validity3 & 2): geom_rate = None
        
        if not (validity4 & 32): baro_setting = None
        if not (validity4 & 64): nav_altitude_mcp = None
        if not (validity4 & 128): nav_altitude_fms = None

        if not (validity5 & 2): nav_heading = None
        if not (validity5 & 16): 
            ws = None
            wd = None
        if not (validity5 & 32):
            oat = None
            tat = None

        nav_modes = []
        if nav_modes_raw & 1: nav_modes.append('autopilot')
        if nav_modes_raw & 2: nav_modes.append('vnav')
        if nav_modes_raw & 4: nav_modes.append('alt_hold')
        if nav_modes_raw & 8: nav_modes.append('approach')
        if nav_modes_raw & 16: nav_modes.append('lnav')
        if nav_modes_raw & 32: nav_modes.append('tcas')

        # Parse strings
        def parse_str(b):
            return b.split(b'\x00', 1)[0].decode('ascii', errors='ignore').strip()

        callsign = parse_str(record[78:86]) if (validity1 & 8) else None
        type_code = parse_str(record[88:92])
        registration = parse_str(record[92:104])
            
        aircraft = {
            "hex": icao,
            "lat": lat,
            "lon": lon,
            "alt_baro": alt_baro,
            "alt_geom": alt_geom,
            "baro_rate": baro_rate,
            "geom_rate": geom_rate,
            "gs": gs,
            "track": track,
            "track_rate": track_rate,
            "roll": roll,
            "mag_heading": mag_heading,
            "true_heading": true_heading,
            "baro_setting": baro_setting,
            "nav_qnh": baro_setting,
            "nav_altitude_mcp": nav_altitude_mcp,
            "nav_altitude_fms": nav_altitude_fms,
            "nav_heading": nav_heading,
            "nav_modes": nav_modes,
            "squawk": squawk,
            "flight": callsign,
            "t": type_code,
            "r": registration,
            "wd": wd,
            "ws": ws,
            "oat": oat,
            "tat": tat,
            "tas": tas,
            "ias": ias,
            "mach": mach,
            "rc": rc,
            "messages": messages,
            "category": category,
            "nic": nic,
            "rssi": rssi,
            "seen": seen,
            "seen_pos": seen_pos,
            "airground": airground,
            # "record": record
        }
        aircraft_list.append(aircraft)

    pprint(aircraft_list[:300])

if __name__ == "__main__":
    main()
