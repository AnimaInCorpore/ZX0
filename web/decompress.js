const FALSE = 0;
const TRUE = 1;
const INITIAL_OFFSET = 1;
const INITIAL_OUTPUT_SIZE = 16384; // 16KB initial size

let input_data;
let input_index;
let input_size;
let bit_mask;
let bit_value;
let backtrack;
let last_byte;
let output_buffer;
let output_index;
let output_allocated;

function read_byte() {
    if (input_index >= input_size) {
        throw new Error("Error: Truncated input file");
    }
    last_byte = input_data[input_index++];
    return last_byte;
}

function read_bit() {
    if (backtrack) {
        backtrack = FALSE;
        return last_byte & 1;
    }
    bit_mask >>= 1;
    if (bit_mask === 0) {
        bit_mask = 128;
        bit_value = read_byte();
    }
    return (bit_value & bit_mask) ? 1 : 0;
}

function read_interlaced_elias_gamma(inverted, backwards_mode) {
    let value = 1;
    while (read_bit() === (backwards_mode ? 1 : 0)) {
        value = (value << 1) | read_bit() ^ inverted;
    }
    return value;
}

function write_byte(value) {
    if (output_index >= output_allocated) {
        const new_output_buffer = new Uint8Array(output_allocated *= 2);
        new_output_buffer.set(output_buffer);
        output_buffer = new_output_buffer;
    }
    output_buffer[output_index++] = value;
}

function write_bytes(offset, length) {
    if (offset > output_index) {
        throw new Error("Error: Invalid data in input file");
    }
    while (length-- > 0) {
        write_byte(output_buffer[output_index - offset]);
    }
}

export function decompress(input_buffer, classic_mode = false, backwards_mode = false) {
    input_data = input_buffer;
    input_size = input_buffer.length;
    input_index = 0;

    output_allocated = INITIAL_OUTPUT_SIZE;
    output_buffer = new Uint8Array(output_allocated);
    output_index = 0;
    bit_mask = 0;
    backtrack = FALSE;

    let last_offset = INITIAL_OFFSET;
    let length;
    let i;

    while (true) {
        // COPY_LITERALS
        length = read_interlaced_elias_gamma(FALSE, backwards_mode);
        for (i = 0; i < length; i++)
            write_byte(read_byte());

        if (read_bit()) {
            // goto COPY_FROM_NEW_OFFSET
        } else {
            // Fallthrough to COPY_FROM_LAST_OFFSET

            // COPY_FROM_LAST_OFFSET
            length = read_interlaced_elias_gamma(FALSE, backwards_mode);
            write_bytes(last_offset, length);
            if (!read_bit()) {
                // goto COPY_LITERALS (continue loop)
                continue;
            }
            // Fallthrough to COPY_FROM_NEW_OFFSET
        }

        // COPY_FROM_NEW_OFFSET
        while (true) {
            last_offset = read_interlaced_elias_gamma((!classic_mode && !backwards_mode) ? 1 : 0, backwards_mode);
            if (last_offset === 256) {
                return output_buffer.slice(0, output_index);
            }
            let lsb = read_byte();
            if (backwards_mode) {
                last_offset = last_offset * 128 + (lsb >> 1) - 127;
            } else {
                last_offset = last_offset * 128 - (lsb >> 1);
            }
            backtrack = TRUE;
            length = read_interlaced_elias_gamma(FALSE, backwards_mode) + 1;
            write_bytes(last_offset, length);
            if (read_bit()) {
                // goto COPY_FROM_NEW_OFFSET (continue inner loop)
                continue;
            } else {
                // goto COPY_LITERALS (break inner loop, continue outer loop)
                break;
            }
        }
    }
}