import { initWebGPU } from './gpu.js';

export async function gpuOptimize(input_data, input_size, skip, offset_limit, maxGpuOffset = 4096, maxMatchLen = 1024, tileSize = 256) {
    // Try to initialize WebGPU
    const { device } = await initWebGPU();

    // Prepare input buffer: pack Uint8Array into a Uint32Array
    const paddedLength = Math.ceil(input_size / 4);
    const u32Input = new Uint32Array(paddedLength);
    for (let i = 0; i < input_size; i++) {
        u32Input[Math.floor(i / 4)] |= input_data[i] << (8 * (i % 4));
    }

    const inputBuffer = device.createBuffer({
        size: u32Input.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Uint32Array(inputBuffer.getMappedRange()).set(u32Input);
    inputBuffer.unmap();

    // Prepare result buffer: two u32 per index (offset,length)
    // We'll write one u32 per index (combined: (len<<16) | (65535-offset)) using atomics
    const resultLen = input_size;
    const bestCombinedBuffer = device.createBuffer({
      size: resultLen * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    const paramsBuffer = device.createBuffer({
      size: 24,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Uint32Array(paramsBuffer.getMappedRange()).set([input_size, skip, Math.min(offset_limit, maxGpuOffset), maxMatchLen, 1, 0]);
    paramsBuffer.unmap();

    const shaderCode = `
struct Params {
  inputSize : u32;
  skip : u32;
  maxOffset: u32;
  maxMatchLen: u32;
  offsetStart: u32;
  offsetCount: u32;
};

@group(0) @binding(0) var<storage, read> inputData : array<u32>;
@group(0) @binding(1) var<storage, read_write> bestCombBuf : array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params : Params;

fn get_byte(idx: u32) -> u32 {
    let u32_idx = idx / 4u;
    let byte_shift = (idx % 4u) * 8u;
    return (inputData[u32_idx] >> byte_shift) & 0xFFu;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let idx = global_id.x;
  if (idx >= params.inputSize) { return; }
  if (idx < params.skip) {
    return;
  }

  let limit = params.maxOffset;
  let maxml = params.maxMatchLen;
  let end = params.inputSize;

  // iterate a tile of offsets this pass
  let offEnd = params.offsetStart + params.offsetCount;
  for (var offset: u32 = params.offsetStart; offset < offEnd && offset <= limit; offset = offset + 1u) {
    if (idx < offset) { break; }
    var len: u32 = 0u;
    // compare bytes
    while (len < maxml) {
      if ((idx + len) >= end || (idx - offset + len) >= end) { break; }
      let a = get_byte(idx + len);
      let b = get_byte(idx - offset + len);
      if (a != b) { break; }
      len = len + 1u;
    }
    if (len > 0u) {
      // encode len & offset into u32: (len<<16) | (65535 - offset)
      let comb: u32 = (len << 16) | (65535u - offset);
      atomicMax(&bestCombBuf[idx], comb);
    }
  }

  // bestCombined already contains packed best (len<<16)|(65535-offset)
  // No per-index writes required besides atomics done while scanning
}
`;

    const module = device.createShaderModule({ code: shaderCode });

    const pipeline = device.createComputePipeline({
        compute: { module, entryPoint: 'main' }
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: bestCombinedBuffer } },
            { binding: 2, resource: { buffer: paramsBuffer } },
        ]
    });

    // Zero out the bestCombinedBuffer
    const zeroArr = new Uint32Array(resultLen);
    device.queue.writeBuffer(bestCombinedBuffer, 0, zeroArr);

    const workgroupCount = Math.ceil(input_size / 64);
    // Tile offsets and dispatch per tile
    const tile = Math.min(tileSize, Math.max(1, Math.floor(maxGpuOffset / 4)));
    for (let offsetStart = 1; offsetStart <= Math.min(offset_limit, maxGpuOffset); offsetStart += tile) {
      const offsetCount = Math.min(tile, Math.min(offset_limit, maxGpuOffset) - offsetStart + 1);
      // update params: offsetStart, offsetCount
      device.queue.writeBuffer(paramsBuffer, 16, new Uint32Array([offsetStart, offsetCount]));

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupCount);
      pass.end();
      device.queue.submit([encoder.finish()]);
      // Small pause by awaiting a tick - ensures work is submitted before next tile
      await device.queue.onSubmittedWorkDone();
    }

    // read back result
    const readBuffer = device.createBuffer({
      size: resultLen * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const cb = device.createCommandEncoder();
    cb.copyBufferToBuffer(bestCombinedBuffer, 0, readBuffer, 0, resultLen * 4);
    device.queue.submit([cb.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const view = new Uint32Array(readBuffer.getMappedRange());
    const offsets = new Uint32Array(resultLen);
    const lengths = new Uint32Array(resultLen);
    const COMB_OFFSET_MAX = 0xffff;
    for (let i = 0; i < resultLen; i++) {
      const comb = view[i];
      if (!comb) { offsets[i] = 0; lengths[i] = 0; continue; }
      lengths[i] = comb >>> 16;
      offsets[i] = COMB_OFFSET_MAX - (comb & 0xffff);
    }
    readBuffer.unmap();

    return { offsets, lengths };
}
