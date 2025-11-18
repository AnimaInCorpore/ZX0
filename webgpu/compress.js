const INITIAL_OFFSET = 1;
const FALSE = 0;
const TRUE = 1;

let output_data;
let output_index;
let input_index;
let bit_index;
let bit_mask;
let diff;
let backtrack;

function read_bytes(n, deltaRef) {
    input_index += n;
    diff += n;
    if (deltaRef.value < diff)
        deltaRef.value = diff;
}

function write_byte(value) {
    output_data[output_index++] = value;
    diff--;
}

function write_bit(value) {
    if (backtrack) {
        if (value)
            output_data[output_index - 1] |= 1;
        backtrack = FALSE;
    } else {
        if (!bit_mask) {
            bit_mask = 128;
            bit_index = output_index;
            write_byte(0);
        }
        if (value)
            output_data[bit_index] |= bit_mask;
        bit_mask >>= 1;
    }
}

function write_interlaced_elias_gamma(value, backwards_mode, invert_mode) {
    let i;
    for (i = 2; i <= value; i <<= 1)
        ;
    i >>= 1;
    while (i >>= 1) {
        write_bit(backwards_mode);
        write_bit(invert_mode ? ((value & i) === 0 ? 1 : 0) : ((value & i) !== 0 ? 1 : 0));
    }
    write_bit(!backwards_mode ? 1 : 0);
}

export function compress(optimal, input_data, input_size, skip, backwards_mode, invert_mode, output_size_ref, delta_ref) {
    let prev;
    let next;
    let last_offset = INITIAL_OFFSET;
    let length;
    let i;

    // calculate and allocate output buffer
    // optimal.bits is in bits, we need bytes. +25 is safety margin?
    output_size_ref.value = Math.floor((optimal.bits + 25) / 8);
    output_data = new Uint8Array(output_size_ref.value);

    // un-reverse optimal sequence
    prev = null;
    while (optimal) {
        next = optimal.chain;
        optimal.chain = prev;
        prev = optimal;
        optimal = next;
    }

    // initialize data
    diff = output_size_ref.value - input_size + skip;
    delta_ref.value = 0;
    input_index = skip;
    output_index = 0;
    bit_mask = 0;
    backtrack = TRUE;

    // generate output
    for (optimal = prev.chain; optimal; prev = optimal, optimal = optimal.chain) {
        length = optimal.index - prev.index;

        if (!optimal.offset) {
            // copy literals indicator
            write_bit(0);

            // copy literals length
            write_interlaced_elias_gamma(length, backwards_mode, FALSE);

            // copy literals values
            for (i = 0; i < length; i++) {
                write_byte(input_data[input_index]);
                read_bytes(1, delta_ref);
            }
        } else if (optimal.offset === last_offset) {
            // copy from last offset indicator
            write_bit(0);

            // copy from last offset length
            write_interlaced_elias_gamma(length, backwards_mode, FALSE);
            read_bytes(length, delta_ref);
        } else {
            // copy from new offset indicator
            write_bit(1);

            // copy from new offset MSB
            write_interlaced_elias_gamma(Math.floor((optimal.offset - 1) / 128) + 1, backwards_mode, invert_mode);

            // copy from new offset LSB
            if (backwards_mode)
                write_byte(((optimal.offset - 1) % 128) << 1);
            else
                write_byte((127 - (optimal.offset - 1) % 128) << 1);

            // copy from new offset length
            backtrack = TRUE;
            write_interlaced_elias_gamma(length - 1, backwards_mode, FALSE);
            read_bytes(length, delta_ref);

            last_offset = optimal.offset;
        }
    }

    // end marker
    write_bit(1);
    write_interlaced_elias_gamma(256, backwards_mode, invert_mode);

    return output_data;
}
