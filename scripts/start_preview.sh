#!/bin/bash
# Start production-build preview servers for both systems (Fabric on 4173, centralised on 4174).
cd /root/ehr/frontend
PREVIEW_PORT=4173 API_TARGET=http://localhost:4000 nohup npx vite preview --host 127.0.0.1 > /root/ehr/preview_fabric.log 2>&1 &
PREVIEW_PORT=4174 API_TARGET=http://localhost:4100 nohup npx vite preview --host 127.0.0.1 > /root/ehr/preview_central.log 2>&1 &
sleep 5
curl -sI localhost:4173 | grep -i -E "content-security|x-frame|nosniff"
