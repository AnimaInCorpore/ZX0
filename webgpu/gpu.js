export async function initWebGPU() {
    if (!('gpu' in navigator)) {
        throw new Error('WebGPU not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Failed to request WebGPU adapter.');

    const device = await adapter.requestDevice();
    return { device, adapter };
}

export function makeBuffer(device, arr, usage) {
    const [buffer, map] = (() => {
        if (arr instanceof Uint8Array || arr instanceof Uint16Array || arr instanceof Uint32Array) {
            const b = device.createBuffer({
                size: arr.byteLength,
                usage,
                mappedAtCreation: true
            });
            const writeArray = new Uint8Array(b.getMappedRange());
            writeArray.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
            b.unmap();
            return [b, writeArray];
        }
        throw new Error('Unsupported typed array for makeBuffer');
    })();
    return buffer;
}

export function readBuffer(device, buffer, size) {
    // Copy the GPU buffer back to a staging buffer and map.
    const readBuffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
    device.queue.submit([commandEncoder.finish()]);
    return readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const copyArray = new Uint8Array(readBuffer.getMappedRange()).slice();
        readBuffer.unmap();
        return copyArray;
    });
}
