'use strict';
const { EhrBase } = require('./common');
/** W2: read a record anchor from the world state (evaluate, no ordering). */
class ReadRecord extends EhrBase {
    async submitTransaction() { return this.call('GetRecordAnchor', [this.recId(this.rnd(this.poolSize))], true); }
}
module.exports.createWorkloadModule = () => new ReadRecord();
