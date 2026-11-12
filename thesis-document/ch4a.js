// Chapter 4, sections 4.1 to 4.3: platforms, documentation, implementation architecture.
const { P, H2, H3, H4, bullet, numbered, table, figure, code, chapterTitle, reset } = require('./lib');
const { R, int } = require('./data');

module.exports = function ch4a() {
  reset(4);
  const v = R.versions;
  const out = [];
  const push = (...xs) => xs.forEach(x => Array.isArray(x) ? out.push(...x) : out.push(x));

  push(chapterTitle('FOUR', 'SYSTEM IMPLEMENTATION'));
  push(P('This chapter reports how the blockchain-based EHR management system designed in Chapter Three was built, installed and tested. A working prototype, named ChainCare EHR, was implemented on the T-MERN stack (TypeScript, MongoDB, Express.js, React and Node.js) with Hyperledger Fabric as the permissioned ledger. Two Fabric organisations represent two levels of the Nigerian healthcare system: Hospital A, a tertiary teaching hospital, and Facility B, a primary health centre (PHC). Together they model the PHC-to-hospital referral chain described in Section 1.1. The chapter then evaluates the prototype for performance, security and usability, and compares it with a centralised system built on the existing architecture analysed in Section 3.1.'));

  /* ---------------- 4.1 ---------------- */
  push(H2('4.1 Implementation Platforms'));
  push(P('The system was developed in three layers, each with its own tools: a presentation layer that runs in the user\'s browser, an application layer that exposes a REST API, and a data layer split between an off-chain database and the blockchain network. TypeScript was used in all three layers, including the smart contract, so one language and one set of data types runs from the user interface to the ledger. Table 4.1 lists every tool used, with the exact version installed.'));
  push(table('Implementation tools and versions', ['Layer', 'Tool / technology', 'Version', 'Purpose in the system'], [
    ['Programming language', 'TypeScript', `${v.tsBackend} (API, web), ${v.tsCC} (chaincode)`, 'Statically typed JavaScript used for the front end, API and chaincode'],
    ['Runtime', 'Node.js', v.node.replace('v', ''), 'Executes the API server, Fabric client and chaincode'],
    ['Front end', 'React', v.react, 'Component-based dashboards for patients, clinicians, auditors and administrators'],
    ['Front end', 'Vite', v.vite, 'Development server, production build and static web server'],
    ['Application layer', 'Express.js', v.express, 'REST API routing and middleware pipeline'],
    ['Application layer', 'Zod', v.zod, 'Validation of every request body against a schema'],
    ['Security', 'Helmet', v.helmet, 'HTTP security headers (content security policy, nosniff, frame denial)'],
    ['Security', 'express-rate-limit', v.ratelimit, 'Limits the number of API requests per client per minute'],
    ['Security', 'jsonwebtoken (JWT)', v.jwt, 'Signed session tokens (HS256) carrying user ID, role and organisation'],
    ['Security', 'bcryptjs', v.bcrypt, 'One-way hashing of user passwords'],
    ['Security', 'Node.js crypto module', 'built in', 'AES-256-GCM encryption of records; SHA-256 hashing for integrity'],
    ['Off-chain database', 'MongoDB', '7.0', 'Users, patient demographics and encrypted clinical records'],
    ['Off-chain database', 'Mongoose', v.mongoose, 'Object data modelling, schemas and validation for MongoDB'],
    ['Blockchain platform', 'Hyperledger Fabric', '2.5.10', 'Permissioned distributed ledger, channel and endorsement policy'],
    ['Blockchain platform', 'Fabric CA', '1.5.13', 'Issues X.509 identity certificates to each organisation'],
    ['Blockchain platform', 'CouchDB', '3.4.2', 'World-state database that supports rich JSON queries'],
    ['Smart contract', 'fabric-contract-api / fabric-shim', v.contractApi, 'Chaincode framework for consent, access control and audit logic'],
    ['Blockchain client', 'Fabric Gateway SDK (@hyperledger/fabric-gateway)', v.gateway, 'Endorses, submits and evaluates transactions over gRPC'],
    ['Containers', 'Docker Engine', R.host.docker, 'Runs peers, orderer, CAs, CouchDB, MongoDB and the chaincode service'],
    ['Testing', 'Jest / Node.js test runner / Supertest', `${v.jest} / built in / ${v.supertest}`, 'Unit tests (chaincode) and API integration tests'],
    ['Performance testing', 'Hyperledger Caliper', v.caliper, 'Blockchain benchmark: throughput, latency, success rate'],
    ['Performance testing', 'autocannon', v.autocannon, 'HTTP load testing of the API'],
    ['Security testing', 'OWASP ZAP, npm audit', '2.17.0, npm 10.9.4', 'Web vulnerability scanning and dependency audit'],
    ['Usability testing', 'Playwright, axe-core', `1.56, ${v.axe}`, 'Scripted task timing, network throttling, WCAG 2.1 accessibility audit'],
    ['Development', 'Visual Studio Code, Git', 'current', 'Source editing and version control'],
  ], [1.25, 1.7, 1.25, 2.9], { size: 18 }));

  push(H3('Presentation layer'));
  push(P('The user interface is a single-page application written in React 18 and TypeScript and bundled with Vite. It has four role-based dashboards. Patients see their records, manage consent and read a log of everyone who has accessed their data. Clinicians enrol patients, open and add records, and can request emergency (break-glass) access. Auditors verify record integrity against the ledger and read the audit trail. Administrators manage staff accounts. The production build is a single 164 KB JavaScript file, which matters for clinics on slow mobile connections.'));
  push(H3('Application layer'));
  push(P('The API runs on Node.js with Express.js. Every request passes through a chain of security middleware (Helmet headers, a CORS allow-list, a rate limiter, JWT verification, a role check and Zod validation) before it reaches a controller. Three services sit behind the controllers: a data-access service that uses Mongoose to talk to MongoDB, a crypto service that encrypts clinical payloads with AES-256-GCM and computes their SHA-256 digests, and a ledger service that talks to Hyperledger Fabric through the Fabric Gateway SDK.'));
  push(H3('Data layer'));
  push(P('Clinical data is split between two stores. MongoDB holds the bulky data that is read often: user accounts, patient demographics and the encrypted clinical records themselves. The Fabric ledger holds the small data that must be trusted: a SHA-256 hash of every record, every consent decision and an audit event for every access attempt. Each peer keeps the current state in CouchDB, which allows JSON queries such as "all records of patient X". The chaincode (smart contract) is written in TypeScript and runs as an external service beside each peer.'));

  /* ---------------- 4.1.1 ---------------- */
  push(H3('4.1.1 Justification of the Implementation Platforms'));
  push(P('The platforms were chosen for the specific demands of health records in Nigeria: strict confidentiality, several independent facilities that must share data without a single owner, limited budgets and uneven connectivity. The main reasons are as follows.', { keepNext: true }));
  const j = numbered();
  push(j('**Permissioned trust suited to healthcare.** Hyperledger Fabric admits only organisations that hold certificates issued by a known certificate authority, so every transaction is tied to a named facility. Unlike public blockchains, it needs no cryptocurrency, mining or transaction fees. Its endorsement policy (both facilities must sign a transaction) prevents one hospital from rewriting shared history on its own, which directly supports the integrity objective of this study.'));
  push(j('**One language across the stack.** Writing the front end, API and chaincode in TypeScript let the same types (patient, record, consent, audit event) be checked by the compiler in every layer. This removed a class of mismatch errors between layers and shortened development. TypeScript and JavaScript developers are also far more common in the Nigerian software market than Go or Java blockchain specialists, which lowers the cost of maintaining the system.'));
  push(j(`**Off-chain storage that keeps the ledger small and fast.** MongoDB stores encrypted clinical documents as flexible JSON, which fits records whose fields differ by type (a lab result looks nothing like a prescription). Only a 64-character hash goes on the ledger. By the end of testing, after more than ${int(Math.floor(Number(R.host.couchSize.split(' ')[0]) / 1000) * 1000)} state entries had been written, each peer's ledger took about ${R.host.ledgerSize.replace('M', ' MB').replace('G', ' GB')} of disk, while the same data stored whole on the chain would have been many times larger.`));
  push(j('**Open source with no licence cost.** Every component in Table 4.1 is free and open source. A state ministry of health or a PHC board can deploy the system without per-seat licences, which matters in a sector where budgets are the main barrier to EHR adoption (Babatope et al., 2024).'));
  push(j('**Light, responsive interface for low-bandwidth settings.** React builds a single compact bundle that the browser caches, so after the first visit only small JSON responses travel over the network. Tests under a throttled 3G profile (Section 4.4.8) showed that every task still completed in under 3.5 seconds.'));
  push(j('**Container-based deployment and scaling.** Every component runs in a Docker container, so the same network can be started on a laptop, a hospital server or a cloud host with one command. New facilities join by adding an organisation and its peer, without changing the application code.'));
  push(j('**Mature testing and security tooling.** Hyperledger Caliper, Jest, OWASP ZAP and axe-core are standard, well-documented tools. Using them made the evaluation in Section 4.4 repeatable by other researchers.'));

  /* ---------------- 4.2 ---------------- */
  push(H2('4.2 Documentation'));
  push(P('This section documents how to install the system and configure it for use. The steps were followed on a fresh Ubuntu 24.04 machine to produce the results in this chapter.'));
  push(H3('4.2.1 System Installation'));
  push(H4('Prerequisites'));
  push(P('The following must be installed before the system itself: Docker Engine 24 or later with Docker Compose, Node.js 22 LTS with npm, Git, cURL and jq. All other components are downloaded by the steps below.'));
  const s = numbered();
  push(s('**Install Hyperledger Fabric.** Download the official installer, which fetches the Fabric samples, the command-line tools (`peer`, `configtxgen`, `fabric-ca-client`) and the Docker images for Fabric 2.5.10 and Fabric CA 1.5.13.'));
  push(code('mkdir ehr && cd ehr\ncurl -sSLO \\\n  https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh\nchmod +x install-fabric.sh\n./install-fabric.sh --fabric-version 2.5.10 --ca-version 1.5.13 \\\n  docker samples binary'));
  push(s('**Start the blockchain network.** Bring up two organisations, the Raft ordering service, a certificate authority per organisation and CouchDB state databases, then create the channel `ehrchannel` and join both peers to it.'));
  push(code('cd fabric-samples/test-network\n./network.sh up createChannel -c ehrchannel -ca -s couchdb'));
  push(s('**Build and deploy the chaincode.** Compile the TypeScript chaincode and deploy it as a service on both peers. Deployment approves and commits the chaincode definition under the default policy, which requires endorsement by both organisations.'));
  push(code('cd ../../chaincode && npm install && npx tsc\ncd ../fabric-samples/test-network\n./network.sh deployCCAAS -c ehrchannel -ccn ehr \\\n  -ccp ../../chaincode -ccv 1.1 -ccs 1'));
  push(s('**Create the CouchDB index** used by the patient record query, on each peer\'s state database.'));
  push(code('curl -u admin:adminpw -X POST -H "Content-Type: application/json" \\\n  http://localhost:5984/ehrchannel_ehr/_index \\\n  -d \'{"index":{"fields":["docType","patientId"]},\n       "ddoc":"indexPatientDoc","name":"indexPatient","type":"json"}\''));
  push(s('**Start MongoDB.**'));
  push(code('docker run -d --name ehr-mongo -p 27017:27017 mongo:7'));
  push(s('**Install the API and the web application.**'));
  push(code('cd ../../backend && npm install\ncd ../frontend && npm install && npm run build'));
  push(H3('4.2.2 System Setup'));
  push(P('The API is configured through environment variables, usually kept in a `.env` file in the backend folder. Table 4.2 lists them. Secrets in the table are development values only; in production they must come from a key vault and never from source code.'));
  push(table('API configuration (environment variables)', ['Variable', 'Default', 'Meaning'], [
    ['PORT', '4000', 'Port the API listens on'],
    ['LEDGER_MODE', 'fabric', '`fabric` uses Hyperledger Fabric; `centralised` runs the baseline with all rules in MongoDB'],
    ['MONGO_URI', 'mongodb://localhost:27017/ehr', 'MongoDB connection string'],
    ['FABRIC_TEST_NETWORK', '…/fabric-samples/test-network', 'Location of the organisation certificates and keys'],
    ['FABRIC_CHANNEL / FABRIC_CHAINCODE', 'ehrchannel / ehr', 'Channel and chaincode names'],
    ['JWT_SECRET', '(development value)', 'Key used to sign session tokens'],
    ['DATA_KEY_HEX', '(development value)', '256-bit AES key for encrypting records, as 64 hex characters'],
    ['RATE_LIMIT_PER_MINUTE', '300', 'Maximum API requests per client per minute (0 disables it)'],
    ['CORS_ORIGIN', 'http://localhost:5173', 'Web origins allowed to call the API'],
  ], [2.6, 2.1, 3.2], { size: 18 }));
  push(P('With the network and database running, the system is started and loaded with demonstration accounts as follows.'));
  push(code('cd backend\nnpm start                 # API on http://localhost:4000\nnpm run seed              # demo staff and one patient with 4 records\ncd ../frontend\nnpm run preview           # web application on http://localhost:4173'));
  push(P('The seed script creates the accounts in Table 4.3. Each account belongs to one facility, and the API signs that user\'s ledger transactions with the X.509 identity of the facility (`Org1MSP` or `Org2MSP`) issued by Fabric CA.'));
  push(table('Demonstration accounts created by the seed script (password Passw0rd!2026)', ['Role', 'Name', 'Email', 'Facility (MSP)'], [
    ['Administrator', 'Ifeoma Nwosu', 'admin@hospital-a.ng', 'Hospital A (Org1MSP)'],
    ['Administrator', 'Bala Ibrahim', 'admin@facility-b.ng', 'Facility B (Org2MSP)'],
    ['Clinician', 'Dr. Tunde Adeyemi (Internal Medicine)', 'adeyemi@hospital-a.ng', 'Hospital A (Org1MSP)'],
    ['Clinician', 'Dr. Ngozi Okafor (Cardiology)', 'okafor@hospital-a.ng', 'Hospital A (Org1MSP)'],
    ['Clinician', 'Dr. Aisha Bello (General Practice)', 'bello@facility-b.ng', 'Facility B (Org2MSP)'],
    ['Clinician', 'Dr. Chidi Eke (Emergency Medicine)', 'eke@facility-b.ng', 'Facility B (Org2MSP)'],
    ['Auditor', 'Emeka Obi', 'audit@hospital-a.ng', 'Hospital A (Org1MSP)'],
    ['Patient', 'Chinwe Amadi', 'patient@example.ng', 'Facility B (Org2MSP)'],
  ], [1.2, 2.6, 2.1, 1.9], { size: 19 }));
  push(P('Figure 4.1 shows the sign-in page. After signing in, each user is taken to the dashboard for their role. The full test suites are run with `npm test` in the chaincode and backend folders (Section 4.6).'));
  push(figure('/root/ehr/screenshots/cropped_for_document/01_login.png', 'Sign-in page of the ChainCare EHR web application', 5.2));

  /* ---------------- 4.3 ---------------- */
  push(H2('4.3 Implementation Architecture'));
  push(P('Figure 4.2 shows how the implementation tools fit together. It follows the layered design of Section 3.4, with each box replaced by the actual technology used. Requests flow from top to bottom: the browser sends HTTPS requests with a JWT to the Express API; the API checks them, encrypts or decrypts data, and then talks to MongoDB for the clinical payload and to the Fabric network for hashes, consent and audit records.'));
  push(figure('/root/ehr/figures/arch.png', 'Implementation architecture of the blockchain-based EHR system', 6.27));
  push(P('The blockchain layer has two organisations, each with one endorsing peer, a CouchDB state database, a running copy of the EHR chaincode and its own certificate authority. A Raft ordering service puts endorsed transactions into blocks and sends them to both peers. Raft tolerates crashed nodes but not malicious ones; this was judged acceptable for a consortium of licensed facilities, and Fabric 3.x offers a Byzantine fault-tolerant orderer where stronger guarantees are needed. Every write needs signatures from both organisations, so neither facility can change the ledger alone.'));
  push(P('The EHR chaincode exposes thirteen functions, summarised in Table 4.4. Functions that change state are submitted as transactions and go through ordering. Read-only functions are evaluated on a single peer and return in milliseconds. Opening a record is deliberately a transaction rather than a read, so that every access attempt, whether allowed or denied, is written to the ledger.'));
  push(table('EHR chaincode functions', ['Function', 'Type', 'What it does'], [
    ['RegisterPatient', 'Write', 'Registers a patient under the calling facility (the home facility)'],
    ['CreateRecord', 'Write', 'Anchors the SHA-256 hash of a new record; allowed for the home facility or a clinician with consent'],
    ['UpdateRecordHash', 'Write', 'Anchors a new version of a record and increments its version number'],
    ['AccessRecord', 'Write', 'Checks consent (owner, status, organisation, expiry, scope) and logs the decision'],
    ['EmergencyAccess', 'Write', 'Break-glass access; needs a written reason and is logged as EMERGENCY'],
    ['GrantAccess / RevokeAccess', 'Write', 'Patient grants or withdraws a clinician\'s consent, optionally limited by record type and end date'],
    ['GetRecordAnchor / VerifyIntegrity', 'Read', 'Returns a record\'s ledger hash or checks a supplied hash against it'],
    ['GetRecordHistory', 'Read', 'Every version of a record from the ledger history'],
    ['QueryRecordsByPatient', 'Read', 'Paginated CouchDB query of a patient\'s records (50 per page)'],
    ['GetAuditTrail / GetConsents', 'Read', 'The patient\'s audit events and consent list'],
  ], [2.4, 0.8, 4.6], { size: 19 }));
  push(P('Figure 4.3 traces the two most important flows through these components. When a record is created, the API encrypts it, stores the ciphertext in MongoDB and anchors its hash on the ledger; if the ledger refuses (for example, because the author has no right to write), the MongoDB copy is deleted so the two stores never disagree. When a record is opened, the chaincode decides on consent first, and only then does the API fetch the ciphertext, recompute its hash and compare it with the ledger. A mismatch stops the request with an integrity error before any data is decrypted.'));
  push(figure('/root/ehr/figures/seq.png', 'Sequence of operations for creating and opening a record', 6.27, 8.6));
  return out;
};
