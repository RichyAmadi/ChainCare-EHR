// Chapter 4, section 4.4: performance evaluation.
const { P, H2, H3, H4, bullet, numbered, table, figure, code } = require('./lib');
const { R, f1, f2, int, ms, s2, pm, W, api, ratio } = require('./data');
const t = (v) => (v < 1000 ? `${Math.round(v)} ms` : `${s2(v)} s`);

module.exports = function ch4b() {
  const out = [];
  const push = (...xs) => xs.forEach(x => Array.isArray(x) ? out.push(...x) : out.push(x));
  const writes = R.main.filter(m => !/Read|Query/.test(m.workload));
  const wMin = Math.min(...writes.map(m => m.tps[0])), wMax = Math.max(...writes.map(m => m.tps[0]));
  const totalTx = R.main.reduce((a, m) => a + m.succ + m.fail, 0), totalFail = R.main.reduce((a, m) => a + m.fail, 0);
  const sweepW = R.sweep.writes, sweepR = R.sweep.reads;
  const peakW = Math.max(...sweepW.map(x => x.tps)), peakR = Math.max(...sweepR.map(x => x.tps));
  const readSat = sweepR.find(x => x.tps < 0.95 * x.target);
  const F = R.secF, C = R.secC;

  push(H2('4.4 Performance Evaluation'));
  push(P('The prototype was evaluated on four questions: how fast the blockchain layer is and how it behaves under load (Sections 4.4.2 to 4.4.4); how it compares with the existing system in speed (Section 4.4.5); how well it protects records (Section 4.4.6); and whether it works in realistic Nigerian care scenarios and is usable (Sections 4.4.7 and 4.4.8). Section 4.4.9 brings the comparison together.'));
  push(P('**The existing system used for comparison.** Section 3.1 described the existing EHR architecture (Omirinlewo & Akinkuade, 2025): a centralised, cloud-hosted client-server system in which one database holds the records, the access rules and the logs, protected by firewalls and application checks. That system was not available for testing, so a baseline with the same architecture was built from the prototype\'s own code. Started with `LEDGER_MODE=centralised`, the API keeps hashes, consent and audit events in the same MongoDB database as the records and enforces the same access rules in application code. Everything else (user interface, API, encryption, validation and hardware) is identical. Any difference between the two therefore comes from where trust lives, not from implementation quality.'));

  /* 4.4.1 */
  push(H3('4.4.1 Evaluation Environment and Method'));
  push(P(`All tests ran on one virtual machine (Table 4.5), with every component in Docker on the same host. This is a deliberately modest machine, close to the server a state hospital or PHC cluster in Nigeria might realistically provision, so the figures are a lower bound rather than a best case.`));
  push(table('Evaluation environment', ['Item', 'Configuration'], [
    ['Processor', `${R.host.cpu}, ${R.host.vcpus} virtual CPUs`],
    ['Memory', `${R.host.memGiB} GiB RAM`],
    ['Operating system', `${R.host.os}, Docker Engine ${R.host.docker}`],
    ['Fabric network', '2 organisations (Hospital A, Facility B), 1 peer each, 1 Raft orderer, 3 Fabric CAs, 2 CouchDB 3.4.2 state databases'],
    ['Channel and policy', '`ehrchannel`; endorsement by both organisations; block cut at 10 transactions or 2 s (BatchTimeout)'],
    ['Off-chain database', 'MongoDB 7.0, single instance'],
    ['Benchmark tools', `Hyperledger Caliper ${R.versions.caliper} (2 workers, fixed-rate load), autocannon ${R.versions.autocannon}, Playwright, OWASP ZAP 2.17.0`],
    ['Repetitions', 'Blockchain workloads: 3 independent runs of 1,000 transactions each; mean ± standard deviation reported'],
  ], [1.6, 5.4], { size: 19 }));
  push(P('Six chaincode workloads were defined to cover every kind of ledger operation (Table 4.6). Each was offered at a fixed send rate of 100 transactions per second (TPS). The metrics follow the Hyperledger Performance and Scale Working Group definitions: **throughput** is committed transactions per second; **latency** is the time from submission until the transaction is committed and visible on the network; **success rate** is the share of transactions that commit without error. CPU and memory of each container were sampled every two seconds with `docker stats`.'));
  push(table('Blockchain benchmark workloads', ['Code', 'Workload', 'Chaincode function', 'Type'], [
    ['W1', 'Create record', 'CreateRecord', 'Write (endorse, order, commit)'],
    ['W2', 'Read record', 'GetRecordAnchor', 'Read (evaluate on one peer)'],
    ['W3', 'Grant consent', 'GrantAccess', 'Write'],
    ['W4', 'Revoke consent', 'RevokeAccess', 'Write'],
    ['W5', 'Audited access', 'AccessRecord (consent check + audit event)', 'Write'],
    ['W6', 'Query patient records', 'QueryRecordsByPatient (CouchDB, paginated)', 'Read (rich query)'],
  ], [0.6, 1.7, 3.0, 2.2], { size: 19 }));

  /* 4.4.2 */
  push(H3('4.4.2 Blockchain Layer Performance'));
  push(P(`Table 4.7 and Figure 4.4 give the results. Across ${int(totalTx)} benchmark transactions, ${totalFail === 0 ? 'none failed: the success rate was 100% for every workload' : `${totalFail} failed`}. Reads were fast and stable: W2 kept pace with the full 100 TPS offered load at an average latency of ${f2(W('W2').avgLat[0])} s. Writes were slower but just as reliable. The four write workloads committed between ${f1(wMin)} and ${f1(wMax)} TPS. Each write is executed and signed by both organisations, ordered into a block, and then validated and written to CouchDB on every peer one block at a time; this pipeline, not any error, sets the write rate (Section 4.4.4).`));
  push(table('Hyperledger Caliper results at an offered load of 100 TPS (mean ± SD, 3 runs)', ['Workload', 'Send rate (TPS)', 'Throughput (TPS)', 'Avg latency (s)', 'Max latency (s)', 'Success'], R.main.map(m => [
    m.workload, pm(m.send), pm(m.tps), pm(m.avgLat, 2), pm(m.maxLat, 2), `${m.successPct}%`]),
  [2.1, 1.25, 1.35, 1.25, 1.25, 0.8], { size: 18, alignRight: [1, 2, 3, 4, 5] }));
  push(figure('/root/ehr/figures/caliper_main.png', 'Throughput and average latency of each chaincode workload (error bars: ±1 SD)'));
  push(P(`Two design choices explain the latency figures. First, the ordering service cuts a block when it has 10 transactions or after 2 seconds, whichever comes first. Under light load a single write therefore waits about 2 seconds for its block; this is why one clinician saving one record sees roughly 2.1 s in the scenario tests (Section 4.4.7). Second, W6 runs a CouchDB query that returns up to 50 records per call; at 100 TPS it saturated CouchDB, so queries queued and average latency rose to ${f2(W('W6').avgLat[0])} s. Both can be tuned: a shorter batch timeout lowers single-write latency, and in practice the record list is requested once per consultation, not 100 times a second.`));
  push(figure('/root/ehr/screenshots/cropped_for_document/caliper_report.png', 'Hyperledger Caliper HTML report for one benchmark run (screenshot)', 6.0));

  /* 4.4.3 */
  push(H3('4.4.3 Scalability'));
  push(P(`To find where the system saturates, the send rate was raised step by step for 20 seconds per step: from 25 to 300 TPS for writes (W1) and from 100 to 600 TPS for reads (W2). Figure 4.6 shows the outcome. Reads tracked the offered load up to ${readSat ? readSat.target - 100 : 600} TPS and levelled off at about ${int(peakR)} TPS, with average latency never above ${f2(Math.max(...sweepR.map(x => x.avgLat)))} s. Writes levelled off much earlier, at about ${int(peakW)} TPS; beyond that point extra load only lengthened the queue, and average latency reached as much as ${f1(Math.max(...sweepW.map(x => x.avgLat)))} s. No transaction failed at any step.`));
  push(figure('/root/ehr/figures/caliper_scalability.png', 'Throughput and latency as the offered load increases'));
  push(P(`To put the write ceiling in context: ${int(peakW)} committed writes per second is roughly ${(peakW * 3600 * 8 / 1e6).toFixed(1)} million record or consent events in an eight-hour clinic day. A busy Nigerian teaching hospital records far fewer events than that, so the capacity of even this two-core test host is well above what one facility needs. A state-wide network would add peers and organisations, and Fabric spreads endorsement across them.`));

  /* 4.4.4 */
  push(H3('4.4.4 Resource Utilisation'));
  const res = R.resources;
  const rw = res['W1 Create record'] || {}, rr = res['W2 Read record'] || {};
  const cname = { 'peer0.org1.example.com': 'Peer, Hospital A', 'peer0.org2.example.com': 'Peer, Facility B', 'orderer.example.com': 'Raft orderer',
    couchdb0: 'CouchDB, Hospital A', couchdb1: 'CouchDB, Facility B', peer0org1_ehr_ccaas: 'Chaincode, Hospital A', peer0org2_ehr_ccaas: 'Chaincode, Facility B' };
  const rows = Object.keys(cname).filter(c => rw[c]).map(c => [cname[c], f1(rw[c].cpuAvg), f1(rw[c].cpuMax), rr[c] ? f1(rr[c].cpuAvg) : '–', f1(Math.max(rw[c].memMaxMiB, rr[c]?.memMaxMiB ?? 0))]);
  const memTotal = Object.keys(cname).reduce((a, c) => a + Math.max(rw[c]?.memMaxMiB ?? 0, rr[c]?.memMaxMiB ?? 0), 0);
  const top = Object.keys(cname).filter(c => rw[c]).sort((a, b) => rw[b].cpuAvg - rw[a].cpuAvg)[0];
  const cpuSum = Object.keys(cname).reduce((a, c) => a + (rw[c]?.cpuAvg ?? 0), 0);
  push(P(`Table 4.8 shows CPU and memory use of each blockchain container during the write workload (W1) and the read workload (W2), over the three runs. CPU is given as a percentage of one core, so on this machine the total available is 200%. During writes the busiest component was ${cname[top].replace(/^(.*), (.*)$/, 'the $1 of $2')} (average ${f1(rw[top].cpuAvg)}%), and the seven blockchain containers together averaged ${f1(cpuSum)}%, with the rest of the processor used by the Caliper load generator and the operating system. No container ran near its limit, so the write ceiling comes from the sequential validate-and-commit step on each peer, in which CouchDB does most of the work, rather than from a lack of processor or memory. Memory use was modest: the whole blockchain layer peaked at about ${int(memTotal)} MiB, so it fits comfortably on an 8 GB server alongside MongoDB and the API.`));
  push(table('CPU and memory use of the blockchain containers (3 runs)', ['Container', 'W1 avg CPU (%)', 'W1 peak CPU (%)', 'W2 avg CPU (%)', 'Peak memory (MiB)'], rows,
    [2.4, 1.2, 1.2, 1.2, 1.3], { size: 19, alignRight: [1, 2, 3, 4] }));
  push(P(`Storage was also measured at the end of testing. After more than ${int(Math.floor(Number(R.host.couchSize.split(' ')[0]) / 1000) * 1000)} world-state entries the ledger on each peer occupied ${R.host.ledgerSize.replace('M', ' MB').replace('G', ' GB')} and the CouchDB state database ${R.host.couchSize.split(' ')[1]} MB, while MongoDB held all the encrypted clinical payloads in ${R.host.mongoSizeMiB} MiB.`));

  /* 4.4.5 */
  push(H3('4.4.5 Comparison with the Existing System: Application Performance'));
  push(P('The user experiences the system through the API, so both systems were load-tested at the API with 10 and then 50 concurrent users for 15 seconds per endpoint. Four endpoints were tested: creating a record, opening a record (consent check, audit, integrity check and decryption), checking a record\'s integrity, and listing a patient\'s records. Table 4.9 and Figure 4.7 give the results.'));
  const eps = [['POST /api/records', 'Create record'], ['GET /api/records/:id (', 'Open record (audited)'], ['GET /api/records/:id/verify', 'Verify integrity'], ['GET /api/patients', 'List records']];
  const arow = [];
  for (const [ep, name] of eps) for (const c of [10, 50]) {
    const a = api('fabric', ep, c), b = api('centralised', ep, c);
    arow.push([`${name}, ${c} users`, f1(a.rps), int(a.latAvgMs), int(a.latP90Ms), f1(b.rps), int(b.latAvgMs), int(b.latP90Ms), `${a.errorRatePct}% / ${b.errorRatePct}%`]);
  }
  push(table('API load test: proposed system (Fabric) against the existing-architecture baseline (centralised)', ['Endpoint and load', 'Fabric req/s', 'Fabric avg (ms)', 'Fabric p90 (ms)', 'Central req/s', 'Central avg (ms)', 'Central p90 (ms)', 'Errors F / C'], arow,
    [2.1, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.95], { size: 17, alignRight: [1, 2, 3, 4, 5, 6] }));
  push(figure('/root/ehr/figures/api_comparison.png', 'Throughput and response time of the two systems at 10 concurrent users'));
  const cA = api('fabric', 'POST', 10), cB = api('centralised', 'POST', 10), oA = api('fabric', 'GET /api/records/:id (', 10), oB = api('centralised', 'GET /api/records/:id (', 10);
  push(P(`The centralised baseline is faster, as expected. At 10 users it created records ${ratio(cB.rps, cA.rps)} times faster (${f1(cB.rps)} against ${f1(cA.rps)} requests per second) and opened them ${ratio(oB.rps, oA.rps)} times faster. Its average response time for opening a record was ${ms(oB.latAvgMs)} against ${ms(oA.latAvgMs)} for the proposed system. This is the measured cost of putting consent and audit on a shared ledger: every write and every audited read waits for endorsement by two organisations, ordering and commit, whereas the baseline writes one row to its own database. Neither system returned errors.`));
  push(P(`The cost is acceptable for clinical work. At 10 concurrent users every operation of the proposed system averaged ${ms(Math.max(...R.api.filter(r => r.system === 'fabric' && r.connections === 10).map(r => r.latAvgMs)))} or less, and even at 50 users the slowest, listing records, averaged ${s2(api('fabric', 'GET /api/patients', 50).latAvgMs)} s. A clinician opens a handful of records per consultation, not hundreds per second. The next section shows what the extra time buys.`));

  /* 4.4.6 */
  push(H3('4.4.6 Security Evaluation'));
  push(P('Security was tested in five ways: tampering with stored records, an access-control accuracy test, a set of attack attempts against the API, automated vulnerability scanning, and a rate-limit test. Each test ran against both systems where it applied.'));
  push(H4('a) Integrity: tampering with off-chain records'));
  push(P(`One hundred records were created in each system and then altered directly in MongoDB, simulating an attacker or insider with database access. In 50 records only the encrypted payload was changed. In the other 50 the insider also recomputed and overwrote every copy of the hash the database holds, which someone with full database rights can do. Each record was then opened through the API. Table 4.10 shows the result.`));
  push(table('Detection of tampered records', ['Attack', 'Records altered', 'Detected: proposed (Fabric)', 'Detected: centralised baseline'], [
    ['Payload changed only', '50', `${F.integrity.payloadOnly.detected} (${F.integrity.payloadOnly.detected * 2}%)`, `${C.integrity.payloadOnly.detected} (${C.integrity.payloadOnly.detected * 2}%)`],
    ['Payload changed and stored hash rewritten by insider', '50', `${F.integrity.insiderWithHashRewrite.detected} (${F.integrity.insiderWithHashRewrite.detected * 2}%)`, `${C.integrity.insiderWithHashRewrite.detected} (${C.integrity.insiderWithHashRewrite.detected * 2}%)`],
    ['**Overall detection rate**', '100', `**${F.integrity.detectionRatePct}%**`, `**${C.integrity.detectionRatePct}%**`],
    ['Insider deletes the patient\'s audit log', '1 patient', `Not possible: ${F.integrity.auditLogDeletion.eventsStillVisible} events remained on the ledger`, `${C.integrity.auditLogDeletion.deletedEvents} events deleted without trace; ${C.integrity.auditLogDeletion.eventsStillVisible} remained`],
  ], [2.6, 1.0, 2.1, 2.1], { size: 19 }));
  push(P(`This is the central result of the study. Both systems caught simple tampering, because both compare a record with its hash. But when the insider also rewrote the hash, the centralised system accepted every forged record as genuine, since the hash it trusts lives in the same database the insider controls. The proposed system caught all ${F.integrity.injected}, because the reference hash sits on a ledger that is replicated on both facilities' peers and can only change through a transaction both of them endorse. The same holds for audit logs: in the baseline an insider erased a patient's entire access history with one database command, while the ledger offers no way to delete an entry. Figures 4.8 and 4.9 show what auditors and clinicians see when a tampered record is found.`));
  push(figure('/root/ehr/screenshots/cropped_for_document/11_auditor_detects_tampering.png', 'Auditor dashboard reporting a tampered record and the immutable audit trail', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/12_tampered_record_blocked.png', 'A clinician is blocked from opening the tampered record', 6.0));

  push(H4('b) Access-control accuracy'));
  push(P(`A patient was given records of four types, and seven kinds of user then made ${F.accessControl.requests} randomly ordered attempts to open them: the patient, a clinician with full consent, a clinician whose consent covered lab results only, one with expired consent, one whose consent had been revoked, an auditor without consent and another patient. The expected outcome of each attempt was worked out in advance and compared with what the system did. Table 4.11 gives the confusion matrix.`));
  push(table('Access-control decisions (positive = access allowed)', ['Measure', 'Proposed (Fabric)', 'Centralised baseline'], [
    ['Requests', int(F.accessControl.requests), int(C.accessControl.requests)],
    ['True positives (authorised, allowed)', F.accessControl.TP, C.accessControl.TP],
    ['True negatives (unauthorised, denied)', F.accessControl.TN, C.accessControl.TN],
    ['False positives (unauthorised, allowed)', F.accessControl.FP, C.accessControl.FP],
    ['False negatives (authorised, denied)', F.accessControl.FN, C.accessControl.FN],
    ['**Accuracy**', `**${F.accessControl.accuracyPct}%**`, `**${C.accessControl.accuracyPct}%**`],
    ['False acceptance rate', `${F.accessControl.falseAcceptanceRatePct}%`, `${C.accessControl.falseAcceptanceRatePct}%`],
  ], [3.4, 2, 2], { size: 19, alignRight: [1, 2] }));
  push(P('Both systems made every decision correctly, with no false acceptances. This is expected, as they apply the same rules; the difference is where the rules run. In the proposed system the rules are in chaincode executed by both facilities\' peers, so changing them requires a new chaincode version approved by both organisations. In the baseline they are ordinary application code that one administrator could change.'));

  push(H4('c) Attacks against the API'));
  push(P(`Thirteen common attacks were attempted on the proposed system (Table 4.12). All ${F.attacks.filter(a => a.blocked).length} were blocked with the correct status code.`));
  push(table('API attack tests', ['Attack attempted', 'Response', 'Result'], F.attacks.map(a => [a.test, String(a.status), a.blocked ? 'Blocked' : '**Not blocked**']),
    [4.6, 1.0, 1.0], { size: 19 }));

  push(H4('d) Vulnerability scanning'));
  const sumV = (m) => m.critical + m.high + m.moderate + m.low;
  const zf0 = R.zap.zap_frontend_before.filter(a => a.risk !== 'Informational'), zf1 = R.zap.zap_frontend.filter(a => a.risk !== 'Informational');
  const za0 = R.zap.zap_api_before.filter(a => a.risk !== 'Informational'), za1 = R.zap.zap_api.filter(a => a.risk !== 'Informational');
  const a11y0 = Object.values(R.useBefore.accessibility).flat().reduce((a, v) => a + v.nodes, 0);
  const a11y1 = Object.values(R.useF.accessibility).flat().reduce((a, v) => a + v.nodes, 0);
  push(P('Three automated scanners were run, the problems they found were fixed, and the scans were repeated. Table 4.13 records the findings before and after.'));
  push(table('Vulnerability and accessibility findings before and after fixes', ['Scanner and target', 'Findings before', 'Fix applied', 'Findings after'], [
    ['npm audit: API dependencies', `${sumV(R.auditBefore[0][1])} moderate (uuid, via the load-testing tool)`, 'Pinned uuid to the patched 11.1.1 release', `${sumV(R.auditAfter[0][1])}`],
    ['npm audit: web application', `${sumV(R.auditBefore[1][1])} (1 high: Vite path traversal; 1 moderate: esbuild)`, 'Upgraded Vite 5 to 6.4.3', `${sumV(R.auditAfter[1][1])}`],
    ['npm audit: chaincode', `${sumV(R.auditBefore[2][1])}`, 'None needed', `${sumV(R.auditAfter[2][1])}`],
    ['OWASP ZAP: web application', `${zf0.length} warnings: ${zf0.map(a => a.name.replace(' Header', '')).join('; ')}`, 'Added content security policy, X-Frame-Options and nosniff headers to the web server', `${zf1.length} (one informational notice only)`],
    ['OWASP ZAP: API', `${za0.length}: ${za0.map(a => a.name).join('; ')}`, 'Strict deny-all CSP for the JSON API; JSON 404 handler keeps headers on unknown routes', `${za1.length} (61 checks passed)`],
    ['axe-core: WCAG 2.1 AA', `${a11y0} critical issues (form fields without accessible names)`, 'Linked every form field to an accessible label', `${a11y1}`],
  ], [1.8, 2.1, 2.4, 1.2], { size: 18 }));
  push(H4('e) Rate limiting'));
  push(P(`With the limit set to ${R.rate.limitPerMinute} requests per minute, ${R.rate.requests} rapid requests from one client produced ${R.rate.statusCounts['200']} normal responses and ${R.rate.statusCounts['429']} "429 Too Many Requests" refusals, so the limiter blocks simple flooding and password-guessing attempts as intended.`));

  /* 4.4.7 */
  push(H3('4.4.7 Simulated Nigerian Healthcare Scenarios'));
  push(P('Five scenarios drawn from everyday practice in the Nigerian system were run end to end through the API, ten times each for S1 to S3. Table 4.14 summarises them for both systems.'));
  const S = F.scenarios, SC = C.scenarios;
  const u3 = R.useF.tasks[Object.keys(R.useF.tasks)[1]], u3c = R.useC.tasks[Object.keys(R.useC.tasks)[1]];
  push(table('Results of the simulated scenarios', ['Scenario', 'What was simulated', 'Proposed (Fabric)', 'Centralised baseline'], [
    ['S1 Referral from PHC to teaching hospital', 'Hospital A doctor tries to open a referred patient\'s record, is refused, the patient grants consent, the doctor opens it', `Refused, then allowed in all 10 runs; whole flow ${s2(S.S1_referral.endToEndMs)} s (3 ledger transactions)`, `Same outcome; ${t(SC.S1_referral.endToEndMs)}`],
    ['S2 Emergency (break-glass) access', 'A&E doctor without consent opens an unconscious patient\'s allergy record with a written reason', `Opened in all 10 runs in ${s2(S.S2_emergency.meanMs)} s; flagged EMERGENCY on the ledger`, `Opened in ${t(SC.S2_emergency.meanMs)}; flag stored in an editable table`],
    ['S3 Consent revocation', 'Patient withdraws a hospital\'s access after treatment', `Revoked in ${s2(S.S3_revocation.revokeMs)} s; refused on the very next attempt in ${S.S3_revocation.deniedOnFirstAttempt}/10 runs`, `Revoked in ${t(SC.S3_revocation.revokeMs)}; refused in ${SC.S3_revocation.deniedOnFirstAttempt}/10`],
    ['S4 Insider tampering', 'Staff member edits a lab result directly in the database (Table 4.10)', `${F.integrity.detectionRatePct}% detected`, `${C.integrity.detectionRatePct}% detected`],
    ['S5 Low-bandwidth clinic', 'All user tasks over a throttled 3G link (1.6 Mbps, 300 ms delay)', `Slowest task ${s2(Math.max(...Object.values(u3).map(t => t.meanMs)))} s; all completed`, `Slowest task ${s2(Math.max(...Object.values(u3c).map(t => t.meanMs)))} s; all completed`],
  ], [1.7, 2.3, 2.0, 1.8], { size: 18 }));
  push(P(`The scenarios show that the system behaves correctly where it matters clinically. A referred patient's records reach the receiving doctor only after the patient agrees, and the whole referral flow took about ${Math.round(S.S1_referral.endToEndMs / 1000)} seconds, most of it the 2-second block interval on each of its three transactions. Emergency access never stands in the way of care, yet it always leaves a permanent, reasoned record that the patient and auditors can review. Revocation takes effect at once. The baseline produced the same outcomes faster, but its emergency flags and audit entries could be quietly edited afterwards. Figures 4.10 to 4.14 show the referral and emergency scenarios in the user interface.`));
  push(figure('/root/ehr/screenshots/cropped_for_document/04_referral_access_denied_no_consent.png', 'S1: the referral doctor at Hospital A is refused because no consent exists on the ledger', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/06_patient_grants_consent.png', 'S1: the patient grants the referral doctor access from her own dashboard', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/07_referral_access_allowed.png', 'S1: with consent recorded, the referral doctor opens the record and its integrity is verified', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/10_emergency_break_glass.png', 'S2: emergency (break-glass) access by an A&E doctor, flagged for review', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/09_patient_access_log.png', 'The patient\'s access log, showing refused, allowed and emergency accesses from the ledger', 6.0));

  /* 4.4.8 */
  push(H3('4.4.8 Usability Evaluation'));
  const profs = Object.keys(R.useF.tasks);
  const tasks = Object.keys(R.useF.tasks[profs[0]]);
  push(P('Usability was assessed in two ways that can be repeated without bias: timing the five most common tasks, and auditing the interface against the Web Content Accessibility Guidelines (WCAG) 2.1 at level AA. Each task was scripted with Playwright and run three times on both systems, first on a normal connection and then over a throttled 3G profile typical of mobile internet in many parts of Nigeria (1.6 Mbps down, 0.75 Mbps up, 300 ms round trip). Table 4.15 gives the mean time to complete each task.'));
  push(table('Mean task completion time in seconds (3 runs each)', ['Task', 'Fabric, broadband', 'Fabric, 3G', 'Central, broadband', 'Central, 3G'], tasks.map(t => [t.replace(/^T\d /, ''),
    s2(R.useF.tasks[profs[0]][t].meanMs), s2(R.useF.tasks[profs[1]][t].meanMs), s2(R.useC.tasks[profs[0]][t].meanMs), s2(R.useC.tasks[profs[1]][t].meanMs)]),
  [2.8, 1.1, 1.1, 1.1, 1.1], { size: 19, alignRight: [1, 2, 3, 4] }));
  push(P(`On a normal connection, tasks that write to the ledger (opening a record, adding one, granting consent) took about 2.5 seconds in the proposed system against well under half a second in the baseline; again, the difference is mostly the block interval. Over 3G the gap narrowed, because network delay then dominates both systems, and every task in the proposed system finished within ${s2(Math.max(...Object.values(R.useF.tasks[profs[1]]).map(t => t.meanMs)))} seconds. Sign-in and the access log, which need no new ledger transaction, were as fast as the baseline.`));
  push(P(`The first accessibility audit found ${a11y0} critical problems on the sign-in, clinician and patient screens: several form fields had visible labels that screen readers could not link to the field. After every field was given an accessible name, a second audit found ${a11y1 === 0 ? 'no violations' : a11y1 + ' violations'} on any of the three screens. A System Usability Scale (SUS) survey of real patients and health workers was planned under Objective 4 but could not be carried out within the time of this study; it is recommended in Section 5.3 as the next step before any pilot.`));

  /* 4.4.9 */
  push(H3('4.4.9 Summary: Proposed System Compared with the Existing System'));
  push(P('Table 4.16 brings the results together. The existing system column describes the centralised architecture of Section 3.1; where a figure is given, it was measured on the baseline that reproduces that architecture.'));
  const lat = (sys) => ms(api(sys, 'GET /api/records/:id (', 10).latAvgMs);
  push(table('Proposed system compared with the existing centralised system', ['Criterion', 'Existing (centralised)', 'Proposed (T-MERN + Fabric)'], [
    ['Where trust lives', 'One database and its administrators', 'Ledger replicated across facilities; changes need both to endorse'],
    ['Single point of failure', 'Yes: central server and database', 'No for the ledger: each facility holds a full copy'],
    ['Tamper detection (Table 4.10)', `${C.integrity.detectionRatePct}%`, `${F.integrity.detectionRatePct}%`],
    ['Audit trail', `Editable; insider deleted ${C.integrity.auditLogDeletion.deletedEvents} events unnoticed`, 'Append-only; cannot be deleted'],
    ['Patient consent', 'Rows in the application database', 'Chaincode rules executed by both facilities; scope and expiry supported'],
    ['Access-control accuracy', `${C.accessControl.accuracyPct}%`, `${F.accessControl.accuracyPct}%`],
    ['Interoperability between facilities', 'Limited to one vendor\'s system', 'Shared channel; any member facility can request access with consent'],
    ['Open a record, 10 users (avg)', lat('centralised'), lat('fabric')],
    ['Create a record, 10 users (req/s)', f1(api('centralised', 'POST', 10).rps), f1(api('fabric', 'POST', 10).rps)],
    ['Peak create-record rate at the API (50 users)', `${f1(api('centralised', 'POST', 50).rps)} req/s`, `${f1(api('fabric', 'POST', 50).rps)} req/s (ledger ceiling about ${int(peakW)} TPS)`],
    ['Software licence cost', 'Varies (commercial or open source)', 'None (all open source)'],
  ], [2.2, 2.4, 3.0], { size: 19 }));
  push(P('In short, the proposed system gives up raw speed in exchange for guarantees the existing architecture cannot offer: records that cannot be altered without detection, an audit trail that cannot be erased, and consent rules that no single facility or administrator can quietly change. On the evidence above, the speed it keeps is sufficient for clinical use, and the guarantees it adds address the data security, integrity and accountability problems set out in Section 1.2.'));
  return out;
};
