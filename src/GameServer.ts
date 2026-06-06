import { Box3, Vector3 } from "three";
import { type Socket } from "engine.io";
import {
	CPacketBlockUpdate,
	CPacketDestroyEntities,
	CPacketEntityPositionAndRotation,
	CPacketEntityProperties,
	CPacketEntityRelativePositionAndRotation,
	CPacketJoinGame,
	CPacketMessage,
	CPacketPlayerList,
	CPacketPlayerPosLook,
	CPacketPlayerReconciliation,
	CPacketPong,
	CPacketSpawnPlayer,
	CPacketTimeUpdate,
	CPacketUpdateStatus,
	PBCosmetics,
	PBFloatVector3,
	PBSnapshot,
	PBVector3,
	PlayerData,
	SPacketBreakBlock,
	SPacketEntityAction,
	SPacketHeldItemChange,
	SPacketLoginStart,
	SPacketPlaceBlock,
	SPacketPlayerAbilities,
	SPacketPlayerPosLook,
	type SPacketMessage,
	type SPacketPlayerInput,
	SPacketUseEntity,
	SPacketRespawn,
	SPacketUpdateInventory,
	SPacketClickWindow,
	CPacketUpdateHealth,
	CPacketEntityVelocity,
	CPacketEntityStatus,
	CPacketAnimation,
	CPacketSoundEffect,
	CPacketRespawn,
} from "../gen/protocol2_pb.js";
import { SPacketUseEntity_Action } from "../gen/common_pb.js";
import Client from "./client.js";
import Player from "./player.js";
import { World } from "./movement/world.js";
import { ID_TO_NAME, type SPACKET_MAP } from "./protocol/index.js";
import { createFlatChunk } from "./terrain.js";
import { simulate } from "./movement/index.js";
import { PhysicsPlayer } from "./movement/move.js";
import Rotation from "./rotation.js";
import {
	DirectionString,
	EnumFacing,
	fromProto,
	fromProtoString,
	opposite,
	playerBlockRayTrace,
} from "./movement/raytrace.js";
import { World } from "./movement/world.js";

const FACE_OFFSET: Record<string, [number, number, number]> = {
	DOWN: [0, 1, 0],
	UP: [0, 0, -1],
	NORTH: [0, 0, 1],
	SOUTH: [-1, 0, 0],
	WEST: [1, 0, 0],
	UNDEFINED_FACE: [0, -1, 0],
};

export default class GameServer {
	private players = new Map<string, Player>();
	// note: Miniblox has 2 dimensions (overworld and nether), I'm ignoring the nether since... Why? Whatever.
	private world = new World();
	private nextEntityId = 0;

	addClient(socket: Socket): void {
		const cl = new Client(socket);

		cl.on("data", (d) => this.handleData(cl, socket, d));
		cl.on("close", () => this.handleDisconnect(socket));
	}

	private getSid(socket: Socket): string {
		return (socket as unknown as { id: string }).id;
	}

	private getPlayer(socket: Socket): Player | undefined {
		return this.players.get(this.getSid(socket));
	}

	private handleData(cl: Client, socket: Socket, d: unknown): void {
		if (this.tryHandshake(cl, socket, d)) return;

		const arr =
			d && typeof d === "object"
				? ((d as Record<string, unknown>).data ??
					(d as Record<string, unknown>).d)
				: null;
		if (!Array.isArray(arr)) {
			console.log("[Server] Unknown data:", d);
			return;
		}

		const id = arr[0] as number;
		const payload = arr[1];
		const name = ID_TO_NAME[id] as keyof typeof SPACKET_MAP | undefined;
		if (!name) return;

		if (name !== "SPacketPlayerInput" && name !== "SPacketPlayerPosLook" && name !== "SPacketPing") {
			console.log(`[Server] Packet received: ${name}`, JSON.stringify(payload));
		}

		switch (name) {
			case "SPacketLoginStart":
				return this.handleLogin(cl, payload);
			case "SPacketRequestChunk":
				return this.handleChunk(cl, payload);
			case "SPacketPing":
				return this.handlePing(cl, payload);
			case "SPacketPlayerInput":
				return this.handleInput(cl, payload);
			case "SPacketPlayerPosLook":
				return this.handlePosLook(cl, payload);
			case "SPacketPlaceBlock":
				return this.handlePlace(socket, payload);
			case "SPacketBreakBlock":
				return this.handleBreak(socket, payload);
			case "SPacketPlayerAbilities": {
				const player = this.getPlayer(socket);
				if (!player) return;
				const pl = payload as SPacketPlayerAbilities;
				if (player.gamemode !== "creative" && pl.isFlying) {
					cl.disconnect(
						"Sent player abilities packet with isFlying while not in creative mode"
					);
					player.physics.abilities.isFlying = false;
					return;
				}
				player.physics.abilities.isFlying = !!pl.isFlying;
				return;
			}
			case "SPacketClick":
				break; // TODO
			case "SPacketEntityAction": {
				const player = this.getPlayer(socket);
				if (!player) return;
				const pl = payload as SPacketEntityAction;
				if (pl.id !== player.entityId) {
					console.warn(
						`[Server] SPacketEntityAction ID mismatch: client sent ${pl.id}, server expects ${player.entityId}. (Non-fatal warning, bypass kick)`
					);
				}
				return;
			}
			case "SPacketHeldItemChange":
				return this.handleHeld(socket, payload);
			case "SPacketMessage":
				return this.handleMessage(socket, payload);
			case "SPacketUseEntity":
				return this.handleUseEntity(socket, payload);
			case "SPacketRespawn":
				return this.handleRespawn(socket);
			case "SPacketUpdateInventory":
				return this.handleUpdateInventory(socket, payload);
			case "SPacketClickWindow":
				return this.handleClickWindow(socket, payload);
		}

		const ignored = new Set([
			"SPacketAnalytics",
			"SPacketCraftItem",
			"SPacketEnchantItem",
			"SPacketOpenShop",
			"SPacketQueueNext",
		]);
		if (!ignored.has(name)) {
			console.warn("[Server] Unhandled:", name, payload);
		}
	}

	private tryHandshake(cl: Client, socket: Socket, d: unknown): boolean {
		if (
			typeof d === "object" &&
			d !== null &&
			"t" in d &&
			"d" in d &&
			(d as Record<string, unknown>).t === 0 &&
			(d as Record<string, unknown>).d === null
		) {
			cl.send({ sid: cl.id, pid: null }, { packetType: 0 });
			return true;
		}
		return false;
	}

	private handleLogin(cl: Client, _payload: SPacketLoginStart): void {
		const eid = this.nextEntityId++;
		const player = new Player(
			cl,
			`Player${eid}`,
			"creative",
			new Vector3(0, 66, 0),
			new Rotation(),
			this.world,
		);
		this.players.set(player.socketId, player);

		console.log(`[Server] ${player.name} joined (eid=${player.entityId})`);

		cl.send(
			new CPacketJoinGame({
				canConnect: true,
				tick: 0,
				gamemode: player.gamemode,
				name: player.name,
				enablePlayerCollision: true,
				cosmetics: {
					skin: "bob",
					cape: "none",
					hat: "",
				},
				rank: "",
				serverInfo: {
					serverId: "local-1-1",
					serverName: "Local Server",
					serverVersion: "3.41.74",
					serverCategory: "planets",
					accessControl: "public",
					worldType: "VOID",
					doDaylightCycle: true,
					inviteCode: "LOCAL0",
					cheats: "admin-enabled",
					pvpEnabled: true,
					startTime: BigInt(Date.now()),
					playerPermissionEntries: this.players
						.values()
						.map((player) => ({
							uuid: player.uuid,
							username: player.name,
							permissionLevel: player.permissionLevel,
							rank: "",
							level: 3,
							verified: true,
						}))
						.toArray(),
					metadata: "{}",
					commandBlocksEnabled: true,
				},
				uuid: player.uuid,
				dimension: 0,
			}),
		);

		for (let cx = -2; cx <= 2; cx++)
			for (let cz = -2; cz <= 2; cz++) cl.send(createFlatChunk(cx, cz));

		cl.send(new CPacketTimeUpdate({ totalTime: 6000, worldTime: 6000 }));

		const sid = cl.id;

		for (const [existingSid, existing] of this.players) {
			cl.send(this.spawnPacket(existing, existingSid));
		}

		for (const [existingSid, existing] of this.players) {
			if (existingSid === sid) continue;
			existing.client.send(this.spawnPacket(player, sid));
		}

		this.broadcastPlayerList();

		cl.send(new CPacketPlayerPosLook({ x: 0, y: 65, z: 0, yaw: 0, pitch: 0 }));
	}

	private spawnPacket(p: Player, socketId: string): CPacketSpawnPlayer {
		return new CPacketSpawnPlayer({
			id: p.entityId,
			name: p.name,
			gamemode: p.gamemode,
			pos: new PBFloatVector3({
				x: p.physics.pos.x,
				y: p.physics.pos.y,
				z: p.physics.pos.z,
			}),
			operator: p.permissionLevel >= 200,
			rank: p.rank,
			yaw: p.rotation.yaw,
			pitch: p.rotation.pitch,
			cosmetics: new PBCosmetics({
				skin: "bob",
				cape: "none",
				hat: "",
			}),
			socketId,
		});
	}

	private handleChunk(cl: Client, payload: unknown): void {
		const p = (payload ?? {}) as Record<string, number>;
		cl.send(createFlatChunk(p.x ?? 0, p.z ?? 0));
	}

	private handlePing(cl: Client, payload: unknown): void {
		const p = payload as Record<string, unknown> | undefined;
		const time = p?.time ? BigInt(p.time as number) : 0n;
		cl.send(new CPacketPong({ time, mspt: 50, tick: 0 }));
	}

	private replicatePlayerPos(
		of: Player,
		state: {
			onGround: boolean;
			yaw: number;
			pitch: number;
			pos: Vector3;
			vel: Vector3;
		},
	) {
		for (const [existingSid, existing] of this.players) {
			if (existingSid === of.client.id) continue;
			// TODO: proper replication
			// it should send a relative entity movement packet
		}
	}

	private handleInput(cl: Client, payload: SPacketPlayerInput): void {
		const player = [...this.players.values()].find((p) => p.client === cl);
		if (!player) return;
		const { checkData } = player;
		if (!payload.sequenceNumber) {
			cl.disconnect("No sequence number in packet");
			return;
		}
		if (
			!Number.isNaN(checkData.lastSequenceNumber) &&
			payload.sequenceNumber <= checkData.lastSequenceNumber
		) {
			console.warn(
				`[Server] Sequence number went backwards or duplicated (client: ${payload.sequenceNumber}, server: ${checkData.lastSequenceNumber}). Resetting tracking.`
			);
		}
		checkData.lastSequenceNumber = payload.sequenceNumber;
		checkData.hadInput = true;
		if (!checkData.hadPos && checkData.inputOrderExempt <= 0) {
			console.warn(`[Server] Missing pos look before input packet for player ${player.name}. (Bypassing kick)`);
		}
		player.checkData.lastClientPos = new Vector3(
			payload.pos.x,
			payload.pos.y,
			payload.pos.z,
		);
		const yaw = payload.yaw ?? player.rotation.yaw;
		const pitch = payload.pitch ?? player.rotation.pitch;
		checkData.hadPos = false;
		const pl = payload;
		if (!pl.pos) return;
		player.rotation.yaw = yaw;
		player.rotation.pitch = pitch;
		if (player.physics.abilities.isFlying) {
			cl.send(
				new CPacketPlayerReconciliation({
					lastProcessedInput: payload.sequenceNumber,
					pitch,
					yaw,
					reset: false,
					x: pl.pos.x,
					y: pl.pos.y,
					z: pl.pos.z,
				}),
			);

			const pos = new Vector3(payload.pos.x, payload.pos.y, payload.pos.z);
			player.physics.pos.copy(pos);
			player.physics.boundingBox = new Box3(
				new Vector3(pos.x - 0.3, pos.y, pos.z - 0.3),
				new Vector3(pos.x + 0.3, pos.y + 1.8, pos.z + 0.3),
			);

			this.replicatePlayerPos(player, {
				onGround: false,
				pitch,
				pos,
				vel: new Vector3(),
				yaw,
			});
			return;
		}

		let reset = false;

		if (checkData.teleportTarget) {
			const clientPos = new Vector3(pl.pos.x!, pl.pos.y!, pl.pos.z!);
			const dist = clientPos.distanceTo(checkData.teleportTarget);
			if (dist > 0.1) {
				console.warn(
					`[Server] Teleport check failed: client sent pos (${clientPos.x}, ${clientPos.y}, ${clientPos.z}) but target was (${checkData.teleportTarget.x}, ${checkData.teleportTarget.y}, ${checkData.teleportTarget.z}) (dist: ${dist}). Resetting position.`
				);
				reset = true;
				pl.pos.x = checkData.teleportTarget.x;
				pl.pos.y = checkData.teleportTarget.y;
				pl.pos.z = checkData.teleportTarget.z;
			}
			checkData.teleportTarget = null;
		} else if (checkData.predictedNextPos) {
			const clientPos = new Vector3(
				payload.pos.x,
				payload.pos.y,
				payload.pos.z,
			);
			const ep = checkData.predictedNextPos;
			const dist = clientPos.distanceTo(ep);
			/*
				Doing so just adds latency,
				and it makes it worse anticheat wise since you have to add more latency compensation to see
				when the player actually got the move speed attribute update and then simulate properly.
			*/
			if (dist > 0.07) {
				console.info(`Server distance: ${dist}`);
				reset = true;
			}
		}

		player.physics.pos.set(pl.pos.x!, pl.pos.y!, pl.pos.z!);
		player.physics.boundingBox = new Box3(
			new Vector3(pl.pos.x! - 0.3, pl.pos.y!, pl.pos.z! - 0.3),
			new Vector3(pl.pos.x! + 0.3, pl.pos.y! + 1.8, pl.pos.z! + 0.3),
		);

		const nextPos = simulate(player.physics, pl);
		if (nextPos) {
			player.physics.pos.copy(nextPos);
			checkData.lastAuthoritativePos.copy(nextPos);
			checkData.predictedNextPos = nextPos.clone();
		}

		if (
			pl.sprint !== undefined &&
			pl.sprint !== checkData.prevSprinting
		) {
			checkData.prevSprinting = pl.sprint;
			cl.send(
				new CPacketEntityProperties({
					id: player.entityId,
					data: [
						new PBSnapshot({
							id: "generic.movementSpeed",
							value: player.physics.movementSpeedAttribute.getBaseValue(),
							modifiers: pl.sprint
								? ([PhysicsPlayer.SPRINT_MODIFIER.toProto()] as const)
								: [],
						}),
					],
				}),
			);
		}

		if (reset) {
			// if you get setback, your sequence number gets set to 0.
			checkData.lastSequenceNumber = -1;
		}
		const pos = new Vector3(
			nextPos?.x ?? checkData.lastAuthoritativePos.x,
			nextPos?.y ?? checkData.lastAuthoritativePos.y,
			nextPos?.z ?? checkData.lastAuthoritativePos.z,
		);

		this.replicatePlayerPos(player, {
			onGround: false,
			pitch,
			yaw,
			pos,
			vel: new Vector3(),
		});

		cl.send(
			new CPacketPlayerReconciliation({
				lastProcessedInput: payload.sequenceNumber,
				pitch,
				yaw,
				reset,
				x: pos.x,
				y: pos.y,
				z: pos.z,
			}),
		);

		// Broadcast new position and rotation to other players
		const finalPos = nextPos ?? checkData.lastAuthoritativePos;
		let encodedYaw = Math.floor(((pl.yaw ?? 0) / (Math.PI * 2)) * 256) % 256;
		if (encodedYaw < 0) encodedYaw += 256;
		let encodedPitch = Math.floor(((pl.pitch ?? 0) / (Math.PI * 2)) * 256) % 256;
		if (encodedPitch < 0) encodedPitch += 256;

		const movePacket = new CPacketEntityPositionAndRotation({
			id: player.entityId,
			pos: new PBVector3({
				x: Math.round(finalPos.x * 32),
				y: Math.round(finalPos.y * 32),
				z: Math.round(finalPos.z * 32),
			}),
			yaw: encodedYaw,
			pitch: encodedPitch,
			onGround: player.physics.onGround,
		});

		for (const p of this.players.values()) {
			if (p.client !== cl) {
				p.client.send(movePacket);
			}
		}
	}

	private handlePosLook(cl: Client, payload: SPacketPlayerPosLook): void {
		const player = [...this.players.values()].find((p) => p.client === cl);
		if (!player) return;
		const { checkData } = player;
		player.rotation.set(
			payload.yaw ?? player.rotation.yaw,
			payload.pitch ?? player.rotation.pitch,
		);
		if (checkData.inputOrderExempt > 0) {
			checkData.inputOrderExempt--;
		}
		if (!checkData.hadInput && checkData.inputOrderExempt <= 0) {
			console.warn(`[Server] Missing input packet before pos look packet for player ${player.name}. (Bypassing kick)`);
		}
		checkData.hadPos = true;
		checkData.hadInput = false;
		if (payload.pos)
			player.checkData.lastClientPos = new Vector3(
				payload.pos.x,
				payload.pos.y,
				payload.pos.z,
			);
	}

	private handlePlace(socket: Socket, payload: SPacketPlaceBlock): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		const posIn = payload.positionIn;
		if (!posIn) return;
		const side = payload.side;
		const NUM_OFFSET: [number, number, number][] = [
			[0, -1, 0], // client DOWN  (index 0)
			[0, 1, 0], // client UP    (index 1)
			[0, 0, -1], // client NORTH (index 2)
			[0, 0, 1], // client SOUTH (index 3)
			[-1, 0, 0], // client WEST  (index 4)
			[1, 0, 0], // client EAST  (index 5)
		];
		const off =
			typeof side === "string"
				? (FACE_OFFSET[side] ?? [0, 0, 0])
				: (NUM_OFFSET[side as number] ?? [0, 0, 0]);
		const bx = (posIn.x ?? 0) + off[0];
		const by = (posIn.y ?? 0) + off[1];
		const bz = (posIn.z ?? 0) + off[2];

		// Check if the block intersects with any connected player
		const blockBox = new Box3(
			new Vector3(bx, by, bz),
			new Vector3(bx + 1, by + 1, bz + 1)
		);
		let intersects = false;
    const bb = p.physics.boundingBox;
		for (const p of this.players.values()) {
			if (blockBox.intersectsBox(bb)) {
				intersects = true;
				break;
			}
		}

		if (intersects) {
      return cancel("block intersecting with a player");
		}

		// Get block ID from selected hotbar slot item
		const heldItem = player.inventory.items[player.heldSlot];
		console.log(`[Server] handlePlace: heldSlot=${player.heldSlot}, heldItem=${JSON.stringify(heldItem)}, totalItems=${player.inventory.items.length}`);
		const blockId = (heldItem && heldItem.present && heldItem.id !== undefined) ? heldItem.id : 1;

		player.physics.world.setBlock(bx, by, bz, blockId);
		const update = new CPacketBlockUpdate({ id: blockId, x: bx, y: by, z: bz });
		for (const p of this.players.values()) p.client.send(update);
	}

	private handleBreak(socket: Socket, payload: SPacketBreakBlock): void {
		const player = this.getPlayer(socket);
		const pkt = payload as {
			location?: { x?: number; y?: number; z?: number };
		};
		if (!pkt.location) return;
		const x = pkt.location.x ?? 0;
		const y = pkt.location.y ?? 0;
		const z = pkt.location.z ?? 0;

		if (player) player.physics.world.setBlock(x, y, z, 0);

		const update = new CPacketBlockUpdate({ id: 0, x, y, z });
		for (const p of this.players.values()) p.client.send(update);
	}

	private handleHeld(socket: Socket, payload: SPacketHeldItemChange): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		player.heldSlot = payload.slot ?? 0;
	}

	private handleUpdateInventory(socket: Socket, payload: unknown): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		console.log(`[Server] handleUpdateInventory: player=${player.name}, payload=${JSON.stringify(payload)}`);
		const pkt = payload as SPacketUpdateInventory;
		if (pkt.main) {
			player.inventory.items = pkt.main;
		}
	}

	private handleClickWindow(socket: Socket, payload: unknown): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		console.log(`[Server] handleClickWindow: player=${player.name}, payload=${JSON.stringify(payload)}`);
		const pkt = payload as SPacketClickWindow;
		const slotId = pkt.slotId;
		if (pkt.windowId === 0 && slotId !== undefined && slotId >= 4 && slotId < 40) {
			const invSlot = slotId - 4;
			if (pkt.itemStack) {
				player.inventory.items[invSlot] = pkt.itemStack;
				console.log(`[Server] handleClickWindow: updated slot ${invSlot} to item=${JSON.stringify(pkt.itemStack)}`);
			}
		}
	}

	private handleDisconnect(socket: Socket): void {
		const sid = this.getSid(socket);
		const player = this.players.get(sid);
		if (!player) return;
		console.log(`[Server] ${player.name} left`);

		this.players.delete(sid);

		const destroy = new CPacketDestroyEntities({ ids: [player.entityId] });
		for (const p of this.players.values()) p.client.send(destroy);

		this.broadcastPlayerList();
	}

	private broadcastPlayerList(): void {
		const data = new CPacketPlayerList({
			players: [...this.players.values()].map(
				(p) =>
					new PlayerData({
						id: p.entityId,
						name: p.name,
						uuid: p.uuid,
						ping: 0,
						permissionLevel: p.permissionLevel,
					}),
			),
		});
		for (const p of this.players.values()) p.client.send(data);
	}

	private handleMessage(socket: Socket, payload: unknown): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		const pl = payload as { text?: string };
		const text = pl.text ?? "";

		if (text.startsWith("/")) {
			const parts = text.slice(1).trim().split(/\s+/);
			const command = parts[0]?.toLowerCase();
			const args = parts.slice(1);

			if (command === "gamemode" || command === "gm") {
				const arg = args[0]?.toLowerCase();
				let mode: string | null = null;
				if (!arg) {
					// Toggle gamemode if no arguments are provided
					mode = player.gamemode === "creative" ? "survival" : "creative";
				} else if (arg === "survival" || arg === "s" || arg === "0") {
					mode = "survival";
				} else if (arg === "creative" || arg === "c" || arg === "1") {
					mode = "creative";
				}

				if (mode) {
					player.gamemode = mode;
					player.physics.abilities.isFlying = false;
					this.resetSequenceAndPosition(player);

					// Broadcast status update to all players
					const updateStatus = new CPacketUpdateStatus({
						id: player.entityId,
						mode: mode,
					});
					for (const p of this.players.values()) {
						p.client.send(updateStatus);
					}

					// Send confirmation message to sender
					player.client.send(
						new CPacketMessage({
							text: `\\green\\Gamemode set to ${mode}\\reset\\`,
						})
					);
				} else {
					player.client.send(
						new CPacketMessage({
							text: `\\red\\Usage: /gamemode <survival|creative>\\reset\\`,
						})
					);
				}
			} else if (command === "tp" || command === "teleport") {
				if (args.length === 3) {
					const x = parseFloat(args[0] || "");
					const y = parseFloat(args[1] || "");
					const z = parseFloat(args[2] || "");
					if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
						player.physics.pos.set(x, y, z);
						player.checkData.lastAuthoritativePos.set(x, y, z);
						this.resetSequenceAndPosition(player);
						player.checkData.teleportTarget = player.physics.pos.clone();
						player.client.send(new CPacketPlayerPosLook({ x, y, z, yaw: 0, pitch: 0 }));
						player.client.send(new CPacketMessage({ text: `\\green\\Teleported to ${x}, ${y}, ${z}\\reset\\` }));
					} else {
						player.client.send(new CPacketMessage({ text: `\\red\\Invalid coordinates!\\reset\\` }));
					}
				} else if (args.length === 1) {
					const targetName = (args[0] || "").toLowerCase();
					const target = [...this.players.values()].find(p => p.name.toLowerCase() === targetName);
					if (target) {
						const pos = target.physics.pos;
						player.physics.pos.copy(pos);
						player.checkData.lastAuthoritativePos.copy(pos);
						this.resetSequenceAndPosition(player);
						player.checkData.teleportTarget = player.physics.pos.clone();
						player.client.send(new CPacketPlayerPosLook({ x: pos.x, y: pos.y, z: pos.z, yaw: 0, pitch: 0 }));
						player.client.send(new CPacketMessage({ text: `\\green\\Teleported to ${target.name}\\reset\\` }));
					} else {
						player.client.send(new CPacketMessage({ text: `\\red\\Player not found: ${args[0] || ""}\\reset\\` }));
					}
				} else {
					player.client.send(new CPacketMessage({ text: `\\red\\Usage: /tp <x> <y> <z> OR /tp <player>\\reset\\` }));
				}
			} else if (command === "spawn") {
				player.physics.pos.set(0, 70, 0);
				player.checkData.lastAuthoritativePos.set(0, 70, 0);
				this.resetSequenceAndPosition(player);
				player.checkData.teleportTarget = player.physics.pos.clone();
				player.client.send(new CPacketPlayerPosLook({ x: 0, y: 70, z: 0, yaw: 0, pitch: 0 }));
				player.client.send(new CPacketMessage({ text: `\\green\\Teleported to spawn\\reset\\` }));
			} else if (command === "help" || command === "?") {
				player.client.send(
					new CPacketMessage({
						text: `\\yellow\\Available commands:\\reset\\\n\\gray\\- /gamemode [survival|creative] (or /gm s|c)\\reset\\\n\\gray\\- /tp <x> <y> <z> OR /tp <player>\\reset\\\n\\gray\\- /spawn\\reset\\\n\\gray\\- /help\\reset\\`,
					})
				);
			} else {
				player.client.send(
					new CPacketMessage({
						text: `\\red\\Unknown command: /${command}\\reset\\`,
					})
				);
			}
			return;
		}

		const msg = new CPacketMessage({ text: `<${player.name}> ${text}` });
		for (const p of this.players.values()) {
			p.client.send(msg);
		}
	}

	private handleUseEntity(socket: Socket, payload: unknown): void {
		const attacker = this.getPlayer(socket);
		if (!attacker) return;

		const pkt = payload as SPacketUseEntity;
		console.log(`[Server] handleUseEntity called by ${attacker.name}: action=${pkt.action}, targetId=${pkt.id}`);

		const action = pkt.action as unknown;
		if (action !== SPacketUseEntity_Action.ATTACK && action !== "ATTACK") {
			console.log(`[Server] handleUseEntity: Ignored because action is not ATTACK (action: ${pkt.action})`);
			return;
		}
		if (pkt.id === undefined) {
			console.log(`[Server] handleUseEntity: Ignored because target ID is undefined`);
			return;
		}

		// Find the target player
		const target = [...this.players.values()].find((p) => p.entityId === pkt.id);
		if (!target) return;

		// 1. Distance check (max 4.5 blocks range)
		const dist = attacker.physics.pos.distanceTo(target.physics.pos);
		if (dist > 4.5) {
			console.log(`[Server] Combat: Attack rejected from ${attacker.name} to ${target.name} due to distance (${dist.toFixed(2)} blocks)`);
			return;
		}

		// 2. Creative mode check
		if (target.gamemode === "creative") {
			return;
		}

		// 3. Determine if critical hit (falling, not on ground, not flying)
		const isCrit = !attacker.physics.onGround && attacker.physics.motion.y < 0 && !attacker.physics.abilities.isFlying;

		// 4. Calculate damage
		let damage = 2; // 1 heart
		if (isCrit) {
			damage = 3; // 1.5 hearts
		}

		// Apply damage
		target.health = Math.max(0, target.health - damage);
		target.physics.health = target.health;

		console.log(`[Server] Combat: ${attacker.name} attacked ${target.name} for ${damage} HP (Crit: ${isCrit}). Target Health: ${target.health}/20`);

		// Sync health to the target client
		target.client.send(
			new CPacketUpdateHealth({
				id: target.entityId,
				hp: target.health,
				food: 20,
				foodSaturation: 5,
				oxygen: 20,
			})
		);

		// Broadcast hurt state to everyone if player survived (hurt status 2 + hurt animation type 1)
		if (target.health > 0) {
			const hurtStatus = new CPacketEntityStatus({
				entityId: target.entityId,
				entityStatus: 2,
			});
			const hurtAnim = new CPacketAnimation({
				id: target.entityId,
				type: 1,
			});

			for (const p of this.players.values()) {
				p.client.send(hurtStatus);
				p.client.send(hurtAnim);
			}
		}

		// If critical, broadcast critical hit particles (type 4)
		if (isCrit) {
			const critAnim = new CPacketAnimation({
				id: target.entityId,
				type: 4,
			});
			for (const p of this.players.values()) {
				p.client.send(critAnim);
			}
		}

		// 5. Apply knockback velocity
		const kbDir = new Vector3().subVectors(target.physics.pos, attacker.physics.pos);
		kbDir.y = 0;
		if (kbDir.lengthSq() > 0) {
			kbDir.normalize();
		} else {
			kbDir.set(1, 0, 0); // fallback direction
		}

		let kbHorizontal = 0.45;
		let kbVertical = 0.35;

		if (attacker.checkData.prevSprinting) {
			kbHorizontal *= 1.5;
			kbVertical *= 1.1;
		}

		const knockbackVelocity = new Vector3(
			kbDir.x * kbHorizontal,
			kbVertical,
			kbDir.z * kbHorizontal
		);

		// Apply velocity to server-side physics
		target.physics.motion.copy(knockbackVelocity);

		// Exempt from position prediction checkpoints on next packet
		target.checkData.predictedNextPos = null;
		target.checkData.inputOrderExempt = 5;

		// Replicate velocity to the target client
		target.client.send(
			new CPacketEntityVelocity({
				id: target.entityId,
				motion: new PBFloatVector3({
					x: knockbackVelocity.x,
					y: knockbackVelocity.y,
					z: knockbackVelocity.z,
				}),
			})
		);

		// 6. Death Handling
		if (target.health <= 0) {
			console.log(`[Server] Death: ${target.name} was slain by ${attacker.name}`);

			// Broadcast death message
			const deathMsg = new CPacketMessage({
				text: `\\red\\${target.name} was slain by ${attacker.name}\\reset\\`,
			});
			for (const p of this.players.values()) {
				p.client.send(deathMsg);
			}

			// Play the death sound directly for the target player
			// (we do not send them the death status 3, to prevent their local entity 'dead' flag from getting stuck as true)
			target.client.send(
				new CPacketSoundEffect({
					sound: "game.neutral.die",
					volume: 1.0,
					pitch: (Math.random() - Math.random()) * 0.2 + 1.0,
				})
			);

			// Broadcast death state (status 3 = dead) to all other players
			const deathStatus = new CPacketEntityStatus({
				entityId: target.entityId,
				entityStatus: 3,
			});
			for (const p of this.players.values()) {
				if (p !== target) {
					p.client.send(deathStatus);
				}
			}
		}
	}

	private handleRespawn(socket: Socket): void {
		const player = this.getPlayer(socket);
		if (!player) return;

		console.log(`[Server] Respawning player ${player.name}`);

		// Reset player health properties
		player.health = 20;
		player.physics.health = 20;

		// Reset coordinates to spawn point
		player.physics.pos.set(0, 70, 0);
		player.checkData.lastAuthoritativePos.set(0, 70, 0);
		this.resetSequenceAndPosition(player);
		player.checkData.teleportTarget = player.physics.pos.clone();

		// Send respawn confirmation to close the death screen
		player.client.send(
			new CPacketRespawn({
				notDeath: true,
				client: false,
				dimension: 0,
			})
		);

		// Position player at spawn and sync health
		player.client.send(
			new CPacketPlayerPosLook({
				x: 0,
				y: 70,
				z: 0,
				yaw: 0,
				pitch: 0,
			})
		);

		player.client.send(
			new CPacketUpdateHealth({
				id: player.entityId,
				hp: player.health,
				food: 20,
				foodSaturation: 5,
				oxygen: 20,
			})
		);

		// Broadcast destroy & spawn sequence to all other clients to refresh player mesh cleanly
		const destroyPkt = new CPacketDestroyEntities({ ids: [player.entityId] });
		const spawnPkt = this.spawnPacket(player, this.getSid(player.client.socket));

		for (const p of this.players.values()) {
			if (p !== player) {
				p.client.send(destroyPkt);
				p.client.send(spawnPkt);
			}
		}
	}

	private resetSequenceAndPosition(player: Player): void {
		player.checkData.lastSequenceNumber = NaN;
		player.checkData.predictedNextPos = null;
		player.checkData.hadInput = false;
		player.checkData.hadPos = false;
		player.checkData.inputOrderExempt = 4;
		player.checkData.teleportTarget = null;
	}
}
