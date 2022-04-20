
const diff_match_patch = require('./diff-match-patch.js')

/**
 * @author Wei Zheng
 * @github https://github.com/weijie0192/diff-sync-js
 * @summary A JavaScript implementation of Neil Fraser Differential Synchronization Algorithm
 */
module.exports = class DiffSyncAlghorithm {
    /**
     * @param {String} options.thisVersion version tag of the receiving end
     * @param {String} options.senderVersion version tag of the sending end
     * @param {Boolean} options.useBackup indicate if use backup copy (DEFAULT true)
     * @param {Boolean} options.debug indicate if print out debug message (DEFAULT false)
     */
    constructor({ thisVersion, senderVersion, useBackup = true, debug = false }) {
        this.thisVersion = thisVersion;
        this.senderVersion = senderVersion;
        this.useBackup = useBackup;
        this.debug = debug;
    }

    log(...anything) {
        if (this.debug) {
            console.debug("DIFF SYNC- ", ...anything);
        }
    }

    /**
     * Initialize the container
     * @param {Object} container any
     * @param {Object} mainText any
     */
    initObject(container, mainText) {
        const { thisVersion, senderVersion, useBackup } = this;
        if (mainText !== null && mainText !== undefined) {
            container.shadow = {
                [thisVersion]: 0,
                [senderVersion]: 0,
                value: mainText,
                edits: []
            };
            if (useBackup) {
                container.backup = {
                    [thisVersion]: 0,
                    [senderVersion]: 0,
                    value: mainText
                };
            }
        } else {
            container.shadow = {};
            container.backup = {};
        }
    }

    /**
     * On Receive Packet
     * @param {Object} options.payload payload object that contains {thisVersion, edits}. Edits should be a list of {senderVersion, patch}
     * @param {Object} options.container container object {shadow, backup}
     * @param {Function} options.onUpdateMain (patches, patchOperations, shadow[thisVersion]) => void
     * @param {Function} options.afterUpdate (shadow[senderVersion]) => void
     * @param {Function} options.onUpdateShadow (shadow, patch) => newShadowValue
     */
    onReceive({ payload, container, onUpdateMain, afterUpdate, onUpdateShadow }) {
        const { thisVersion, senderVersion, useBackup } = this;
        const { shadow, backup } = container;
        this.log("****************");
        this.log("--RECEIVED PAYLOAD --");
        this.log(thisVersion + ": " + payload[thisVersion]);
        this.log(senderVersion + ": ", payload.edits);
        this.log("-- CURRENT SHADOW --");
        this.log(shadow);

        if (useBackup) {
            if (shadow[thisVersion] !== payload[thisVersion]) {
                this.log("-- NOT MATCH --");
                this.log("backup: ", backup[thisVersion]);
                //STEP 4: if the receive version does not match with the shadow version, try to find the match backup or drop the process.
                if (backup[thisVersion] === payload[thisVersion]) {
                    this.log("-- REVERT --");
                    this.log(backup);
                    //revert to backup
                    shadow.value = backup.value;
                    shadow[thisVersion] = backup[thisVersion];
                    shadow.edits = [];
                } else {
                    this.log("-- ** NOT MATCH, DROP THE PROCESS ** --");
                    return;
                }
            }
        }

        //generate patch that ignore old n

        const filteredEdits = payload.edits.filter(edit => edit[senderVersion] >= shadow[senderVersion]);

        if (filteredEdits.length > 0) {
            const patches = filteredEdits.map(edit => edit.patch);
            const patchOperations = [];
            for (let patch of patches) {
                if (patch.length > 0) {
                    for (let operation of patch) {
                        patchOperations.push(operation);
                    }
                    //STEP 5a, 5b: apply each patch to the shadow value
                    if (onUpdateShadow) {
                        shadow.value = onUpdateShadow(shadow, patch);
                    } else {
                        shadow.value = diff_match_patch.patch_apply(patch, shadow.value)[0];
                    }
                }
                //STEP 6: for each patch applied, increment senderVersion
                shadow[senderVersion]++;
            }

            if (useBackup) {
                //STEP 7: copy the shadow value and version over to the backup.
                backup[thisVersion] = shadow[thisVersion];
                backup[senderVersion] = shadow[senderVersion];
            }

            //clear old edits
            this.clearOldEdits(shadow, payload[thisVersion]);

            if (patchOperations.length > 0) {
                if (useBackup) {
                    backup.value = shadow.value;
                }
                onUpdateMain(patches, patchOperations, shadow[thisVersion]);
            }

            this.log("***RESULT****");
            this.log("shadow: ", shadow);

            if (afterUpdate) {
                afterUpdate(shadow[senderVersion]);
            }
            this.log("**********");
        } else {
            this.log("**XXX* not match " + senderVersion);
        }
    }

    /**
     * On Sending Packet
     * @param {Object} options.container container object {shadow, backup}
     * @param {Object} options.mainText any
     * @param {Function} options.whenSend (shadow[senderVersion], shadow.edits) => void
     * @param {Function} options.whenUnchange (shadow[senderVersion]) => void
     */
    onSend({ container, mainText, whenSend, whenUnchange }) {
        const shadow = container.shadow;
        const { thisVersion, senderVersion } = this;
        //STEP 1a, 1b: generate diff
        const patch = diff_match_patch.patch_make(shadow.value, mainText);

        if (patch.length > 0) {
            //STEP 2: push diff into edits stack
            shadow.edits.push({
                [thisVersion]: shadow[thisVersion],
                patch
            });

            //STEP 3: copy main text over to the shadow and increment thisVersion
            shadow.value = mainText;
            shadow[thisVersion]++;

            whenSend(shadow[senderVersion], shadow.edits);
        } else if (whenUnchange) {
            whenUnchange(shadow[senderVersion]);
        }
    }

    /**
     * Acknowledge the other side when no change were made
     * @param {Object} container container object {shadow, backup}
     * @param {Object} payload payload object that contains {thisVersion, edits}. Edits should be a list of {senderVersion, patch}
     */
    onAck(container, payload) {
        const { backup, shadow } = container;
        const { thisVersion } = this;
        this.log("--- ON ACK ---");
        this.log("Receive version: ", payload[thisVersion]);
        this.log("Shadow version: ", shadow[thisVersion]);
        this.log("Backup version: ", backup[thisVersion]);
        this.clearOldEdits(shadow, payload[thisVersion]);
    }

    /**
     * clear old edits
     * @param {Object} shadow
     * @param {String} version
     */
    clearOldEdits(shadow, version) {
        shadow.edits = shadow.edits.filter(edit => edit[this.thisVersion] > version);
    }

    /**
     * apply patch to string
     * @param {String} val
     * @param {Object} patch json patch
     * @return string
     */
    strPatch(val, patch) {
        val = diff_match_patch.patch_apply(patch,val)[0];
        if (typeof val !== 'string') throw new Error(typeof val)
        return val
    }
};
