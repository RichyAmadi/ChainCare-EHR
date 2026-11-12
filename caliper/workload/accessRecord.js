'use strict';
const { EhrBase } = require('./common');
/** W5: audited access - consent check plus an audit event written to the ledger (write). */
class AccessRecord extends EhrBase {
    async submitTransaction() { return this.call('AccessRecord', [this.recId(this.rnd(this.poolSize)), this.patientId]); }
}
module.exports.createWorkloadModule = () => new AccessRecord();
