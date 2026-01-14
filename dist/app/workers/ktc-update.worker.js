import { updateKtcDataCurrent, updateKtcDataHistory, } from "../utils/ktc-update.js";
import { workerData } from "worker_threads";
const { syncComplete } = workerData;
if (!syncComplete) {
    await updateKtcDataHistory();
}
else {
    await updateKtcDataCurrent();
}
