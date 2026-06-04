import Block from "./block.js";
import type { Material } from "./materials/material.js";
import Materials from "./materials/registry.js";

export class BlockLiquid extends Block {
	constructor(name: string, material: Material) {
		super(name, material, 0.6);
		this.type = "liquid";
		// I(this, "isReplaceable", true);
		this.material = material;
	}
	static getLiquidHeightPercent(n: number) {
		if (n >= 8) {
			n = 0;
		}
		return (n + 1) / 9;
	}
}

export class BlockLiquidLava extends BlockLiquid {
	constructor() {
		super("lava", Materials.lava);
	}
}

export class BlockLadder extends Block {
	constructor(name = "ladder") {
		super(name, Materials.solidTransparent);
	}
	getItemTexture() {
		return this.name;
	}
	isFullCube(_: unknown) {
		return false;
	}
}

export class BlockAir extends Block {
	constructor() {
		super("air", Materials.air, 0.6);
	}
	override isAir(): boolean {
		return true;
	}
}

export default {
	lava: new BlockLiquidLava(),
	ladder: new BlockLadder(),
	air: new BlockAir(),
	stone: new Block("stone", Materials.rock, 0.6),
	grass: new Block("grass", Materials.grass, 0.6),
	dirt: new Block("dirt", Materials.ground, 0.6),
	bedrock: new Block("bedrock", Materials.rock, 0.6),
};
