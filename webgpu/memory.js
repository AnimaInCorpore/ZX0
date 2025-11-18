
const QTY_BLOCKS = 10000;

let ghost_root = null;
let dead_array = []; // We can use a simple array as a stack

export class Block {
    constructor() {
        this.chain = null;
        this.ghost_chain = null;
        this.bits = 0;
        this.index = 0;
        this.offset = 0;
        this.references = 0;
    }
}

export function allocate(bits, index, offset, chain) {
    let ptr;

    if (ghost_root) {
        ptr = ghost_root;
        ghost_root = ptr.ghost_chain;
        if (ptr.chain && --ptr.chain.references === 0) {
            ptr.chain.ghost_chain = ghost_root;
            ghost_root = ptr.chain;
        }
    } else {
        // In C: if (!dead_array_size) allocate chunk...
        // In JS: just new Block()
        ptr = new Block();
    }
    ptr.bits = bits;
    ptr.index = index;
    ptr.offset = offset;
    if (chain)
        chain.references++;
    ptr.chain = chain;
    ptr.references = 0;
    return ptr;
}

export function assign(array, index, chain) {
    chain.references++;
    if (array[index] && --array[index].references === 0) {
        array[index].ghost_chain = ghost_root;
        ghost_root = array[index];
    }
    array[index] = chain;
}
