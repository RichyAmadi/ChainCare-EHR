'use strict';
const { EhrBase } = require('./common');
/** W1: anchor a new record hash (write). The worker's patient is registered once before the round. */
class CreateRecord extends EhrBase {
    async initializeWorkloadModule(...a) {
        await super.initializeWorkloadModule(...a);
        if (this.roundArguments.registerPatient) {
            await this.call('RegisterPatient', [this.patientId]).catch(() => {});
        }
    }
    async submitTransaction() {
        const i = this.txIndex++;
        return this.call('CreateRecord', [this.recId(i), this.patientId, 'LAB_RESULT', this.hash(), `mongo-${i}`, 'DOC-BENCH']);
    }
}
module.exports.createWorkloadModule = () => new CreateRecord();
