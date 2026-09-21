import { initWebGPU } from './gpu.js';

const N_BEST = 8; // Number of candidates to find

export async function gpuFullOptimize(input_data, input_size, skip, offset_limit) {
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

    // Output buffer for N-best candidates: {len, offset} for each index
    const resultSize = input_size * N_BEST * 2; // 2 uint32s per candidate
    const resultBuffer = device.createBuffer({
        size: resultSize * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const paramsBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([input_size, offset_limit]));

    const shaderCode = `
struct Candidate {
    len: u32,
    offset: u32
};

struct Candidates {
    items: array<Candidate, ${N_BEST}>
};

@group(0) @binding(0) var<storage, read> inputData : array<u32>;
@group(0) @binding(1) var<storage, read_write> outputCandidates : array<Candidates>;
@group(0) @binding(2) var<uniform> params : vec2<u32>; // input_size, offset_limit

fn get_byte(idx: u32) -> u32 {
    let u32_idx = idx >> 2u;
    let byte_shift = (idx & 3u) * 8u;
    return (inputData[u32_idx] >> byte_shift) & 0xFFu;
}

fn insert_candidate(list: ptr<function, array<Candidate, ${N_BEST}>>, new_len: u32, new_offset: u32) {
    if (new_len == 0u || new_len <= (*list)[${N_BEST - 1}].len) {
        return;
    }

    var i = ${N_BEST - 1}u;
    while (i > 0u && new_len > (*list)[i - 1].len) {
        (*list)[i] = (*list)[i - 1];
        i = i - 1u;
    }
    (*list)[i].len = new_len;
    (*list)[i].offset = new_offset;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let idx = global_id.x;
    let input_size = params[0];
    let max_offset = min(params[1], idx);

    if (idx >= input_size) { return; }

    var best_candidates : array<Candidate, ${N_BEST}>;
    // Initialize with zeros
    for(var i=0u; i<${N_BEST}u; i=i+1u) {
        best_candidates[i].len = 0u;
        best_candidates[i].offset = 0u;
    }

    for (var offset = 1u; offset <= max_offset; offset = offset + 1u) {
        var len = 0u;
        while (idx + len < input_size && get_byte(idx + len) == get_byte(idx - offset + len)) {
            len = len + 1u;
        }
        if (len > 0u) {
            insert_candidate(&best_candidates, len, offset);
        }
    }

    outputCandidates[idx] = Candidates(best_candidates);
}
`;

    const module = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' }
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: inputBuffer } },
            { binding: 1, resource: { buffer: resultBuffer } },
            { binding: 2, resource: { buffer: paramsBuffer } },
        ]
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    const workgroupCount = Math.ceil(input_size / 64);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();
    device.queue.submit([encoder.finish()]);

    // Read back the results
    const readBuffer = device.createBuffer({
        size: resultSize * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(resultBuffer, 0, readBuffer, 0, resultSize * 4);
    device.queue.submit([copyEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const result = new Uint32Array(readBuffer.getMappedRange());
    const result_copy = new Uint32Array(result);
    readBuffer.unmap();

    return result_copy;
}