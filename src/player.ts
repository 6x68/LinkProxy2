import crypto from "node:crypto";
import { Vector3 } from "three";
import type Client from "./client.js";
import {
	CPacketPlayerPosLook,
	type SPacketPlaceBlock,
} from "../gen/protocol2_pb.js";
import { PhysicsPlayer } from "./movement/move.js";
import { World } from "./movement/world.js";
import Inventory from "./inventory.js";
import Rotation from "./rotation.js";

let nextEid = 0;

export default class Player {
	readonly entityId = nextEid++;
	readonly uuid = crypto.randomUUID();
	health = 20;
	heldSlot = 0;
	readonly physics: PhysicsPlayer;
	readonly #rotation = new Rotation();
	readonly lastRotation = this.#rotation;
	get rotation() {
		return this.#rotation;
	}
	updateLastRotation() {
		this.lastRotation.copy(this.#rotation);
	}
	set rotation(rotation: Rotation) {
		this.lastRotation.copy(this.#rotation);
		this.#rotation.copy(rotation);
	}
	setRotation(yaw: number, pitch: number) {
		this.updateLastRotation();
		this.#rotation.set(yaw, pitch);
	}
	checkData = {
		hadInput: false,
		hadPos: false,
		/**
		 * When first joining, the client only sends Pos packets. It sends 3 pos packets, and starts sending Input packets.
		 * We need this exempt because we check for.
		 * Exempt order: Pos -> Pos -> Pos -> (done with the initial packets)
		 * Normal order: Pos -> Input
		 */
		inputOrderExempt: 4, // extra leniency, 3 seems to kinda work but kick me sometimes
		lastAuthoritativePos: new Vector3(),
		/**
		 * Use this for i.e. raytrace checks. The player raytraces based on their client position, not the position the server wants them to be next tick!
		 */
		lastClientPos: new Vector3(),
		predictedNextPos: null as Vector3 | null,
		lastSequenceNumber: NaN,
		prevSprinting: false,
		teleportTarget: null as Vector3 | null,
		pendingPlacement: null as {
			payload: SPacketPlaceBlock;
			bx: number;
			by: number;
			bz: number;
		} | null,
	};
	readonly socketId: string;

	resetSequenceAndPosition(): void {
		this.checkData.lastSequenceNumber = NaN;
		this.checkData.predictedNextPos = null;
		this.checkData.hadInput = false;
		this.checkData.hadPos = false;
		this.checkData.teleportTarget = null;
	}

	teleport(vec: Vector3, yaw: number, pitch: number) {
		this.resetSequenceAndPosition();
		const { x, y, z } = vec;
		this.checkData.teleportTarget = vec.clone();
		this.checkData.lastAuthoritativePos.copy(vec);
		this.setRotation(yaw, pitch);
		this.client.send(
			new CPacketPlayerPosLook({
				yaw,
				pitch,
				x,
				y,
				z,
			}),
		);
		this.checkData.inputOrderExempt = 1; // the player will send a Pos packet first
	}

	constructor(
		public readonly client: Client,
		public readonly name: string,
		public gamemode: string,
		pos: Vector3,
		rotation: Rotation,
		public readonly world: World,
		public rank?: string,
		public permissionLevel = 0,
		public readonly inventory = new Inventory(),
	) {
		this.lastRotation.copy(rotation);
		this.socketId = client.id;
		this.physics = new PhysicsPlayer(world, pos);
		this.physics.yaw = rotation.yaw;
		this.checkData.lastAuthoritativePos.copy(pos);
	}
}
