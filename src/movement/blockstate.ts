import type Block from "./block.js";

export interface BlockState {
	getProp(name: string): number;
	block: Block;
}
