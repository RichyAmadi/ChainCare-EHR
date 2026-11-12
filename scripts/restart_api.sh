#!/bin/bash
for p in $(pgrep -f "node.*tsx.*server"); do kill $p 2>/dev/null; done
sleep 2
cd /root/ehr/backend
MONGO_URI=${MDB:-mongodb://localhost:27017/ehr} RATE_LIMIT_PER_MINUTE=${RL:-0} nohup npx tsx src/server.ts > /root/ehr/api.log 2>&1 &
LEDGER_MODE=centralised PORT=4100 MONGO_URI=${MDBC:-mongodb://localhost:27017/ehr_central} RATE_LIMIT_PER_MINUTE=${RL:-0} nohup npx tsx src/server.ts > /root/ehr/api_central.log 2>&1 &
sleep 7
cat /root/ehr/api.log /root/ehr/api_central.log
