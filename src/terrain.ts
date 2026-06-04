import { CPacketChunkData, PBCell } from "../gen/protocol3_pb.js";

// Helper to pack a cell into 4-bit entries
export function createCell(yBase: number, blockIds: number[]): PBCell {
	const palette = [0];
	for (const id of blockIds) {
		if (id !== 0 && !palette.includes(id)) {
			palette.push(id);
		}
	}

	const bitsPerEntry = 4;
	const bitArray = new Uint8Array(2048);
	let blockRefCount = 0;

	for (let u = 0; u < 4096; u++) {
		const blockId = blockIds[u] ?? 0;
		if (blockId !== 0) {
			blockRefCount++;
		}
		const paletteIndex = palette.indexOf(blockId);

		const longIndex = Math.floor(u / 16);
		const slotIndex = u % 16;
		const byteIndex = longIndex * 8 + Math.floor(slotIndex / 2);

		if (slotIndex % 2 === 0) {
			bitArray[byteIndex] =
				// biome-ignore lint/style/noNonNullAssertion: no
				(bitArray[byteIndex]! & 0xf0) | (paletteIndex & 0x0f);
		} else {
			bitArray[byteIndex] =
				// biome-ignore lint/style/noNonNullAssertion: no
				(bitArray[byteIndex]! & 0x0f) | ((paletteIndex & 0x0f) << 4);
		}
	}

	return new PBCell({
		y: yBase,
		bitsPerEntry,
		palette,
		blockRefCount,
		bitArray,
	});
}

// Helper to generate a flat chunk column (Bedrock at bottom, Stone, Dirt, and Grass Block on top)
export function createFlatChunk(
	chunkX: number,
	chunkZ: number,
): CPacketChunkData {
	const cells: PBCell[] = [];

	// Cell 0: Y=0..15 (Bedrock at Y=0..2, Stone at Y=3..15)
	const cell0Blocks = new Array(4096).fill(0);
	for (let y = 0; y < 16; y++) {
		const blockId = y <= 2 ? 33 : 1; // 33: Bedrock, 1: Stone
		for (let z = 0; z < 16; z++) {
			for (let x = 0; x < 16; x++) {
				const idx = (y << 8) | (z << 4) | x;
				cell0Blocks[idx] = blockId;
			}
		}
	}
	cells.push(createCell(0, cell0Blocks));

	// Cell 1: Y=16..31 (All Stone)
	const cell1Blocks = new Array(4096).fill(1); // 1: Stone
	cells.push(createCell(16, cell1Blocks));

	// Cell 2: Y=32..47 (All Stone)
	const cell2Blocks = new Array(4096).fill(1); // 1: Stone
	cells.push(createCell(32, cell2Blocks));

	// Cell 3: Y=48..63 (All Dirt)
	const cell3Blocks = new Array(4096).fill(10); // 10: Dirt
	cells.push(createCell(48, cell3Blocks));

	// Cell 4: Y=64..79 (Grass Block at Y=64, Air above)
	const cell4Blocks = new Array(4096).fill(0);
	for (let z = 0; z < 16; z++) {
		for (let x = 0; x < 16; x++) {
			const idx = (0 << 8) | (z << 4) | x; // local y = 0 (global Y = 64)
			cell4Blocks[idx] = 8; // 8: Grass Block
		}
	}
	cells.push(createCell(64, cell4Blocks));

	return new CPacketChunkData({
		x: chunkX,
		z: chunkZ,
		cells,
		tileEntities: [],
		dimension: 0,
		biomes: new Array(256).fill(1), // Default biome ID
	});
}
