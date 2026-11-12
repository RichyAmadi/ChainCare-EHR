# ChainCare EHR: source code, test scripts and raw results

This package contains everything behind Chapters 4 and 5: the prototype blockchain-based EHR system (T-MERN stack with Hyperledger Fabric), every test and benchmark script, and the raw output of every measurement reported in the chapters.

## What is in each folder

| Folder | Contents |
| --- | --- |
| `chaincode/` | TypeScript smart contract (`src/ehrContract.ts`), its 14 unit tests (`test/`), the CouchDB index (`META-INF/`) and the Dockerfile used to run it as a chaincode service. Version 1.1 (paginated patient query). |
| `backend/` | Express 5 + TypeScript REST API. `src/app.ts` routes and security middleware, including the admin-only staff directory, `src/ledger.ts` Fabric Gateway client and the centralised baseline, `src/crypto.ts` AES-256-GCM and SHA-256, `src/models.ts` MongoDB schemas, `src/seed.ts` demo accounts. `test/api.test.ts` has the 15 integration tests. `.env.example` lists every setting. |
| `frontend/` | React 18 + TypeScript web application (`src/main.tsx`, `src/api.ts`, `src/styles.css`). `vite.config.ts` includes the security headers of the static web server. |
| `caliper/` | Hyperledger Caliper set-up: network config, benchmark definitions (`benchmarks/`), the six workload modules (`workload/`), `run_all.sh` (3 runs + scalability sweep) and `sampler.sh` (CPU/memory sampler). `reports2/` holds the final Caliper reports and logs used in the chapters; `reports/` holds the earlier runs (see the note below). |
| `eval/` | Evaluation scripts: `apibench.mjs` (API load test, both systems), `security_eval.mjs` (tamper, access-control, attack and scenario tests), `usability_eval.py` (task timing on broadband and throttled 3G, axe-core accessibility audit), `ui_walkthrough.py` (functional test and screenshots), `terminal_shots.py`, and `process_results.py` (turns raw output into the tables and charts). |
| `results/` | Raw results used in the chapters (listed below). |
| `figures/` | Charts and diagrams used in the document, with their sources (`arch.py` for the architecture SVG, `seq.mmd` for the sequence diagram). |
| `screenshots/` | `full/`: original screenshots; `cropped_for_document/`: the versions placed in the Word file. |
| `scripts/` | `restart_api.sh` starts the Fabric API (port 4000) and the centralised baseline (port 4100); `start_preview.sh` serves the production web build for both (ports 4173 and 4174). |
| `thesis-document/` | The Word document and the Node.js scripts that build it from the result files (`build.js`, `ch4a.js`, `ch4b.js`, `ch4c.js`, `ch5.js`, `data.js`, `lib.js`). |

## Raw results (`results/`)

| File | Measurement | Used in |
| --- | --- | --- |
| `caliper_main.json` | Mean ± SD of the 3 Caliper runs, 6 workloads | Table 4.7, Figure 4.4 |
| `caliper_scalability.json` | Send-rate sweep, writes 25–300 TPS, reads 100–600 TPS | Figure 4.6 |
| `caliper_resources.json` | Per-container CPU and memory for each round (from `caliper/reports2/stats.log`) | Table 4.8 |
| `../caliper/reports2/*.log, *.html` | Raw Caliper logs and HTML reports for runs 1–3 and the sweep | Figure 4.5 |
| `api_fabric.json`, `api_central.json`, `api_comparison.json` | API load test, 4 endpoints × 10 and 50 users, both systems | Table 4.9, Figure 4.7 |
| `security_fabric.json`, `security_central.json` (+ `sec_*.log`) | Tamper detection, access-control confusion matrix, 13 attack tests, scenarios S1–S3 | Tables 4.10–4.12, 4.14 |
| `usability_fabric.json`, `usability_central.json` | Task times (3 runs, broadband and 3G) and axe-core results after fixes | Table 4.15 |
| `usability_fabric_before_a11y.json` | Accessibility audit before the label fixes | Table 4.13 |
| `npm_audit_before_*.json`, `npm_audit_after_*.json` | Dependency audits before and after fixes | Table 4.13 |
| `zap/` | OWASP ZAP baseline scans of the web app and API, before and after fixes (HTML and JSON) | Table 4.13 |
| `ratelimit.json` | 150 requests against a 100/min limit | Section 4.4.6(e) |
| `chaincode_tests*.txt`, `api_tests*.txt`, `coverage.json` | Unit and integration test output and coverage | Tables 4.19–4.20, Figures 4.15–4.16 |
| `host.json`, `versions.json` | Test machine, storage footprint and exact tool versions | Tables 4.1, 4.5, 4.17 |

## Test environment

All final results were measured on one virtual machine: 2 vCPUs (Intel Xeon, 2.10 GHz), 7.8 GiB RAM, Ubuntu 24.04.5, Docker 29.8.2, Node.js 22.22.0. Fabric network: 2 organisations, 1 peer each, 1 Raft orderer, 3 CAs, CouchDB 3.4.2, channel `ehrchannel`, block cut at 10 transactions or 2 s.

**Note on `caliper/reports/` (superseded).** The first three Caliper runs were made before the virtual machine restarted onto a different CPU (Xeon at 2.80 GHz). After the restart, the full Caliper suite, the API load test, the usability timings and the security suite were all rerun on the same machine so that every figure in the chapters comes from one host. The earlier reports are kept only for transparency. They show the same pattern (reads at 100 TPS, writes saturating well below the offered load, no failed transactions) at a lower write rate of 31–42 TPS.

## How to reproduce

The scripts assume the base folder `/root/ehr` with Fabric samples installed at `/root/ehr/fabric-samples`. To use another location, replace the path in one go:

```bash
grep -rl "/root/ehr" --include=*.{ts,js,mjs,py,sh,yaml} . | xargs sed -i "s#/root/ehr#$PWD#g"
```

1. **Prerequisites:** Docker 24+, Node.js 22, Git, cURL, jq, Python 3 with `playwright` and `matplotlib`.
2. **Fabric network** (see Section 4.2.1 of the document for the full commands):
   ```bash
   curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
   chmod +x install-fabric.sh && ./install-fabric.sh --fabric-version 2.5.10 --ca-version 1.5.13 docker samples binary
   cd fabric-samples/test-network && ./network.sh up createChannel -c ehrchannel -ca -s couchdb
   ```
3. **Chaincode:** `cd chaincode && npm install && npx tsc`, then
   `./network.sh deployCCAAS -c ehrchannel -ccn ehr -ccp <path>/chaincode -ccv 1.1 -ccs 1`,
   then create the CouchDB index on ports 5984 and 7984 (command in Section 4.2.1).
4. **MongoDB:** `docker run -d --name ehr-mongo -p 27017:27017 mongo:7`
5. **API and web app:** `cd backend && npm install && cp .env.example .env`, `cd frontend && npm install && npm run build`, then `scripts/restart_api.sh`, `npm run seed` in `backend/`, and `scripts/start_preview.sh`.
6. **Tests:** `npm test` in `chaincode/` and in `backend/`.
7. **Benchmarks:** `cd caliper && npm install && npx caliper bind --caliper-bind-sut fabric:fabric-gateway && ./run_all.sh`
8. **Evaluation:**
   ```bash
   node eval/apibench.mjs fabric http://localhost:4000 results/api_fabric.json
   node eval/apibench.mjs centralised http://localhost:4100 results/api_central.json
   node eval/security_eval.mjs fabric http://localhost:4000 ehr results/security_fabric.json
   node eval/security_eval.mjs centralised http://localhost:4100 ehr_central results/security_central.json
   python3 eval/usability_eval.py fabric http://localhost:4173 results/usability_fabric.json
   python3 eval/usability_eval.py centralised http://localhost:4174 results/usability_central.json
   python3 eval/process_results.py
   ```
   `apibench.mjs` and `security_eval.mjs` import packages from `backend/node_modules`; run them with `NODE_PATH`, or link `eval/node_modules` to `backend/node_modules`.
9. **Rebuild the document:** `cd thesis-document && npm install docx && node build.js`

## Security notes

- `backend/src/config.ts` contains **development defaults** for `JWT_SECRET` and `DATA_KEY_HEX` so the prototype starts without configuration. Always set your own values in `.env`; in production keep them in a key vault.
- The Fabric identities used by the API come from the test network's certificate authorities and are for testing only.
- Demo accounts (password `Passw0rd!2026`) are created by `npm run seed` and must not exist on a real deployment.
