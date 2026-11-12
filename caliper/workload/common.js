'use strict';
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const crypto = require('crypto');

/** Shared helpers: deterministic IDs so later rounds can find what earlier rounds wrote. */
class EhrBase extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        this.run = process.env.RUN_ID || 'r0';
        this.prefix = roundArguments.prefix || 'bench';
        this.patientId = `${this.run}-${this.prefix}-PAT-w${workerIndex}`;
        this.poolSize = roundArguments.poolSize || 200;
        this.txIndex = 0;
    }
    recId(i) { return `${this.run}-${this.prefix}-REC-w${this.workerIndex}-${i}`; }
    granteeId(i) { return `${this.run}-${this.prefix}-DOC-w${this.workerIndex}-${i}`; }
    hash() { return crypto.randomBytes(32).toString('hex'); }
    rnd(n) { return Math.floor(Math.random() * n); }
    async call(fn, args, readOnly = false) {
        return this.sutAdapter.sendRequests({ contractId: 'ehr', contractFunction: fn, contractArguments: args, readOnly, invokerIdentity: 'User1' });
    }
}
module.exports = { EhrBase };
