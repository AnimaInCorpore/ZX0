import { allocate, assign } from './memory.js';

const INITIAL_OFFSET = 1;
const MAX_SCALE = 50;

function offset_ceiling(index, offset_limit) {
    return index > offset_limit ? offset_limit : index < INITIAL_OFFSET ? INITIAL_OFFSET : index;
}

function elias_gamma_bits(value) {
    let bits = 1;
    while (value >>= 1)
        bits += 2;
    return bits;
}

export function optimize(input_data, input_size, skip, offset_limit, verbose = false) {
    let last_literal = [];
    let last_match = [];
    let optimal = [];
    let match_length = [];
    let best_length = [];

    let max_offset = offset_ceiling(input_size - 1, offset_limit);

    // Initialize arrays
    // In JS arrays are sparse/dynamic, but for performance and direct indexing we can pre-fill or just let them grow.
    // C uses calloc, so 0/NULL initialized.
    // last_literal, last_match, optimal are arrays of Blocks (pointers).
    // match_length, best_length are arrays of ints.

    // We need to be careful with array sizes if we want to match C exactly, but JS handles it.

    if (input_size > 2)
        best_length[2] = 2;

    // assign(&last_match[INITIAL_OFFSET], allocate(-1, skip-1, INITIAL_OFFSET, NULL));
    assign(last_match, INITIAL_OFFSET, allocate(-1, skip - 1, INITIAL_OFFSET, null));

    if (verbose) console.log("[");

    let dots = 2;

    for (let index = skip; index < input_size; index++) {
        let best_length_size = 2;
        max_offset = offset_ceiling(index, offset_limit);
        for (let offset = 1; offset <= max_offset; offset++) {
            if (index !== skip && index >= offset && input_data[index] === input_data[index - offset]) {
                // copy from last offset
                if (last_literal[offset]) {
                    let length = index - last_literal[offset].index;
                    let bits = last_literal[offset].bits + 1 + elias_gamma_bits(length);
                    assign(last_match, offset, allocate(bits, index, offset, last_literal[offset]));
                    if (!optimal[index] || optimal[index].bits > bits)
                        assign(optimal, index, last_match[offset]);
                }
                // copy from new offset
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
                // copy literals
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
            // process.stdout.write("."); // Node.js specific
            dots++;
        }
    }

    if (verbose) console.log("]");

    return optimal[input_size - 1];
}
