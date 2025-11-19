import { optimize } from './optimize.js';
import { compress } from './compress.js';
import { decompress } from './decompress.js';

const MAX_OFFSET_ZX0 = 32640;
const MAX_OFFSET_ZX7 = 2176;
const FALSE = 0;
const TRUE = 1;

function reverse(data, start, end) {
    let c;
    while (start < end) {
        c = data[start];
        data[start++] = data[end];
        data[end--] = c;
    }
}

export function decompressData(input_data, classic_mode = false, backwards_mode = false) {
    let input_buffer = new Uint8Array(input_data);
    if (backwards_mode) {
        input_buffer.reverse();
    }
    let output_data = decompress(input_buffer, classic_mode, backwards_mode);
    if (backwards_mode) {
        output_data.reverse();
    }
    return output_data;
}

export function compressData(input_data, skip = 0, quick_mode = false, backwards_mode = false, classic_mode = false) {
    // input_data should be Uint8Array
    let input_size = input_data.length;

    if (input_size === 0) {
        throw new Error(`Error: Empty input file (input_size=${input_size})`);
    }

    if (skip >= input_size) {
        throw new Error(`Error: Skipping entire input file (skip=${skip}, input_size=${input_size})`);
    }

    // We need to copy input_data because we might reverse it in place?
    // C code: `if (backwards_mode) reverse(input_data, input_data+input_size-1);`
    // So yes, it modifies input_data.
    let input_buffer = new Uint8Array(input_data);

    if (backwards_mode) {
        reverse(input_buffer, 0, input_size - 1);
    }

    let output_size_ref = { value: 0 };
    let delta_ref = { value: 0 };

    let optimal = optimize(input_buffer, input_size, skip, quick_mode ? MAX_OFFSET_ZX7 : MAX_OFFSET_ZX0);
    let output_data = compress(optimal, input_buffer, input_size, skip, backwards_mode ? 1 : 0, (!classic_mode && !backwards_mode) ? 1 : 0, output_size_ref, delta_ref);

    if (backwards_mode) {
        reverse(output_data, 0, output_size_ref.value - 1);
    }

    // The C code writes `output_size` bytes.
    // We should return a subarray of the correct size.
    return {
        output: output_data.slice(0, output_size_ref.value),
        delta: delta_ref.value
    };
}
