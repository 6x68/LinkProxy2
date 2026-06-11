import { Vector3 } from "three";
import BlockPos from "./BlockPos.js";
import type { BlockState } from "./blockstate.js";
import { PhysicsWorld } from "./move.js";

export enum EnumFacing {
	DOWN = 0,
	UP = 1,
	NORTH = 2,
	SOUTH = 3,
	WEST = 4,
	EAST = 5,
}

export enum TypeOfHit {
	MISS = 0,
	BLOCK = 1,
	ENTITY = 2,
}

export class RayTraceResult {
	constructor(
		public typeOfHit: TypeOfHit,
		public hitVec: Vector3,
		public block: BlockPos | null,
		public side: EnumFacing,
		public entity?: unknown,
	) {}
}

interface BlockLike {
	isAir(): boolean;
	canCollideCheck(state: BlockState, stopOnLiquid: boolean): boolean;
	getCollisionBoundingBox(
		state: BlockState,
		world?: PhysicsWorld,
		pos?: BlockPos,
	): import("three").Box3 | null;
	collisionRayTrace(
		world: PhysicsWorld,
		pos: BlockPos,
		start: Vector3,
		end: Vector3,
	): RayTraceResult | null;
}

export function rayTraceBlocks(
	start: Vector3,
	end: Vector3,
	stopOnLiquid: boolean,
	ignoreBlockWithoutBoundingBox: boolean,
	returnLastOnMiss: boolean,
	world: PhysicsWorld,
): RayTraceResult | null {
	if (
		isNaN(start.x) ||
		isNaN(start.y) ||
		isNaN(start.z) ||
		isNaN(end.x) ||
		isNaN(end.y) ||
		isNaN(end.z)
	) {
		return null;
	}

	const endX = Math.floor(end.x);
	const endY = Math.floor(end.y);
	const endZ = Math.floor(end.z);

	let posX = Math.floor(start.x);
	let posY = Math.floor(start.y);
	let posZ = Math.floor(start.z);

	let currentPos = new BlockPos(posX, posY, posZ);
	const startState = world.getBlockState(currentPos);
	const startBlock: BlockLike = startState.block;

	if (
		(!ignoreBlockWithoutBoundingBox ||
			startBlock.getCollisionBoundingBox(startState, world, currentPos) !=
				null) &&
		startBlock.canCollideCheck(startState, stopOnLiquid)
	) {
		const result = startBlock.collisionRayTrace(world, currentPos, start, end);
		if (result != null) return result;
	}

	let lastMiss: RayTraceResult | null = null;

	for (let i = 200; i >= 0; i--) {
		if (isNaN(start.x) || isNaN(start.y) || isNaN(start.z)) return null;

		if (posX === endX && posY === endY && posZ === endZ) {
			return returnLastOnMiss ? lastMiss : null;
		}

		let xAxis = true,
			yAxis = true,
			zAxis = true;
		let xDist = 999,
			yDist = 999,
			zDist = 999;

		if (endX > posX) xDist = posX + 1;
		else if (endX < posX) xDist = posX + 0;
		else xAxis = false;

		if (endY > posY) yDist = posY + 1;
		else if (endY < posY) yDist = posY + 0;
		else yAxis = false;

		if (endZ > posZ) zDist = posZ + 1;
		else if (endZ < posZ) zDist = posZ + 0;
		else zAxis = false;

		let tX = 999,
			tY = 999,
			tZ = 999;
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const dz = end.z - start.z;

		if (xAxis) tX = (xDist - start.x) / dx;
		if (yAxis) tY = (yDist - start.y) / dy;
		if (zAxis) tZ = (zDist - start.z) / dz;

		if (tX === 0) tX = -1e-4;
		if (tY === 0) tY = -1e-4;
		if (tZ === 0) tZ = -1e-4;

		let facing: EnumFacing;

		if (tX < tY && tX < tZ) {
			facing = endX > posX ? EnumFacing.WEST : EnumFacing.EAST;
			start = new Vector3(xDist, start.y + dy * tX, start.z + dz * tX);
		} else if (tY < tZ) {
			facing = endY > posY ? EnumFacing.DOWN : EnumFacing.UP;
			start = new Vector3(start.x + dx * tY, yDist, start.z + dz * tY);
		} else {
			facing = endZ > posZ ? EnumFacing.NORTH : EnumFacing.SOUTH;
			start = new Vector3(start.x + dx * tZ, start.y + dy * tZ, zDist);
		}

		posX = Math.floor(start.x) - (facing === EnumFacing.EAST ? 1 : 0);
		posY = Math.floor(start.y) - (facing === EnumFacing.UP ? 1 : 0);
		posZ = Math.floor(start.z) - (facing === EnumFacing.SOUTH ? 1 : 0);

		currentPos = new BlockPos(posX, posY, posZ);
		const state = world.getBlockState(currentPos);
		const block: BlockLike = state.block;

		if (
			!ignoreBlockWithoutBoundingBox ||
			block.getCollisionBoundingBox(state, world, currentPos) != null
		) {
			if (block.canCollideCheck(state, stopOnLiquid)) {
				const hit = block.collisionRayTrace(world, currentPos, start, end);
				if (hit != null) {
					hit.side = facing;
					return hit;
				}
			} else {
				lastMiss = new RayTraceResult(
					TypeOfHit.MISS,
					start,
					currentPos,
					facing,
					null,
				);
			}
		}
	}

	return returnLastOnMiss ? lastMiss : null;
}

export interface PlayerLike {
	getEyePos(): Vector3;
	getLook(): Vector3;
}

export function playerBlockRayTrace(
	player: PlayerLike,
	world: PhysicsWorld,
	reach: number,
	stopOnLiquid = false,
): RayTraceResult | null {
	const eyePos = player.getEyePos();
	const look = player.getLook();
	const end = eyePos.clone().add(look.clone().multiplyScalar(reach));
	return rayTraceBlocks(eyePos, end, stopOnLiquid, false, false, world);
}
