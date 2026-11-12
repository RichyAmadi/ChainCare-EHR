'use strict';
const { EhrBase } = require('./common');
/** W3: patient grants a clinician consent (write). */
class GrantAccess extends EhrBase {
    async submitTransaction() {
        const i = this.txIndex++;
        return this.call('GrantAccess', [this.patientId, this.patientId, this.granteeId(i), 'Org1MSP', 'ALL', '']);
    }
}
module.exports.createWorkloadModule = () => new GrantAccess();
