export class Block {
    constructor(bits, index, offset, chain) {
        this.bits = bits;
        this.index = index;
        this.offset = offset;
        this.chain = chain;
    }
}

export function allocate(bits, index, offset, chain) {
    return new Block(bits, index, offset, chain);
}

export function assign(array, index, chain) {
    array[index] = chain;
}