import { Box3, Vector3 } from "three";
import { type Socket } from "engine.io";
import {
	CPacketBlockUpdate,
	CPacketDestroyEntities,
	CPacketEntityPositionAndRotation,
	CPacketEntityProperties,
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
	PBModifier,
	PBSnapshot,
	PBVector3,
	PlayerData,
	SPacketEntityAction,
	SPacketHeldItemChange,
	SPacketPlaceBlock,
	SPacketPlayerAbilities,
	SPacketPlayerPosLook,
	type SPacketMessage,
	type SPacketPlayerInput,
} from "../gen/protocol2_pb.js";
import Client from "./client.js";
import Player from "./player.js";
import { World } from "./movement/world.js";
import { ID_TO_NAME, type SPACKET_MAP } from "./protocol/index.js";
import { createFlatChunk } from "./terrain.js";
import { simulate } from "./movement/index.js";
import { PhysicsPlayer } from "./movement/move.js";

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

		switch (name) {
			case "SPacketLoginStart":
				return this.handleLogin(cl, socket, payload);
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
				if (player.gamemode !== "creative") {
					console.warn(
						`[Server] Player ${player.name} sent abilities packet (isFlying=${pl.isFlying}) while in ${player.gamemode} mode. Ignoring.`
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
			cl.send({ sid: this.getSid(socket), pid: null }, { packetType: 0 });
			return true;
		}
		return false;
	}

	private handleLogin(cl: Client, socket: Socket, _payload: unknown): void {
		const eid = this.nextEntityId++;
		const player = new Player(
			cl,
			`Player${eid}`,
			"creative",
			new Vector3(0, 70, 0),
		);
		this.players.set(this.getSid(socket), player);

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
					playerPermissionEntries: [
						{
							uuid: player.uuid,
							username: player.name,
							permissionLevel: player.permissionLevel,
							rank: "",
							level: 3,
							verified: true,
						},
					],
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

		const sid = this.getSid(socket);

		for (const [existingSid, existing] of this.players) {
			cl.send(this.spawnPacket(existing, existingSid));
		}

		for (const [existingSid, existing] of this.players) {
			if (existingSid === sid) continue;
			existing.client.send(this.spawnPacket(player, sid));
		}

		this.broadcastPlayerList();

		cl.send(new CPacketPlayerPosLook({ x: 0, y: 70, z: 0, yaw: 0, pitch: 0 }));
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
			yaw: 0,
			pitch: 0,
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
		checkData.hadPos = false;
		const pl = payload;
		if (!pl.pos) return;

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
			const clientPos = new Vector3(pl.pos.x!, pl.pos.y!, pl.pos.z!);
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

		cl.send(
			new CPacketPlayerReconciliation({
				lastProcessedInput: pl.sequenceNumber,
				pitch: pl.pitch,
				yaw: pl.yaw,
				reset,
				x: nextPos?.x ?? checkData.lastAuthoritativePos.x,
				y: nextPos?.y ?? checkData.lastAuthoritativePos.y,
				z: nextPos?.z ?? checkData.lastAuthoritativePos.z,
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
		if (checkData.inputOrderExempt > 0) {
			checkData.inputOrderExempt--;
		}
		if (!checkData.hadInput && checkData.inputOrderExempt <= 0) {
			console.warn(`[Server] Missing input packet before pos look packet for player ${player.name}. (Bypassing kick)`);
		}
		checkData.hadPos = true;
		checkData.hadInput = false;
	}

	private handlePlace(socket: Socket, payload: unknown): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		const pkt = payload as SPacketPlaceBlock;
		const posIn = pkt.positionIn;
		if (!posIn) return;
		const side = pkt.side;
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
		for (const p of this.players.values()) {
			if (blockBox.intersectsBox(p.physics.boundingBox)) {
				intersects = true;
				break;
			}
		}

		if (intersects) {
			console.log(`[Server] Reverted block placement at ${bx}, ${by}, ${bz} due to player intersection`);
			const currentBlockId = (player.physics.world as World).getBlockId(bx, by, bz);
			const revertUpdate = new CPacketBlockUpdate({ id: currentBlockId, x: bx, y: by, z: bz });
			for (const p of this.players.values()) p.client.send(revertUpdate);
			return;
		}

		const blockId = 1;
		player.physics.world.setBlock(bx, by, bz, blockId);
		const update = new CPacketBlockUpdate({ id: blockId, x: bx, y: by, z: bz });
		for (const p of this.players.values()) p.client.send(update);
	}

	private handleBreak(socket: Socket, payload: unknown): void {
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

	private resetSequenceAndPosition(player: Player): void {
		player.checkData.lastSequenceNumber = NaN;
		player.checkData.predictedNextPos = null;
		player.checkData.hadInput = false;
		player.checkData.hadPos = false;
		player.checkData.inputOrderExempt = 4;
		player.checkData.teleportTarget = null;
	}
}
