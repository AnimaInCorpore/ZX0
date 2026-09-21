import { allocate, assign } from './memory.js';
import { gpuFullOptimize } from './gpu_full_optimize.js';

const INITIAL_OFFSET = 1;
const N_BEST = 8; // Should match the value in gpu_full_optimize.js
const MAX_SCALE = 50;

function elias_gamma_bits(value) {
    let bits = 1;
    while (value >>= 1)
        bits += 2;
    return bits;
}

function offset_ceiling(index, offset_limit) {
    return index > offset_limit ? offset_limit : index < INITIAL_OFFSET ? INITIAL_OFFSET : index;
}

function cpu_optimize(input_data, input_size, skip, offset_limit, verbose = false) {
    console.log("Using CPU fallback for optimization.");
    let last_literal = [];
    let last_match = [];
    let optimal = [];
    let match_length = [];
    let best_length = [];

    let max_offset = offset_ceiling(input_size - 1, offset_limit);

    if (input_size > 2)
        best_length[2] = 2;

    assign(last_match, INITIAL_OFFSET, allocate(-1, skip - 1, INITIAL_OFFSET, null));

    if (verbose) console.log("[");
    let dots = 2;

    for (let index = skip; index < input_size; index++) {
        let best_length_size = 2;
        max_offset = offset_ceiling(index, offset_limit);
        for (let offset = 1; offset <= max_offset; offset++) {
            if (index !== skip && index >= offset && input_data[index] === input_data[index - offset]) {
                if (last_literal[offset]) {
                    let length = index - last_literal[offset].index;
                    let bits = last_literal[offset].bits + 1 + elias_gamma_bits(length);
                    assign(last_match, offset, allocate(bits, index, offset, last_literal[offset]));
                    if (!optimal[index] || optimal[index].bits > bits)
                        assign(optimal, index, last_match[offset]);
                }
                if (!match_length[offset]) match_length[offset] = 0;
                if (++match_length[offset] > 1) {
                    if (best_length_size < match_length[offset]) {
                        let bits = optimal[index - best_length[best_length_size]].bits + elias_gamma_bits(best_length[best_length_size] - 1);
                        do {
                            best_length_size++;
                            let bits2 = optimal[index - best_length_size].bits + elias_gamma_bits(best_length_size - 1);
                            if (bits2 <= bits) {
                                best_length[best_length_size] = best_length_size;
                                bits = bits2;
                            } else {
                                best_length[best_length_size] = best_length[best_length_size - 1];
                            }
                        } while (best_length_size < match_length[offset]);
                    }
                    let length = best_length[match_length[offset]];
                    let bits = optimal[index - length].bits + 8 + elias_gamma_bits(Math.floor((offset - 1) / 128) + 1) + elias_gamma_bits(length - 1);
                    if (!last_match[offset] || last_match[offset].index !== index || last_match[offset].bits > bits) {
                        assign(last_match, offset, allocate(bits, index, offset, optimal[index - length]));
                        if (!optimal[index] || optimal[index].bits > bits)
                            assign(optimal, index, last_match[offset]);
                    }
                }
            } else {
                match_length[offset] = 0;
                if (last_match[offset]) {
                    let length = index - last_match[offset].index;
                    let bits = last_match[offset].bits + 1 + elias_gamma_bits(length) + length * 8;
                    assign(last_literal, offset, allocate(bits, index, 0, last_match[offset]));
                    if (!optimal[index] || optimal[index].bits > bits)
                        assign(optimal, index, last_literal[offset]);
                }
            }
        }

        if (verbose && (index * MAX_SCALE / input_size > dots)) {
            dots++;
        }
    }

    if (verbose) console.log("]");
    return optimal[input_size - 1];
}

export async function optimize(input_data, input_size, skip, offset_limit, verbose = false, useWebGPU = false) {
    if (useWebGPU) {
        try {
            const optimal = [];
            assign(optimal, skip - 1, allocate(0, skip - 1, 0, null));

            const gpuCandidates = await gpuFullOptimize(input_data, input_size, skip, offset_limit);

            let last_offset = INITIAL_OFFSET;

            for (let index = skip; index < input_size; index++) {
                const prev_optimal_literal = optimal[index - 1];
                let best_bits = (prev_optimal_literal?.bits || 0) + 1 + elias_gamma_bits(1) + 8;
                let best_offset = 0;
                let best_len = 1;
                let best_prev_optimal = prev_optimal_literal;

                for (let i = 0; i < N_BEST; i++) {
                    const cand_len = gpuCandidates[(index * N_BEST + i) * 2];
                    const cand_offset = gpuCandidates[(index * N_BEST + i) * 2 + 1];

                    if (cand_len === 0) break;
                    if (index < cand_len) continue;

                    const prev_optimal = optimal[index - cand_len];
                    if (!prev_optimal) continue;

                    let bits;
                    if (cand_offset === last_offset) {
                        bits = prev_optimal.bits + 1 + elias_gamma_bits(cand_len);
                    } else {
                        bits = prev_optimal.bits + 9 + elias_gamma_bits(Math.floor((cand_offset - 1) / 128) + 1) + elias_gamma_bits(cand_len - 1);
                    }

                    if (bits < best_bits) {
                        best_bits = bits;
                        best_offset = cand_offset;
                        best_len = cand_len;
                        best_prev_optimal = prev_optimal;
                    }
                }

                if (best_offset !== 0) {
                    last_offset = best_offset;
                }
                
                assign(optimal, index, allocate(best_bits, index, best_offset, best_prev_optimal));
            }

            return optimal[input_size - 1];
        } catch (error) {
            console.warn("WebGPU optimization failed, falling back to CPU:", error);
            return cpu_optimize(input_data, input_size, skip, offset_limit, verbose);
        }
    } else {
        return cpu_optimize(input_data, input_size, skip, offset_limit, verbose);
    }
}
