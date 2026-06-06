import { Box3, Vector3 } from "three";
import BlockPos from "./BlockPos.js";
import type Block from "./block.js";
import Blocks from "./blocks.js";
import type { BlockState } from "./blockstate.js";
import handleMaterialAcceleration from "./materials/acceleration.js";
import Materials from "./materials/registry.js";
import {
	AttributeInstance,
	AttributeModifier,
	AttributeOperation,
} from "./attributes.js";

export interface PhysicsWorld {
	getCollidingBoundingBoxes(entity: PhysicsPlayer, box: Box3): Box3[];
	getBlockState(x: BlockPos): BlockState;
	getBlockState(x: number, y: number, z: number): BlockState;
	isLadder(x: number, y: number, z: number): boolean;
	isIronLadder(x: number, y: number, z: number): boolean;
	setBlock(x: number, y: number, z: number, blockId: number): void;
}

function calculateXOffset(m: Box3, u: Box3, h: number): number {
	if (
		u.max.y > m.min.y &&
		u.min.y < m.max.y &&
		u.max.z > m.min.z &&
		u.min.z < m.max.z
	) {
		if (h > 0 && u.max.x <= m.min.x) {
			const p = m.min.x - u.max.x;
			if (p < h) h = p;
		} else if (h < 0 && u.min.x >= m.max.x) {
			const p = m.max.x - u.min.x;
			if (p > h) h = p;
		}
	}
	return h;
}

function calculateYOffset(m: Box3, u: Box3, h: number): number {
	if (
		u.max.x > m.min.x &&
		u.min.x < m.max.x &&
		u.max.z > m.min.z &&
		u.min.z < m.max.z
	) {
		if (h > 0 && u.max.y <= m.min.y) {
			const p = m.min.y - u.max.y;
			if (p < h) h = p;
		} else if (h < 0 && u.min.y >= m.max.y) {
			const p = m.max.y - u.min.y;
			if (p > h) h = p;
		}
	}
	return h;
}

function calculateZOffset(m: Box3, u: Box3, h: number): number {
	if (
		u.max.x > m.min.x &&
		u.min.x < m.max.x &&
		u.max.y > m.min.y &&
		u.min.y < m.max.y
	) {
		if (h > 0 && u.max.z <= m.min.z) {
			const p = m.min.z - u.max.z;
			if (p < h) h = p;
		} else if (h < 0 && u.min.z >= m.max.z) {
			const p = m.max.z - u.min.z;
			if (p > h) h = p;
		}
	}
	return h;
}

function addCoord(box: Box3, x: number, y: number, z: number): Box3 {
	let minX = box.min.x;
	let minY = box.min.y;
	let minZ = box.min.z;
	let maxX = box.max.x;
	let maxY = box.max.y;
	let maxZ = box.max.z;

	if (x < 0) minX += x;
	else if (x > 0) maxX += x;

	if (y < 0) minY += y;
	else if (y > 0) maxY += y;

	if (z < 0) minZ += z;
	else if (z > 0) maxZ += z;

	return new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

export class PhysicsPlayer {
	readonly world: PhysicsWorld;

	pos = new Vector3();
	motion = new Vector3();

	yaw = 0;

	moveForward = 0;
	moveStrafe = 0;

	sprinting = false;
	jumping = false;

	onGround = false;

	isCollided = false;
	isCollidedHorizontally = false;
	isCollidedVertically = false;

	jumpTicks = 0;

	movementSpeed = 0.1;
	speedInAir = 0.02;
	stepHeight = 0.6;
	initialJumpVelocity = 0.42;

	boundingBox: Box3;
	sneak = false;
	inCloud = false;
	inWeb = false;
	noPhysics = false;
	ridingEntity = null;
	distanceWalkedModified = 0;
	distanceWalkedOnStepModified = 0;
	nextStepDistance = 0;
	inWater = false;
	fallDistance = 0;
	inLava = false;
	readonly movementSpeedAttribute = new AttributeInstance(0.1);
	static readonly SPRINT_MODIFIER = new AttributeModifier(
		"sprint",
		"Sprinting speed boost",
		0.3,
		AttributeOperation.MULTIPLY_TOTAL,
	);
	readonly abilities = {
		isFlying: false,
	};

	constructor(world: PhysicsWorld, pos = new Vector3()) {
		this.world = world;
		this.pos.copy(pos);

		this.boundingBox = new Box3(
			new Vector3(pos.x - 0.3, pos.y, pos.z - 0.3),
			new Vector3(pos.x + 0.3, pos.y + 1.8, pos.z + 0.3),
		);
	}

	sleeping = false;

	isPlayerSleeping() {
		return this.sleeping;
	}

	get eyeHeight() {
		let eyeHeight = 1.62;
		if (this.isPlayerSleeping()) eyeHeight = 0.2;
		if (this.sneak) eyeHeight -= 0.8;
		return eyeHeight;
	}

	isSprinting(): boolean {
		return this.sprinting;
	}

	setSprinting(value: boolean): void {
		if (value === this.sprinting) {
			return;
		}

		this.sprinting = value;

		const attr = this.movementSpeedAttribute;

		attr.removeModifier("sprint");

		if (value) {
			attr.applyModifier(PhysicsPlayer.SPRINT_MODIFIER);
		}
	}

	getJumpMovementFactor(): number {
		return this.sprinting ? this.speedInAir * 1.3 : this.speedInAir;
	}

	getAIMoveSpeed(): number {
		return this.movementSpeedAttribute.getAttributeValue();
	}

	getEntityBoundingBox(): Box3 {
		return this.boundingBox;
	}

	setEntityBoundingBox(box: Box3): void {
		this.boundingBox = box;
	}

	offsetBBox(offset: Vector3): Box3 {
		return this.boundingBox.clone().translate(offset);
	}

	resetPositionToBB(): void {
		this.pos.set(
			(this.boundingBox.min.x + this.boundingBox.max.x) * 0.5,
			this.boundingBox.min.y,
			(this.boundingBox.min.z + this.boundingBox.max.z) * 0.5,
		);
	}

	isOnLadder(): boolean {
		return this.world.isLadder(this.pos.x, this.boundingBox.min.y, this.pos.z);
	}

	getLadderSpeed(): number {
		return this.world.isIronLadder(
			this.pos.x,
			this.boundingBox.min.y,
			this.pos.z,
		)
			? 0.3
			: 0.2;
	}

	// onLivingUpdate() {
	// 	if (this.jumpTicks > 0) {
	// 		--this.jumpTicks;
	// 	}
	// 	if (Math.abs(this.motion.x) < 0.005) {
	// 		this.motion.x = 0;
	// 	}
	// 	if (Math.abs(this.motion.y) < 0.005) {
	// 		this.motion.y = 0;
	// 	}
	// 	if (Math.abs(this.motion.z) < 0.005) {
	// 		this.motion.z = 0;
	// 	}
	// 	if (this.isMovementBlocked()) {
	// 		this.jumping = false;
	// 		this.moveStrafe = 0;
	// 		this.moveForward = 0;
	// 	}
	// 	if (this.jumping) {
	// 		if (this.inWater) {
	// 			this.motion.y += 0.05;
	// 		} else if (this.inLava) {
	// 			this.motion.y += 0.05;
	// 		} else if (this.onGround && this.jumpTicks === 0) {
	// 			this.jump();
	// 			this.jumpTicks = 10;
	// 		}
	// 	} else {
	// 		this.jumpTicks = 0;
	// 	}
	// 	this.moveStrafe *= 0.98;
	// 	this.moveForward *= 0.98;
	// 	this.moveEntityWithHeading(this.moveStrafe, this.moveForward);
	// }

	health = 20;

	isMovementBlocked(): boolean {
		return this.health <= 0;
	}

	moveFlying(strafe: number, forward: number, accel: number): void {
		let length = strafe * strafe + forward * forward;

		if (length >= 0.0001) {
			length = Math.sqrt(length);

			if (length < 1) length = 1;

			length = accel / length;

			strafe *= length;
			forward *= length;

			const cos = Math.cos(this.yaw);
			const sin = -Math.sin(this.yaw);

			this.motion.x += strafe * cos - forward * sin;
			this.motion.z += forward * cos + strafe * sin;
		}
	}

	jump(): void {
		this.motion.y = this.initialJumpVelocity;

		if (this.sprinting) {
			this.motion.x -= Math.sin(this.yaw) * 0.2;
			this.motion.z -= Math.cos(this.yaw) * 0.2;
		}
	}

	testStepUp(box: Box3, prevPosThing: Vector3, pos: Vector3) {
		const g = pos.clone();
		const y = this.getEntityBoundingBox();
		this.setEntityBoundingBox(box);
		pos.y = this.stepHeight;
		const x = this.world.getCollidingBoundingBoxes(
			this,
			addCoord(
				this.getEntityBoundingBox(),
				prevPosThing.x,
				pos.y,
				prevPosThing.z,
			),
		);
		let S = this.getEntityBoundingBox();
		const b = addCoord(S, prevPosThing.x, 0, prevPosThing.z);
		let v = pos.y;
		for (const D of x) {
			v = calculateYOffset(D, b, v);
		}
		S = S.clone().translate(new Vector3(0, v, 0));
		let w = prevPosThing.x;
		for (const D of x) {
			w = calculateXOffset(D, S, w);
		}
		S = S.clone().translate(new Vector3(w, 0, 0));
		let k = prevPosThing.z;
		for (const D of x) {
			k = calculateZOffset(D, S, k);
		}
		S = S.clone().translate(new Vector3(0, 0, k));
		let E = this.getEntityBoundingBox();
		let T = pos.y;
		for (const D of x) {
			T = calculateYOffset(D, E, T);
		}
		E = E.clone().translate(new Vector3(0, T, 0));
		let C = prevPosThing.x;
		for (const D of x) {
			C = calculateXOffset(D, E, C);
		}
		E = E.clone().translate(new Vector3(C, 0, 0));
		let A = prevPosThing.z;
		for (const D of x) {
			A = calculateZOffset(D, E, A);
		}
		E = E.clone().translate(new Vector3(0, 0, A));
		const R = w * w + k * k;
		const L = C * C + A * A;
		if (R > L) {
			pos.x = w;
			pos.z = k;
			pos.y = -v;
			this.setEntityBoundingBox(S);
		} else {
			pos.x = C;
			pos.z = A;
			pos.y = -T;
			this.setEntityBoundingBox(E);
		}
		for (const D of x) {
			pos.y = calculateYOffset(D, this.getEntityBoundingBox(), pos.y);
		}
		this.setEntityBoundingBox(this.offsetBBox(new Vector3(0, pos.y, 0)));
		if (g.x * g.x + g.z * g.z >= pos.x * pos.x + pos.z * pos.z) {
			pos.x = g.x;
			pos.y = g.y;
			pos.z = g.z;
			this.setEntityBoundingBox(y);
			return false;
		} else {
			return true;
		}
	}
	testSneaking(vec: Vector3, vec2: Vector3) {
		const p = 0.05;
		const g = -0.999999;
		for (
			;
			vec2.x !== 0 &&
			this.world.getCollidingBoundingBoxes(
				this,
				this.offsetBBox(new Vector3(vec2.x, g, 0)),
			).length === 0;
			vec.x = vec2.x
		) {
			if (vec2.x < p && vec2.x >= -p) {
				vec2.x = 0;
			} else if (vec2.x > 0) {
				vec2.x -= p;
			} else {
				vec2.x += p;
			}
		}
		for (
			;
			vec2.z !== 0 &&
			this.world.getCollidingBoundingBoxes(
				this,
				this.offsetBBox(new Vector3(0, g, vec2.z)),
			).length === 0;
			vec.z = vec2.z
		) {
			if (vec2.z < p && vec2.z >= -p) {
				vec2.z = 0;
			} else if (vec2.z > 0) {
				vec2.z -= p;
			} else {
				vec2.z += p;
			}
		}
		for (
			;
			vec2.x !== 0 &&
			vec2.z !== 0 &&
			this.world.getCollidingBoundingBoxes(
				this,
				this.offsetBBox(new Vector3(vec2.x, g, vec2.z)),
			).length === 0;
			vec.z = vec2.z
		) {
			if (vec2.x < p && vec2.x >= -p) {
				vec2.x = 0;
			} else if (vec2.x > 0) {
				vec2.x -= p;
			} else {
				vec2.x += p;
			}
			vec.x = vec2.x;
			if (vec2.z < p && vec2.z >= -p) {
				vec2.z = 0;
			} else if (vec2.z > 0) {
				vec2.z -= p;
			} else {
				vec2.z += p;
			}
		}
	}
	doBlockCollisions() {
		const min = new BlockPos(
				this.getEntityBoundingBox().min.x + 0.001,
				this.getEntityBoundingBox().min.y + 0.001,
				this.getEntityBoundingBox().min.z + 0.001,
			),
			max = new BlockPos(
				this.getEntityBoundingBox().max.x - 0.001,
				this.getEntityBoundingBox().max.y - 0.001,
				this.getEntityBoundingBox().max.z - 0.001,
			);
		for (let p = min.x; p <= max.x; ++p)
			for (let g = min.y; g <= max.y; ++g)
				for (let y = min.z; y <= max.z; ++y) {
					const x = new BlockPos(p, g, y);
					this.world
						.getBlockState(x)
						.block.onEntityCollidedWithBlock(this.world, x, this);
				}
	}

	moveEntity(pX: number, pY: number, pZ: number) {
		if (!Number.isFinite(pX) || !Number.isFinite(pY) || !Number.isFinite(pZ)) {
			console.error("Invalid move params", pX, pY, pZ);
			return;
		}
		if (this.noPhysics) {
			this.setEntityBoundingBox(
				this.getEntityBoundingBox().translate(this.motion),
			);
			this.resetPositionToBB();
			return;
		}
		const posVec = new Vector3(pX, pY, pZ);
		const pvClone = this.pos.clone();
		if (this.inWeb) {
			this.inWeb = false;
			posVec.x *= 0.25;
			posVec.y *= 0.05;
			posVec.z *= 0.25;
			this.motion.x = 0;
			this.motion.y = 0;
			this.motion.z = 0;
		}
		if (this.inCloud) {
			this.inCloud = false;
			posVec.x *= 0.25;
			posVec.y *= 0.25;
			posVec.z *= 0.25;
		}
		const x = posVec.clone();
		const S = this.onGround && this.sneak;
		if (S) {
			this.testSneaking(x, posVec);
		}
		const b = this.getEntityBoundingBox();
		const v = this.world.getCollidingBoundingBoxes(
			this,
			addCoord(b, posVec.x, posVec.y, posVec.z),
		);
		for (const A of v) {
			posVec.y = calculateYOffset(A, this.getEntityBoundingBox(), posVec.y);
		}
		this.setEntityBoundingBox(this.offsetBBox(new Vector3(0, posVec.y, 0)));
		const w = this.onGround || (x.y !== posVec.y && x.y < 0);
		for (const A of v) {
			posVec.x = calculateXOffset(A, this.getEntityBoundingBox(), posVec.x);
		}
		this.setEntityBoundingBox(this.offsetBBox(new Vector3(posVec.x, 0, 0)));
		for (const A of v) {
			posVec.z = calculateZOffset(A, this.getEntityBoundingBox(), posVec.z);
		}
		this.setEntityBoundingBox(this.offsetBBox(new Vector3(0, 0, posVec.z)));
		const k = /*this instanceof EntityPlayer ? w : true*/ w;
		if (this.stepHeight > 0 && k && (x.x !== posVec.x || x.z !== posVec.z)) {
			this.testStepUp(b, x, posVec);
		}
		this.resetPositionToBB();
		this.isCollidedHorizontally = posVec.x !== x.x || posVec.z !== x.z;
		this.isCollidedVertically = posVec.y !== x.y;
		this.onGround = this.isCollidedVertically && x.y < 0;
		this.isCollided = this.isCollidedHorizontally || this.isCollidedVertically;
		let E = new BlockPos(this.pos.x, this.pos.y - 0.2, this.pos.z);
		let T = this.world.getBlockState(E).block;
		if (T.isAir()) {
			const A = this.world.getBlockState(E.down()).block;
			if (A.name === "fence") {
				T = A;
				E = E.down();
			}
		}
		this.updateFallState(posVec.y, this.onGround, T, E);
		// if (this instanceof EntityPlayer) {
		if (posVec.x !== x.x) {
			this.motion.x = 0;
		}
		if (posVec.z !== x.z) {
			this.motion.z = 0;
		}
		// }
		if (posVec.y !== x.y) {
			T.onLanded(this.world, this);
		}
		if (this.canTriggerWalking() && !S && this.ridingEntity == null) {
			const A = this.pos.clone().sub(pvClone);
			if (!T.equals(Blocks.ladder)) {
				A.y = 0;
			}
			if (T != null && this.onGround) {
				T.onEntityCollidedWithBlock(this.world, E, this);
			}
			this.distanceWalkedModified =
				this.distanceWalkedModified + Math.sqrt(A.x * A.x + A.z * A.z) * 0.6;
			this.distanceWalkedOnStepModified =
				this.distanceWalkedOnStepModified +
				Math.sqrt(A.x * A.x + A.y * A.y + A.z * A.z) * 0.6;
			if (
				this.distanceWalkedOnStepModified > this.nextStepDistance &&
				!T.isAir()
			) {
				this.nextStepDistance =
					Math.floor(this.distanceWalkedOnStepModified) + 1;
				if (this.inWater) {
					let L =
						Math.sqrt(
							this.motion.x * this.motion.x * 0.2 +
								this.motion.y * this.motion.y +
								this.motion.z * this.motion.z * 0.2,
						) * 0.3;
					if (L > 1) {
						L = 1;
					}
					if (Math.random() > 0.95) {
						this.playSound(
							"game.neutral.swim",
							L,
							1 + (Math.random() - Math.random()) * 0.1,
						);
					}
				}
			}
		}
		this.doBlockCollisions();
	}
	updateFallState(
		y: number,
		onGround: boolean,
		block: Block | null,
		pos: BlockPos,
	): void {
		if (!this.inWater) {
			this.handleWaterMovement();
		}
		if (onGround && this.fallDistance > 0) {
			if (this.fallDistance > 0) {
				if (block != null) {
					block.onFallenUpon(this.world, pos, this, this.fallDistance);
				}
				this.fallDistance = 0;
			}
		} else if (y < 0) {
			this.fallDistance = this.fallDistance - y;
		}
	}
	handleWaterMovement() {
		return handleMaterialAcceleration(
			this.getEntityBoundingBox(),
			Materials.water,
			this,
		);
	}
	canTriggerWalking(): boolean {
		return true;
	}
	playSound(_: string, __: number, ___: number) {}
	moveEntityWithHeading(strafe: number, forward: number): void {
		let friction = 0.91;

		if (this.onGround) {
			const slipperiness = this.world.getBlockState(
				Math.floor(this.pos.x),
				Math.floor(this.boundingBox.min.y) - 1,
				Math.floor(this.pos.z),
			).block.slipperiness;
			friction = slipperiness * 0.91;
		}

		const accel = this.onGround
			? this.getAIMoveSpeed() * (0.16277136 / (friction * friction * friction))
			: this.getJumpMovementFactor();

		this.moveFlying(strafe, forward, accel);

		friction = 0.91;

		if (this.onGround) {
			friction =
				this.world.getBlockState(
					Math.floor(this.pos.x),
					Math.floor(this.boundingBox.min.y) - 1,
					Math.floor(this.pos.z),
				).block.slipperiness * 0.91;
		}

		if (this.isOnLadder()) {
			this.motion.x = Math.max(-0.15, Math.min(0.15, this.motion.x));
			this.motion.z = Math.max(-0.15, Math.min(0.15, this.motion.z));

			if (this.motion.y < -0.15) {
				this.motion.y = -0.15;
			}

			if (this.sneak && this.motion.y < 0) {
				this.motion.y = 0;
			}
		}

		this.moveEntity(this.motion.x, this.motion.y, this.motion.z);

		if (this.isCollidedHorizontally && this.isOnLadder()) {
			this.motion.y = this.getLadderSpeed();
		}

		if (!this.abilities.isFlying) {
			this.motion.y -= 0.08;
		}
		this.motion.y *= 0.98;

		this.motion.x *= friction;
		this.motion.z *= friction;
	}

	tick(): void {
		if (this.jumpTicks > 0) {
			--this.jumpTicks;
		}

		if (Math.abs(this.motion.x) < 0.005) this.motion.x = 0;
		if (Math.abs(this.motion.y) < 0.005) this.motion.y = 0;
		if (Math.abs(this.motion.z) < 0.005) this.motion.z = 0;

		if (this.jumping) {
			if (this.onGround && this.jumpTicks === 0) {
				this.jump();
				this.jumpTicks = 10;
			}
		} else {
			this.jumpTicks = 0;
		}

		this.moveStrafe *= 0.98;
		this.moveForward *= 0.98;
		this.moveEntityWithHeading(this.moveStrafe, this.moveForward);
	}
}
