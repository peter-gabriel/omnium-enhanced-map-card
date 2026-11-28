#!/bin/sh
# Prepares the map once (download, crop, extract, partition, customize) and then serves it.
# Everything is kept in /data, the app's persistent folder; changing an option rebuilds the map.
set -e
cd /data
URL=$(jq -r '.region_url' /data/options.json)
BBOX=$(jq -r '.bbox // empty' /data/options.json)
PROFILE=$(jq -r '.profile' /data/options.json)
KEY="$URL|$BBOX|$PROFILE"

if [ ! -f ready ] || [ "$(cat ready)" != "$KEY" ]; then
  echo "[osrm] preparing map: $KEY"
  rm -f region.* ready
  echo "[osrm] downloading $URL"
  curl -fL --retry 3 -o source.osm.pbf "$URL"
  if [ -n "$BBOX" ] && [ "$BBOX" != "null" ]; then
    echo "[osrm] cropping to $BBOX"
    osmium extract --bbox "$BBOX" --strategy smart -o region.osm.pbf --overwrite source.osm.pbf
    rm -f source.osm.pbf
  else
    mv source.osm.pbf region.osm.pbf
  fi
  ls -l region.osm.pbf
  echo "[osrm] extract"
  osrm-extract -p "/opt/$PROFILE.lua" region.osm.pbf
  echo "[osrm] partition"
  osrm-partition region.osrm
  echo "[osrm] customize"
  osrm-customize region.osrm
  rm -f region.osm.pbf
  echo "$KEY" > ready
  echo "[osrm] map ready"
fi

echo "[osrm] serving on port 5000"
exec osrm-routed --algorithm mld --port 5000 --max-matching-size 1000 region.osrm
