
const FALSE = 0;
const TRUE = 1;
const INITIAL_OFFSET = 1;

let input_data;
let input_index;
let input_size;
let bit_mask;
let bit_value;
let backtrack;
let last_byte;
let output_index;

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

function read_interlaced_elias_gamma(inverted) {
    let value = 1;
    while (!read_bit()) {
        value = (value << 1) | read_bit() ^ inverted;
    }
    return value;
}

function write_byte(value, output_buffer) {
    output_buffer.push(value);
    output_index++;
}

function write_bytes(offset, length, output_buffer) {
    if (offset > output_buffer.length) {
        throw new Error("Error: Invalid data in input file");
    }
    while (length-- > 0) {
        let i = output_buffer.length - offset;
        write_byte(output_buffer[i], output_buffer);
    }
}

export function decompress(input_buffer, classic_mode = false) {
    input_data = input_buffer;
    input_size = input_buffer.length;
    input_index = 0;

    let output_buffer = [];
    output_index = 0;
    bit_mask = 0;
    backtrack = FALSE;

    let last_offset = INITIAL_OFFSET;
    let length;
    let i;

    while (true) {
        // COPY_LITERALS
        length = read_interlaced_elias_gamma(FALSE);
        for (i = 0; i < length; i++)
            write_byte(read_byte(), output_buffer);

        if (read_bit()) {
            // goto COPY_FROM_NEW_OFFSET
        } else {
            // Fallthrough to COPY_FROM_LAST_OFFSET

            // COPY_FROM_LAST_OFFSET
            length = read_interlaced_elias_gamma(FALSE);
            write_bytes(last_offset, length, output_buffer);
            if (!read_bit()) {
                // goto COPY_LITERALS (continue loop)
                continue;
            }
            // Fallthrough to COPY_FROM_NEW_OFFSET
        }

        // COPY_FROM_NEW_OFFSET
        while (true) {
            last_offset = read_interlaced_elias_gamma(!classic_mode ? 1 : 0);
            if (last_offset === 256) {
                return new Uint8Array(output_buffer);
            }
            let lsb = read_byte();
            last_offset = last_offset * 128 - (lsb >> 1);
            backtrack = TRUE;
            length = read_interlaced_elias_gamma(FALSE) + 1;
            write_bytes(last_offset, length, output_buffer);
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
