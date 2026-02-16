import requests
import zstandard as zstd
import base64

def main():
    url = "https://globe.adsbexchange.com/re-api/?binCraft&zstd&box=39.315459,41.781827,-74.029415,-73.290585"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "Referer": "https://globe.adsbexchange.com/"
    }

    response = requests.get(url, headers=headers)
    response.raise_for_status()

    dctx = zstd.ZstdDecompressor()
    print(response.content)
    decompressed_data = dctx.decompress(response.content)

    print(f"Total length: {len(decompressed_data)}")
    print(f"First 200 bytes: {decompressed_data[:200]}")

    try:
        print("As UTF-8 (first 200 chars):", decompressed_data[:200].decode('utf-8'))
    except Exception as e:
        print(f"Could not decode as UTF-8: {e}")

if __name__ == "__main__":
    main()
