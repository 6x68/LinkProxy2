import crypto from "node:crypto";
import { Vector3 } from "three";
import type Client from "./client.js";
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
	readonly rotation = new Rotation();
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
	};
	readonly socketId: string;

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
		this.socketId = client.id;
		this.physics = new PhysicsPlayer(world, pos);
		this.physics.yaw = rotation.yaw;
		this.checkData.lastAuthoritativePos.copy(pos);
	}
}
