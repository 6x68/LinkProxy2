import { Box3, Vector3 } from "three";
import BlockPos from "./BlockPos.js";
import type Block from "./block.js";
import Blocks from "./blocks.js";
import type { BlockState } from "./blockstate.js";
import type { PhysicsPlayer, PhysicsWorld } from "./move.js";

const CHUNK_SIZE = 16;
const WORLD_HEIGHT = 256;

function getBlockAABB(x: number, y: number, z: number): Box3 {
	return new Box3(new Vector3(x, y, z), new Vector3(x + 1, y + 1, z + 1));
}

function getChunkKey(cx: number, cz: number): string {
	return `${cx},${cz}`;
}

const BLOCK_BY_ID: Record<number, Block> = {
	0: Blocks.air,
	1: Blocks.stone,
	8: Blocks.grass,
	10: Blocks.dirt,
	33: Blocks.bedrock,
};

function getBlockById(id: number): Block {
	return BLOCK_BY_ID[id] ?? Blocks.air;
}

export class World implements PhysicsWorld {
	private chunks = new Map<string, Uint8Array>();

	constructor() {
		for (let cx = -2; cx <= 2; cx++) {
			for (let cz = -2; cz <= 2; cz++) {
				this.ensureChunkExists(cx, cz);
			}
		}
	}

	private ensureChunkExists(cx: number, cz: number): Uint8Array {
		const key = getChunkKey(cx, cz);
		let chunk = this.chunks.get(key);
		if (!chunk) {
			chunk = this.generateFlatChunk();
			this.chunks.set(key, chunk);
		}
		return chunk;
	}

	private generateFlatChunk(): Uint8Array {
		const size = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE;
		const data = new Uint8Array(size);
		for (let y = 0; y < WORLD_HEIGHT; y++) {
			for (let z = 0; z < CHUNK_SIZE; z++) {
				for (let x = 0; x < CHUNK_SIZE; x++) {
					const idx = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
					let blockId = 0;
					if (y <= 2) blockId = 33;
					else if (y <= 47) blockId = 1;
					else if (y <= 63) blockId = 10;
					else if (y === 64) blockId = 8;
					data[idx] = blockId;
				}
			}
		}
		return data;
	}

	getBlockId(x: number, y: number, z: number): number {
		if (y < 0 || y >= WORLD_HEIGHT) return 0;
		const cx = Math.floor(x / CHUNK_SIZE);
		const cz = Math.floor(z / CHUNK_SIZE);
		const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
		const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
		const chunk = this.ensureChunkExists(cx, cz);
		const idx =
			Math.floor(y) * CHUNK_SIZE * CHUNK_SIZE +
			Math.floor(lz) * CHUNK_SIZE +
			Math.floor(lx);
		return chunk[idx] ?? 0;
	}

	getCollidingBoundingBoxes(_entity: PhysicsPlayer, box: Box3): Box3[] {
		const boxes: Box3[] = [];
		const minX = Math.floor(box.min.x);
		const maxX = Math.floor(box.max.x);
		const minY = Math.floor(box.min.y);
		const maxY = Math.floor(box.max.y);
		const minZ = Math.floor(box.min.z);
		const maxZ = Math.floor(box.max.z);

		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				for (let z = minZ; z <= maxZ; z++) {
					const block = this.getBlockState(x, y, z).block;
					if (block.material.blocksMovement()) {
						boxes.push(getBlockAABB(x, y, z));
					}
				}
			}
		}
		return boxes;
	}

	getBlockState(pos: BlockPos): BlockState;
	getBlockState(x: number, y: number, z: number): BlockState;
	getBlockState(xOrPos: BlockPos | number, y?: number, z?: number): BlockState {
		let bx: number, by: number, bz: number;
		if (xOrPos instanceof BlockPos) {
			bx = xOrPos.x;
			by = xOrPos.y;
			bz = xOrPos.z;
		} else {
			bx = xOrPos;
			by = y!;
			bz = z!;
		}

		const blockId = this.getBlockId(bx, by, bz);
		const block = getBlockById(blockId);
		return {
			block,
			getProp(_name: string): number {
				return 0;
			},
		};
	}

	setBlock(x: number, y: number, z: number, blockId: number): void {
		if (y < 0 || y >= WORLD_HEIGHT) return;
		const cx = Math.floor(x / CHUNK_SIZE);
		const cz = Math.floor(z / CHUNK_SIZE);
		const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
		const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
		const chunk = this.ensureChunkExists(cx, cz);
		const idx = Math.floor(y) * CHUNK_SIZE * CHUNK_SIZE + Math.floor(lz) * CHUNK_SIZE + Math.floor(lx);
		chunk[idx] = blockId;
	}

	isLadder(_x: number, _y: number, _z: number): boolean {
		return false;
	}

	isIronLadder(_x: number, _y: number, _z: number): boolean {
		return false;
	}
}
