import crypto from "node:crypto";
import { Vector3 } from "three";
import type Client from "./client.js";
import { PhysicsPlayer } from "./movement/move.js";
import { World } from "./movement/world.js";
import Inventory from "./inventory.js";

const world = new World();
let nextEid = 0;

export default class Player {
	entityId = nextEid++;
	uuid = crypto.randomUUID();
	health = 20;
	heldSlot = 0;
	physics: PhysicsPlayer;
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
		predictedNextPos: null as Vector3 | null,
		lastSequenceNumber: NaN,
		prevSprinting: false,
	};
	readonly socketId: string;

	constructor(
		public client: Client,
		public name: string,
		public gamemode: string,
		pos: Vector3,
		public rank?: string,
		public permissionLevel = 0,
		public inventory = new Inventory(),
	) {
		this.socketId = client.id;
		this.physics = new PhysicsPlayer(world, pos);
		this.checkData.lastAuthoritativePos.copy(pos);
	}
}
