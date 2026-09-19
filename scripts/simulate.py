#!/usr/bin/env python3
"""Send a small synthetic route to an explicitly chosen test device (OsmAnd)."""
import argparse
import math
import time
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:5055")
parser.add_argument("--id", required=True, help="Unique ID of a TEST device already added in the UI")
parser.add_argument("--count", type=int, default=20)
parser.add_argument("--interval", type=float, default=2)
args = parser.parse_args()
if args.count < 1 or args.interval < 0:
    parser.error("count must be positive and interval must be nonnegative")
for index in range(args.count):
    angle = index * 0.12
    query = urllib.parse.urlencode({
        "id": args.id, "timestamp": int(time.time()),
        "lat": 56.8389 + math.sin(angle) * 0.006,
        "lon": 60.5975 + math.cos(angle) * 0.012,
        "speed": 12, "bearing": (index * 7) % 360, "accuracy": 5,
    })
    try:
        with urllib.request.urlopen(args.url.rstrip("/") + "/?" + query, timeout=10) as response:
            if response.status != 200:
                raise RuntimeError("Unexpected status " + str(response.status))
    except Exception as error:
        raise SystemExit("Send failed. Check the device ID, address and port. " + str(error))
    print("Sent test point", index + 1)
    if index + 1 < args.count:
        time.sleep(args.interval)
