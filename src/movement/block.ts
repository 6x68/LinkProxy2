import type { Vector3 } from "three";
import type BlockPos from "./BlockPos.js";
import type { Material } from "./materials/material.js";
import type { PhysicsPlayer, PhysicsWorld } from "./move.js";

export default class Block {
	modifyAcceleration(
		world: PhysicsWorld,
		pos: BlockPos,
		plr: PhysicsPlayer,
		k: Vector3,
	): import("three").Vector3 {
		throw new Error("Method not implemented.");
	}
	onFallenUpon(
		// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
		world: PhysicsWorld,
		// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
		pos: BlockPos,
		// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
		entity: PhysicsPlayer,
		// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
		fallDistance: number,
	): void {}
	onEntityCollidedWithBlock(
		// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
		world: PhysicsWorld,
		// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
		x: BlockPos,
		// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
		entity: PhysicsPlayer,
	): void {}
	isAir(): boolean {
		return false;
	}
	type = "default";
	constructor(
		public name: string,
		public material: Material,
		public slipperiness = 0.6,
	) {}

	// biome-ignore lint/correctness/noUnusedFunctionParameters: overridable method
	onLanded(world: PhysicsWorld, entity: PhysicsPlayer): void {
		entity.motion.y = 0;
	}

	equals(other: Block): boolean {
		return this.name === other.name;
	}
}
