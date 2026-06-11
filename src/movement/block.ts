import { Box3, Vector3 } from "three";
import BlockPos from "./BlockPos.js";
import type { Material } from "./materials/material.js";
import type { PhysicsPlayer, PhysicsWorld } from "./move.js";
import { EnumFacing, RayTraceResult, TypeOfHit } from "./raytrace.js";

function getIntermediateWithXValue(
	start: Vector3,
	end: Vector3,
	x: number,
): Vector3 | null {
	const dx = end.x - start.x;
	if (dx * dx < 1.0000000116860974e-7) return null;
	const t = (x - start.x) / dx;
	return t >= 0 && t <= 1
		? new Vector3(start.x + dx * t, start.y + (end.y - start.y) * t, start.z + (end.z - start.z) * t)
		: null;
}

function getIntermediateWithYValue(
	start: Vector3,
	end: Vector3,
	y: number,
): Vector3 | null {
	const dy = end.y - start.y;
	if (dy * dy < 1.0000000116860974e-7) return null;
	const t = (y - start.y) / dy;
	return t >= 0 && t <= 1
		? new Vector3(start.x + (end.x - start.x) * t, start.y + dy * t, start.z + (end.z - start.z) * t)
		: null;
}

function getIntermediateWithZValue(
	start: Vector3,
	end: Vector3,
	z: number,
): Vector3 | null {
	const dz = end.z - start.z;
	if (dz * dz < 1.0000000116860974e-7) return null;
	const t = (z - start.z) / dz;
	return t >= 0 && t <= 1
		? new Vector3(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t, start.z + dz * t)
		: null;
}

function isVecInYZ(box: Box3, vec: Vector3 | null): vec is Vector3 {
	return vec != null && vec.y >= box.min.y && vec.y <= box.max.y && vec.z >= box.min.z && vec.z <= box.max.z;
}

function isVecInXZ(box: Box3, vec: Vector3 | null): vec is Vector3 {
	return vec != null && vec.x >= box.min.x && vec.x <= box.max.x && vec.z >= box.min.z && vec.z <= box.max.z;
}

function isVecInXY(box: Box3, vec: Vector3 | null): vec is Vector3 {
	return vec != null && vec.x >= box.min.x && vec.x <= box.max.x && vec.y >= box.min.y && vec.y <= box.max.y;
}

export function calculateIntercept(
	box: Box3,
	start: Vector3,
	end: Vector3,
): RayTraceResult | null {
	let p = getIntermediateWithXValue(start, end, box.min.x);
	let g = getIntermediateWithXValue(start, end, box.max.x);
	let y = getIntermediateWithYValue(start, end, box.min.y);
	let x = getIntermediateWithYValue(start, end, box.max.y);
	let S = getIntermediateWithZValue(start, end, box.min.z);
	let b = getIntermediateWithZValue(start, end, box.max.z);

	if (!isVecInYZ(box, p)) p = null;
	if (!isVecInYZ(box, g)) g = null;
	if (!isVecInXZ(box, y)) y = null;
	if (!isVecInXZ(box, x)) x = null;
	if (!isVecInXY(box, S)) S = null;
	if (!isVecInXY(box, b)) b = null;

	let v: Vector3 | null = null;
	if (p != null) v = p;
	if (g != null && (v == null || start.distanceToSquared(g) < start.distanceToSquared(v))) v = g;
	if (y != null && (v == null || start.distanceToSquared(y) < start.distanceToSquared(v))) v = y;
	if (x != null && (v == null || start.distanceToSquared(x) < start.distanceToSquared(v))) v = x;
	if (S != null && (v == null || start.distanceToSquared(S) < start.distanceToSquared(v))) v = S;
	if (b != null && (v == null || start.distanceToSquared(b) < start.distanceToSquared(v))) v = b;
	if (v == null) return null;

	let side: EnumFacing;
	if (p && v.equals(p)) side = EnumFacing.WEST;
	else if (g && v.equals(g)) side = EnumFacing.EAST;
	else if (y && v.equals(y)) side = EnumFacing.DOWN;
	else if (x && v.equals(x)) side = EnumFacing.UP;
	else if (S && v.equals(S)) side = EnumFacing.NORTH;
	else side = EnumFacing.SOUTH;

	return new RayTraceResult(TypeOfHit.BLOCK, v, BlockPos.ORIGIN, side, null);
}

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

	canCollideCheck(_state: { block: Block }, _stopOnLiquid: boolean): boolean {
		return !this.isAir();
	}

	getCollisionBoundingBox(
		_state: { block: Block },
		_world?: PhysicsWorld,
		_pos?: BlockPos,
	): Box3 | null {
		if (this.isAir()) return null;
		return new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
	}

	collisionRayTrace(
		world: PhysicsWorld,
		pos: BlockPos,
		start: Vector3,
		end: Vector3,
	): RayTraceResult | null {
		const localStart = start.clone().sub(new Vector3(pos.x, pos.y, pos.z));
		const localEnd = end.clone().sub(new Vector3(pos.x, pos.y, pos.z));

		const box = this.getCollisionBoundingBox(
			{ block: this },
			world,
			pos,
		);
		if (!box) return null;

		const { min, max } = box;

		let xMin = getIntermediateWithXValue(localStart, localEnd, min.x);
		let xMax = getIntermediateWithXValue(localStart, localEnd, max.x);
		let yMin = getIntermediateWithYValue(localStart, localEnd, min.y);
		let yMax = getIntermediateWithYValue(localStart, localEnd, max.y);
		let zMin = getIntermediateWithZValue(localStart, localEnd, min.z);
		let zMax = getIntermediateWithZValue(localStart, localEnd, max.z);

		if (
			xMin &&
			(xMin.y < min.y || xMin.y > max.y || xMin.z < min.z || xMin.z > max.z)
		)
			xMin = null;
		if (
			xMax &&
			(xMax.y < min.y || xMax.y > max.y || xMax.z < min.z || xMax.z > max.z)
		)
			xMax = null;
		if (
			yMin &&
			(yMin.x < min.x || yMin.x > max.x || yMin.z < min.z || yMin.z > max.z)
		)
			yMin = null;
		if (
			yMax &&
			(yMax.x < min.x || yMax.x > max.x || yMax.z < min.z || yMax.z > max.z)
		)
			yMax = null;
		if (
			zMin &&
			(zMin.x < min.x || zMin.x > max.x || zMin.y < min.y || zMin.y > max.y)
		)
			zMin = null;
		if (
			zMax &&
			(zMax.x < min.x || zMax.x > max.x || zMax.y < min.y || zMax.y > max.y)
		)
			zMax = null;

		let closest: Vector3 | null = null;
		if (xMin && (closest === null || localStart.distanceToSquared(xMin) < localStart.distanceToSquared(closest)))
			closest = xMin;
		if (xMax && (closest === null || localStart.distanceToSquared(xMax) < localStart.distanceToSquared(closest)))
			closest = xMax;
		if (yMin && (closest === null || localStart.distanceToSquared(yMin) < localStart.distanceToSquared(closest)))
			closest = yMin;
		if (yMax && (closest === null || localStart.distanceToSquared(yMax) < localStart.distanceToSquared(closest)))
			closest = yMax;
		if (zMin && (closest === null || localStart.distanceToSquared(zMin) < localStart.distanceToSquared(closest)))
			closest = zMin;
		if (zMax && (closest === null || localStart.distanceToSquared(zMax) < localStart.distanceToSquared(closest)))
			closest = zMax;

		if (closest === null) return null;

		let side: EnumFacing;

		if (xMin && closest.equals(xMin)) side = EnumFacing.WEST;
		else if (xMax && closest.equals(xMax)) side = EnumFacing.EAST;
		else if (yMin && closest.equals(yMin)) side = EnumFacing.DOWN;
		else if (yMax && closest.equals(yMax)) side = EnumFacing.UP;
		else if (zMin && closest.equals(zMin)) side = EnumFacing.NORTH;
		else if (zMax && closest.equals(zMax)) side = EnumFacing.SOUTH;
		else return null;

		const worldHit = closest.clone().add(new Vector3(pos.x, pos.y, pos.z));
		return new RayTraceResult(TypeOfHit.BLOCK, worldHit, pos, side, null);
	}

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
