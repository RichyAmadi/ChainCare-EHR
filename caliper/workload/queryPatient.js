'use strict';
const { EhrBase } = require('./common');
/** W6: CouchDB rich query - all record anchors of a patient (evaluate). */
class QueryPatient extends EhrBase {
    async submitTransaction() { return this.call('QueryRecordsByPatient', [this.patientId, '50', ''], true); }
}
module.exports.createWorkloadModule = () => new QueryPatient();
