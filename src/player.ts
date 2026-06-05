import crypto from "node:crypto";
import { Vector3 } from "three";
import type Client from "./client.js";
import { PhysicsPlayer } from "./movement/move.js";
import { World } from "./movement/world.js";

const world = new World();
let nextEid = 0;

export default class Player {
	entityId = nextEid++;
	uuid = crypto.randomUUID();
	health = 20;
	heldSlot = 0;
	physics: PhysicsPlayer;

	constructor(
		public client: Client,
		public name: string,
		public gamemode: string,
		pos: Vector3,
		public rank?: string,
		public permissionLevel = 0,
	) {
		this.physics = new PhysicsPlayer(world, pos);
	}
}
