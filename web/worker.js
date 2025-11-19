import { compressData, decompressData } from './zx0.js';

self.onmessage = function(e) {
    const { action, payload } = e.data;

    try {
        let result;
        if (action === 'compress') {
            const { inputData, skip, quickMode, backwardsMode, classicMode } = payload;
            result = compressData(inputData, skip, quickMode, backwardsMode, classicMode);
        } else if (action === 'decompress') {
            const { inputData, classicMode, backwardsMode } = payload;
            result = decompressData(inputData, classicMode, backwardsMode);
        } else {
            throw new Error('Unknown action');
        }
        self.postMessage({ status: 'success', action: action, payload: result });
    } catch (error) {
        self.postMessage({ status: 'error', action: action, payload: error.message });
    }
};
