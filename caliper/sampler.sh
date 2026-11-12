#!/bin/bash
# Samples per-container CPU and memory every ~2 s until the stop file appears.
OUT=$1; STOP=$2
while [ ! -f "$STOP" ]; do
  docker stats --no-stream --format '{{json .}}' | while read -r l; do echo "$(date +%s.%N) $l"; done >> "$OUT"
  sleep 1
done
