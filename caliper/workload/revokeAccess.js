'use strict';
const { EhrBase } = require('./common');
/** W4: patient revokes a consent granted in W3 (write). */
class RevokeAccess extends EhrBase {
    async submitTransaction() {
        const i = this.txIndex++;
        return this.call('RevokeAccess', [this.patientId, this.patientId, this.granteeId(i)]);
    }
}
module.exports.createWorkloadModule = () => new RevokeAccess();
