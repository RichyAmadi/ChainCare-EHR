// Chapter 4, sections 4.5 and 4.6: system requirements and system testing.
const fs = require('fs');
const { P, H2, H3, H4, bullet, numbered, table, figure, code } = require('./lib');
const { R, f1, int } = require('./data');

module.exports = function ch4c() {
  const out = [];
  const push = (...xs) => xs.forEach(x => Array.isArray(x) ? out.push(...x) : out.push(x));
  const cov = JSON.parse(fs.readFileSync('/root/ehr/results/coverage.json', 'utf8'));
  const F = R.secF;

  /* ---------------- 4.5 ---------------- */
  push(H2('4.5 System Requirements'));
  push(P('The requirements below come from the measurements in Section 4.4. The minimum column is the configuration on which every test in this chapter ran; the recommended column adds headroom and resilience for a facility that runs its own node in production, taking into account the unstable power and connectivity common in Nigerian health facilities.'));
  push(H3('4.5.1 Hardware Requirements'));
  push(table('Hardware requirements', ['Component', 'Minimum (as tested)', 'Recommended (per facility node in production)'], [
    ['Processor', `${R.host.vcpus} virtual CPUs (x86-64, about 2.1 GHz)`, '4 or more cores'],
    ['Memory (RAM)', '8 GB', '16 GB'],
    ['Storage', `40 GB (Docker images ${parseFloat(R.host.imagesGB).toFixed(1)} GB, ledger ${R.host.ledgerSize.replace('M', ' MB')} per peer after testing)`, '250 GB SSD, with daily off-site backup of MongoDB and the peer ledger'],
    ['Network', 'Local network between containers', 'Fixed public IP or VPN between facilities; at least 10 Mbps; a second internet link as fallback'],
    ['Power', 'Mains', 'Uninterruptible power supply plus inverter or solar backup for at least 4 hours'],
    ['Client device', 'Any device with a current web browser', 'Desktop, laptop, tablet or Android smartphone with 2 GB RAM or more'],
    ['Client connection', '3G mobile data (tested at 1.6 Mbps, 300 ms delay)', '4G or broadband'],
  ], [1.5, 2.6, 3.4], { size: 19 }));
  push(H3('4.5.2 Software Requirements'));
  push(table('Software requirements', ['Category', 'Software', 'Version'], [
    ['Server operating system', 'Ubuntu Server LTS (or another Linux distribution with Docker)', '22.04 or 24.04'],
    ['Container platform', 'Docker Engine and Docker Compose', '24 or later'],
    ['Runtime', 'Node.js with npm', '22 LTS'],
    ['Blockchain', 'Hyperledger Fabric peer, orderer and tools; Fabric CA', '2.5.10; 1.5.13'],
    ['State database', 'CouchDB', '3.4'],
    ['Off-chain database', 'MongoDB Community Server', '7.0'],
    ['Application packages', 'Express, Mongoose, Fabric Gateway SDK, Helmet, Zod, React, Vite and others (installed by npm)', 'As in Table 4.1'],
    ['Web browser (client)', 'Google Chrome, Microsoft Edge, Mozilla Firefox or Safari', 'Any release from the last two years'],
    ['Development tools (optional)', 'Visual Studio Code, Git, Hyperledger Caliper, OWASP ZAP', 'Current releases'],
  ], [1.8, 4.0, 1.7], { size: 19 }));

  /* ---------------- 4.6 ---------------- */
  push(H2('4.6 System Testing'));
  push(P('The system was tested at four levels: unit tests of the smart contract, integration tests of the API, functional tests of the complete system through its user interface, and the non-functional tests already reported in Section 4.4 (performance, security, usability). All tests are automated, so they can be repeated after every change.'));
  push(H3('Unit testing of the chaincode'));
  push(P(`Fourteen unit tests exercise the EHR contract with an in-memory stand-in for the Fabric ledger, so each rule can be checked in isolation and in milliseconds. They cover registration, record anchoring, hash validation, consent granting, scoping, expiry, organisation binding, revocation, emergency access, integrity checks, versioning and the audit trail. All 14 passed (Figure 4.15), covering ${cov.chaincode.lines}% of the contract's lines and ${cov.chaincode.functions}% of its functions.`));
  const cc = R.tests.chaincode.split('\n').filter(l => /✓|✕/.test(l)).map(l => l.replace(/[✓✕]\s*/, '').replace(/\s*\(\d+ ms\)\s*$/, '').trim());
  push(table('Chaincode unit test cases', ['No.', 'Test case', 'Result'], cc.map((t, i) => [String(i + 1), t.charAt(0).toUpperCase() + t.slice(1), 'Passed']), [0.5, 5.6, 0.9], { size: 19 }));
  push(figure('/root/ehr/screenshots/cropped_for_document/t1_chaincode_tests.png', 'Output of the chaincode unit tests', 6.0));
  push(H3('Integration testing of the API'));
  push(P(`Fourteen integration tests send real HTTP requests to the Express application connected to a test MongoDB database. They check the crypto service, authentication, security headers, patient enrolment, encrypted storage, consent across facilities, tamper detection, role restrictions, input validation, audit visibility and pagination. All 14 passed (Figure 4.16), with ${cov.api.lines}% line coverage of the API source. The Fabric-specific code is exercised separately, by the benchmarks and scenario tests that run against the live network.`));
  const at = R.tests.api.split('\n').filter(l => /ok \d/.test(l)).map(l => l.replace(/^\s*ok \d+ - /, '').trim());
  push(table('API integration test cases', ['No.', 'Test case', 'Result'], at.map((t, i) => [String(i + 1), t.charAt(0).toUpperCase() + t.slice(1), 'Passed']), [0.5, 5.6, 0.9], { size: 19 }));
  push(figure('/root/ehr/screenshots/cropped_for_document/t2_api_tests.png', 'Output of the API integration tests', 6.0));
  push(H3('Functional (system) testing'));
  push(P('Functional tests drove the finished web application in a real browser, through the production build and against the live Fabric network, using a Playwright script that acts as each type of user in turn. Table 4.21 lists the cases with the expected and observed results. Every case passed.'));
  const fn = [
    ['FT1', 'Clinician signs in', 'Clinician dashboard for the right facility', 'As expected', 'Figure 4.1'],
    ['FT2', 'Clinician searches for a patient and lists records', 'Records listed from the ledger query with their hashes', 'As expected', 'Figure 4.17'],
    ['FT3', 'Clinician with consent opens a record', 'Decrypted record shown with "integrity verified"', 'As expected', 'Figure 4.18'],
    ['FT4', 'Doctor at another facility opens a record without consent', 'Access denied; attempt logged on the ledger', 'As expected', 'Figure 4.10'],
    ['FT5', 'Patient signs in and views own records', 'Patient dashboard lists only her records', 'As expected', 'Figure 4.19'],
    ['FT6', 'Patient grants consent to a clinician', 'Consent recorded with ledger transaction ID', 'As expected', 'Figure 4.11'],
    ['FT7', 'Doctor opens the record after consent', 'Record shown and verified', 'As expected', 'Figure 4.12'],
    ['FT8', 'Doctor adds a specialist record', 'Record encrypted, stored and hash anchored', 'As expected', 'Figure 4.20'],
    ['FT9', 'A&E doctor uses break-glass access with a reason', 'Record opens; access flagged EMERGENCY', 'As expected', 'Figure 4.13'],
    ['FT10', 'Patient views her access log', 'Allowed, denied and emergency events listed', 'As expected', 'Figure 4.14'],
    ['FT11', 'Auditor verifies a tampered record', '"TAMPERED" reported with the ledger hash', 'As expected', 'Figure 4.8'],
    ['FT12', 'Clinician opens the tampered record', 'Blocked with an integrity error before decryption', 'As expected', 'Figure 4.9'],
    ['FT13', 'Administrator views staff and facility identities', 'Staff list with facility and MSP shown', 'As expected', 'Figure 4.21'],
    ['FT14', 'Patient revokes consent; doctor tries again', 'Access refused on the next attempt', 'As expected (10/10)', 'Table 4.14, S3'],
  ];
  push(table('Functional test cases', ['ID', 'Test case', 'Expected result', 'Actual result', 'Evidence'], fn, [0.6, 2.4, 2.4, 1.1, 1.0], { size: 18 }));
  push(figure('/root/ehr/screenshots/cropped_for_document/02_clinician_patient_records.png', 'Clinician dashboard: patient search and record list from the ledger', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/03_record_opened_integrity_verified.png', 'A record opened by the treating clinician, decrypted and verified against the ledger', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/05_patient_my_records.png', 'Patient dashboard: the patient\'s own records', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/08_specialist_adds_record.png', 'The referral specialist adds a record, which is encrypted, stored and anchored on the ledger', 6.0));
  push(figure('/root/ehr/screenshots/cropped_for_document/13_admin_staff.png', 'Administrator dashboard: staff accounts and facility identities', 6.0));
  push(H3('Summary of testing'));
  push(table('Summary of test results', ['Test level', 'Tool', 'Cases', 'Passed', 'Where reported'], [
    ['Unit (chaincode)', 'Jest', '14', '14', 'Table 4.19'],
    ['Integration (API)', 'Node.js test runner, Supertest', '14', '14', 'Table 4.20'],
    ['Functional (system)', 'Playwright', '14', '14', 'Table 4.21'],
    ['Access control', 'Custom script', int(F.accessControl.requests), `${int(F.accessControl.TP + F.accessControl.TN)}`, 'Table 4.11'],
    ['Attack attempts', 'Custom script', String(F.attacks.length), String(F.attacks.filter(a => a.blocked).length), 'Table 4.12'],
    ['Tamper detection', 'Custom script', String(F.integrity.injected), String(F.integrity.payloadOnly.detected + F.integrity.insiderWithHashRewrite.detected), 'Table 4.10'],
    ['Blockchain performance', 'Hyperledger Caliper', `${int(R.main.reduce((a, m) => a + m.succ + m.fail, 0))} transactions`, `${int(R.main.reduce((a, m) => a + m.succ, 0))} committed`, 'Table 4.7'],
  ], [1.7, 2.1, 1.3, 1.3, 1.2], { size: 19 }));
  push(P('Testing also found and fixed real defects, which is the purpose of testing. The first version of the patient record query returned all of a patient\'s records in one call and timed out once a test patient had about 900 records; it was changed to return 50 records per page (chaincode version 1.1). The enrolling clinician at the patient\'s own facility was at first refused access because no consent existed on the ledger; enrolment now records the consent signed at registration. Scanning found missing security headers, two vulnerable development packages and unlabelled form fields, all fixed as shown in Table 4.13.'));
  return out;
};
