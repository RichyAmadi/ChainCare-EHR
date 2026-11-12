#!/bin/bash
cd /root/ehr/caliper
mkdir -p reports2; rm -f reports2/*
./sampler.sh reports2/stats.log reports2/STOP_SAMPLER &
for run in 1 2 3; do
  RUN_ID=b${run}x$(date +%s) npx caliper launch manager --caliper-workspace ./ --caliper-networkconfig networks/network.yaml --caliper-benchconfig benchmarks/main.yaml --caliper-flow-only-test --caliper-fabric-gateway-enabled --caliper-report-path reports2/main_run${run}.html > reports2/main_run${run}.log 2>&1
done
RUN_ID=sw$(date +%s) npx caliper launch manager --caliper-workspace ./ --caliper-networkconfig networks/network.yaml --caliper-benchconfig benchmarks/scalability.yaml --caliper-flow-only-test --caliper-fabric-gateway-enabled --caliper-report-path reports2/scalability.html > reports2/scalability.log 2>&1
touch reports2/STOP_SAMPLER
sleep 5
touch reports2/ALL_DONE
