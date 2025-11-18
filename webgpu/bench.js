import { compressData } from './zx0.js';

export async function runBenchmark(inputData, repeats = 3, useWebGPU = false, quick=false, backwards=false, classic=false) {
    let times = [];
    for (let i = 0; i < repeats; i++) {
        const start = performance.now();
        await compressData(inputData, 0, quick, backwards, classic, useWebGPU);
        const end = performance.now();
        times.push(end - start);
    }
    const sum = times.reduce((a,b) => a + b, 0);
    const avg = sum / times.length;
    return { times, avg };
}
