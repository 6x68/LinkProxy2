import { Box3, Vector3, Ray } from "three";
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
	type SPacketPlayerInput,
	SPacketUseEntity,
	SPacketPlayerAction,
	SPacketUseItem,
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
import { PBEnumFacing, SPacketUseEntity_Action } from "../gen/common_pb.js";
import Client from "./client.js";
import Player from "./player.js";
import { World } from "./movement/world.js";
import { ID_TO_NAME, type SPACKET_MAP } from "./protocol/index.js";
import { createFlatChunk } from "./terrain.js";
import { simulate } from "./movement/index.js";
import { PhysicsPlayer } from "./movement/move.js";
import Rotation from "./rotation.js";
import {
	EnumFacing,
	playerBlockRayTrace,
	TypeOfHit,
	rayTraceBlocks,
} from "./movement/raytrace.js";


function getAngleDiff(a: number, b: number): number {
	let diff = a - b;
	while (diff < -Math.PI) diff += Math.PI * 2;
	while (diff > Math.PI) diff -= Math.PI * 2;
	return Math.abs(diff);
}

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
						"Sent player abilities packet with isFlying while not in creative mode",
					);
					player.physics.abilities.flying = false;
					return;
				}
				player.physics.abilities.flying = !!pl.isFlying;
				return;
			}
			case "SPacketClick":
				break; // TODO
			case "SPacketEntityAction": {
				const player = this.getPlayer(socket);
				if (!player) return;
				const pl = payload as SPacketEntityAction;
				if (pl.id !== player.entityId) {
					cl.disconnect(
						"An entities ID was sent in SPacketEntityAction the that wasn't yours",
					);
					return;
				}
				return;
			}
			case "SPacketHeldItemChange":
				return this.handleHeld(socket, payload);
			case "SPacketMessage":
				return this.handleMessage(socket, payload);
			case "SPacketUseEntity":
				return this.handleUseEntity(socket, payload);
			case "SPacketUseItem": {
				const player = this.getPlayer(socket);
				if (player) {
					player.checkData.lastBlockTime = Date.now();
				}
				return;
			}
			case "SPacketPlayerAction": {
				const player = this.getPlayer(socket);
				if (player) {
					const pl = payload as SPacketPlayerAction;
					if (pl.action === 5 /* RELEASE_USE_ITEM */) {
						player.checkData.lastUnblockTime = Date.now();
						const blockTime = player.checkData.lastBlockTime;
						const attackTime = player.checkData.lastAttackTime;
						const now = Date.now();
						if (blockTime && attackTime && now - blockTime < 15 && now - attackTime < 15 && attackTime >= blockTime) {
							// Heuristic: log only, no kick. A skilled player could legitimately
							// block and attack in very close succession.
							console.log(`[Server] Possible AutoBlock from ${player.name}: Block (${now - blockTime}ms ago) -> Attack (${now - attackTime}ms ago) -> Unblock.`);
						}
					}
				}
				return;
			}
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
			"SPacketAnalytics",
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
			pos: Vector3;
			vel: Vector3;
		},
	) {
		// Broadcast new position and rotation to other players
		const finalPos = state.pos;
		let encodedYaw =
			Math.floor(((of.rotation.yaw ?? 0) / (Math.PI * 2)) * 256) % 256;
		if (encodedYaw < 0) encodedYaw += 256;
		let encodedPitch =
			Math.floor(((of.rotation.pitch ?? 0) / (Math.PI * 2)) * 256) % 256;
		if (encodedPitch < 0) encodedPitch += 256;

		const movePacket = new CPacketEntityPositionAndRotation({
			id: of.entityId,
			pos: new PBVector3({
				x: Math.round(finalPos.x * 32),
				y: Math.round(finalPos.y * 32),
				z: Math.round(finalPos.z * 32),
			}),
			yaw: encodedYaw,
			pitch: encodedPitch,
			onGround: state.onGround,
		});
		for (const [existingSid, existing] of this.players) {
			if (existingSid === of.client.id) continue;

			existing.client.send(movePacket);
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
				`[Server] Sequence number went backwards or duplicated (client: ${payload.sequenceNumber}, server: ${checkData.lastSequenceNumber}). Resetting tracking.`,
			);
		}
		checkData.lastSequenceNumber = payload.sequenceNumber;
		checkData.hadInput = true;
		if (!checkData.hadPos && checkData.inputOrderExempt <= 0) {
			cl.disconnect("Missing pos look before input packet");
		}
		if (!payload.pos) {
			cl.disconnect("Missing pos in SPacketPlayerInput");
			return;
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
		// Push to rotation history
		const now = Date.now();
		const attacked = (now - checkData.lastAttackTime < 100);
		checkData.rotationHistory.push({ yaw, pitch, time: now, attacked });
		if (checkData.rotationHistory.length > 8) {
			checkData.rotationHistory.shift();
		}

		// Rotation history is kept for potential future logging but no kicks are issued.
		// Heuristic rotation checks (snap-to/snap-back) are unreliable — skilled legit
		// players can trigger them, and cheaters just tune below the threshold.
		checkData.wasSnapAttack = false;

		// Smooth camera tracking to identify legit viewing yaw
		let diffYaw = yaw - player.rotation.yaw;
		while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
		while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
		diffYaw = Math.abs(diffYaw);

		if (diffYaw < 0.5) {
			checkData.lastLegitYaw = yaw;
		}

		player.rotation.yaw = yaw;
		player.rotation.pitch = pitch;
		this.tryCompletePlacement(player);

		let reset = false;

		if (checkData.teleportTarget) {
			const clientPos = new Vector3(pl.pos.x!, pl.pos.y!, pl.pos.z!);
			const dist = clientPos.distanceTo(checkData.teleportTarget);
			if (dist > Number.EPSILON) {
				console.warn(
					`[Server] Teleport check failed: client sent pos (${clientPos.x}, ${clientPos.y}, ${clientPos.z}) but target was (${checkData.teleportTarget.x}, ${checkData.teleportTarget.y}, ${checkData.teleportTarget.z}) (dist: ${dist}). Resetting position.`,
				);
				reset = true;
				player.physics.pos.copy(checkData.teleportTarget);
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
			if (dist > 0.07) {
				console.info(`Server distance: ${dist}`);
				reset = true;
			} else if (dist < 0.03) {
				checkData.lastAuthoritativePos.copy(clientPos);
			}
		}

		const { lastAuthoritativePos } = checkData;
		player.physics.pos.copy(lastAuthoritativePos);
		player.physics.boundingBox = new Box3(
			new Vector3(
				lastAuthoritativePos.x - 0.3,
				lastAuthoritativePos.y,
				lastAuthoritativePos.z - 0.3,
			),
			new Vector3(
				lastAuthoritativePos.x + 0.3,
				lastAuthoritativePos.y + 1.8,
				lastAuthoritativePos.z + 0.3,
			),
		);

		const nextPos = simulate(player.physics, pl);
		if (nextPos) {
			player.physics.pos.copy(nextPos);
			checkData.lastAuthoritativePos.copy(nextPos);
			checkData.predictedNextPos = nextPos.clone();
		}

		if (pl.sprint !== undefined && pl.sprint !== checkData.prevSprinting) {
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
			onGround: player.physics.onGround,
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
	}

	private handlePosLook(cl: Client, payload: SPacketPlayerPosLook): void {
		const player = [...this.players.values()].find((p) => p.client === cl);
		if (!player) return;
		const { checkData } = player;
		const yaw = payload.yaw ?? player.rotation.yaw;
		const pitch = payload.pitch ?? player.rotation.pitch;

		// Push to rotation history
		const now = Date.now();
		const attacked = (now - checkData.lastAttackTime < 100);
		checkData.rotationHistory.push({ yaw, pitch, time: now, attacked });
		if (checkData.rotationHistory.length > 8) {
			checkData.rotationHistory.shift();
		}

		// Rotation history is kept for potential future logging but no kicks are issued.
		// Heuristic rotation checks (snap-to/snap-back) are unreliable — skilled legit
		// players can trigger them, and cheaters just tune below the threshold.
		checkData.wasSnapAttack = false;

		player.rotation.set(yaw, pitch);
		this.tryCompletePlacement(player);
		if (checkData.inputOrderExempt > 0) {
			checkData.inputOrderExempt--;
		}
		if (!checkData.hadInput && checkData.inputOrderExempt <= 0) {
			console.warn(
				`[Server] Missing input packet before pos look packet for player ${player.name}. (Bypassing kick)`,
			);
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
		if (side == null) return;
		const NUM_OFFSET: [number, number, number][] = [
			[0, -1, 0], // client DOWN  (index 0)
			[0, 1, 0], // client UP    (index 1)
			[0, 0, -1], // client NORTH (index 2)
			[0, 0, 1], // client SOUTH (index 3)
			[-1, 0, 0], // client WEST  (index 4)
			[1, 0, 0], // client EAST  (index 5)
		];
		const pbFacing = typeof side === "string"
			? (PBEnumFacing as unknown as Record<string, number>)[side] ?? 0
			: side;
		const off = NUM_OFFSET[pbFacing] ?? [0, 0, 0];
		const bx = (posIn.x ?? 0) + off[0];
		const by = (posIn.y ?? 0) + off[1];
		const bz = (posIn.z ?? 0) + off[2];

		player.checkData.pendingPlacement = { payload, bx, by, bz };
	}

	private tryCompletePlacement(player: Player): void {
		const pending = player.checkData.pendingPlacement;
		if (!pending) return;
		player.checkData.pendingPlacement = null;

		const { payload, bx, by, bz } = pending;
		const posIn = payload.positionIn;
		if (!posIn) return;
		const side = payload.side;
		if (!side) return;

		const world = player.physics.world;

		function cancel(reason?: string) {
			if (reason)
				player.client.send(
					new CPacketMessage({
						text: `Cancel block placement: ${reason}`,
					}),
				);
			player.client.send(
				new CPacketBlockUpdate({ id: 0, x: bx, y: by, z: bz }),
			);
		}

		// #region Validations
		const eyePos = player.checkData.lastClientPos.clone();
		eyePos.setY(eyePos.y + player.physics.eyeHeight);

		const dy = (posIn.y ?? 0) - eyePos.y;
		const reach = Math.sqrt(4.5 * 4.5 + dy * dy);

		const trace = playerBlockRayTrace(
			{
				getEyePos() {
					return eyePos;
				},
				getLook() {
					const cosPitch = Math.cos(player.rotation.pitch),
						x = -Math.sin(player.rotation.yaw) * cosPitch,
						y = Math.sin(player.rotation.pitch),
						z = -Math.cos(player.rotation.yaw) * cosPitch;
					return new Vector3(x, y, z).normalize();
				},
			},
			world,
			reach,
		);
		if (trace === null) return cancel("trace === null");
		const realSide = typeof side === "string"
			? (PBEnumFacing as unknown as Record<string, number>)[side]
			: side;
		if (realSide === undefined) return cancel("undefined side");
		if (
			trace.block?.x !== posIn.x ||
			trace.block?.y !== posIn.y ||
			trace.block?.z !== posIn.z
		)
			return cancel("traced block pos doesn't match");
		if (trace.side !== realSide)
			return cancel(
				`traced side (${EnumFacing[trace.side]}) !== client side (${EnumFacing[realSide]})`,
			);
		// #endregion

		// Check if the block intersects with any connected player (strict: touching faces is OK)
		const blockBox = new Box3(
			new Vector3(bx, by, bz),
			new Vector3(bx + 1, by + 1, bz + 1),
		);
		for (const p of this.players.values()) {
			const bb = p.physics.boundingBox;
			if (
				bb.max.x > blockBox.min.x &&
				bb.min.x < blockBox.max.x &&
				bb.max.y > blockBox.min.y &&
				bb.min.y < blockBox.max.y &&
				bb.max.z > blockBox.min.z &&
				bb.min.z < blockBox.max.z
			) {
				player.client.send(
					new CPacketBlockUpdate({ id: 0, x: bx, y: by, z: bz }),
				);
				return;
			}
		}

		// Get block ID from selected hotbar slot item
		const heldItem = player.inventory.items[player.heldSlot];
		const blockId =
			heldItem && heldItem.present && heldItem.id !== undefined
				? heldItem.id
				: 1;

		world.setBlock(bx, by, bz, blockId);
		const update = new CPacketBlockUpdate({ id: blockId, x: bx, y: by, z: bz });
		for (const p of this.players.values()) p.client.send(update);
	}

	private handleBreak(socket: Socket, payload: SPacketBreakBlock): void {
		const player = this.getPlayer(socket);
		const pkt = payload;
		if (!pkt.location) return;
		const x = pkt.location.x ?? 0;
		const y = pkt.location.y ?? 0;
		const z = pkt.location.z ?? 0;

		if (player) {
			const eyePos = player.checkData.lastClientPos.clone();
			eyePos.setY(eyePos.y + player.physics.eyeHeight);

			const blockCenter = new Vector3(x + 0.5, y + 0.5, z + 0.5);
			const dy = blockCenter.y - eyePos.y;
			const maxReach = Math.sqrt(4.5 * 4.5 + dy * dy) + 0.5; // 0.5 block size buffer
			const dist = eyePos.distanceTo(blockCenter);

			if (dist > maxReach) {
				console.warn(
					`[Anti-Cheat] Player ${player.name} tried to break block at (${x}, ${y}, ${z}) beyond reach limit (dist: ${dist.toFixed(2)}, maxReach: ${maxReach.toFixed(2)})`
				);
				const blockId = player.physics.world.getBlockId(x, y, z);
				player.client.send(new CPacketBlockUpdate({ id: blockId, x, y, z }));
				return;
			}

			player.physics.world.setBlock(x, y, z, 0);
		}

		const update = new CPacketBlockUpdate({ id: 0, x, y, z });
		for (const p of this.players.values()) p.client.send(update);
	}

	private handleHeld(socket: Socket, payload: SPacketHeldItemChange): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		player.heldSlot = payload.slot ?? 0;
	}

	private handleUpdateInventory(
		socket: Socket,
		payload: SPacketUpdateInventory,
	): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		console.log(
			`[Server] handleUpdateInventory: player=${player.name}, payload=${JSON.stringify(payload)}`,
		);
		if (payload.main) {
			player.inventory.items = payload.main;
		}
	}

	private handleClickWindow(socket: Socket, payload: unknown): void {
		const player = this.getPlayer(socket);
		if (!player) return;
		console.log(
			`[Server] handleClickWindow: player=${player.name}, payload=${JSON.stringify(payload)}`,
		);
		const pkt = payload as SPacketClickWindow;
		const slotId = pkt.slotId;
		if (
			pkt.windowId === 0 &&
			slotId !== undefined &&
			slotId >= 4 &&
			slotId < 40
		) {
			const invSlot = slotId - 4;
			if (pkt.itemStack) {
				player.inventory.items[invSlot] = pkt.itemStack;
				console.log(
					`[Server] handleClickWindow: updated slot ${invSlot} to item=${JSON.stringify(pkt.itemStack)}`,
				);
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
					player.physics.abilities.flying = false;
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
						}),
					);
				} else {
					player.client.send(
						new CPacketMessage({
							text: `\\red\\Usage: /gamemode <survival|creative>\\reset\\`,
						}),
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
						player.client.send(
							new CPacketPlayerPosLook({ x, y, z, yaw: 0, pitch: 0 }),
						);
						player.client.send(
							new CPacketMessage({
								text: `\\green\\Teleported to ${x}, ${y}, ${z}\\reset\\`,
							}),
						);
					} else {
						player.client.send(
							new CPacketMessage({
								text: `\\red\\Invalid coordinates!\\reset\\`,
							}),
						);
					}
				} else if (args.length === 1) {
					const targetName = (args[0] || "").toLowerCase();
					const target = [...this.players.values()].find(
						(p) => p.name.toLowerCase() === targetName,
					);
					if (target) {
						const pos = target.physics.pos;
						player.physics.pos.copy(pos);
						player.checkData.lastAuthoritativePos.copy(pos);
						this.resetSequenceAndPosition(player);
						player.checkData.teleportTarget = player.physics.pos.clone();
						player.client.send(
							new CPacketPlayerPosLook({
								x: pos.x,
								y: pos.y,
								z: pos.z,
								yaw: 0,
								pitch: 0,
							}),
						);
						player.client.send(
							new CPacketMessage({
								text: `\\green\\Teleported to ${target.name}\\reset\\`,
							}),
						);
					} else {
						player.client.send(
							new CPacketMessage({
								text: `\\red\\Player not found: ${args[0] || ""}\\reset\\`,
							}),
						);
					}
				} else {
					player.client.send(
						new CPacketMessage({
							text: `\\red\\Usage: /tp <x> <y> <z> OR /tp <player>\\reset\\`,
						}),
					);
				}
			} else if (command === "spawn") {
				this.resetSequenceAndPosition(player);
				player.checkData.teleportTarget = player.physics.pos.clone();
				player.client.send(
					new CPacketPlayerPosLook({ x: 0, y: 70, z: 0, yaw: 0, pitch: 0 }),
				);
				player.client.send(
					new CPacketMessage({ text: `\\green\\Teleported to spawn\\reset\\` }),
				);
			} else if (command === "help" || command === "?") {
				player.client.send(
					new CPacketMessage({
						text: `\\yellow\\Available commands:\\reset\\\n\\gray\\- /gamemode [survival|creative] (or /gm s|c)\\reset\\\n\\gray\\- /tp <x> <y> <z> OR /tp <player>\\reset\\\n\\gray\\- /spawn\\reset\\\n\\gray\\- /help\\reset\\`,
					}),
				);
			} else {
				player.client.send(
					new CPacketMessage({
						text: `\\red\\Unknown command: /${command}\\reset\\`,
					}),
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
		console.log(
			`[Server] handleUseEntity called by ${attacker.name}: action=${pkt.action}, targetId=${pkt.id}`,
		);

		const action = pkt.action as unknown;
		if (action !== SPacketUseEntity_Action.ATTACK && action !== "ATTACK") {
			console.log(
				`[Server] handleUseEntity: Ignored because action is not ATTACK (action: ${pkt.action})`,
			);
			return;
		}
		if (pkt.id === undefined) {
			console.log(
				`[Server] handleUseEntity: Ignored because target ID is undefined`,
			);
			return;
		}

		// Self-Attack Check
		if (pkt.id === attacker.entityId) {
			console.warn(`[Server] Combat: Attack rejected because ${attacker.name} tried to attack themselves`);
			return;
		}

		// Attacker Dead Check
		if (attacker.health <= 0) {
			console.log(`[Server] Combat: Attack rejected because attacker ${attacker.name} is dead`);
			return;
		}

		// Click Rate Limit check (max 20 clicks/second)
		const now = Date.now();
		if (attacker.checkData.lastAttackTime && now - attacker.checkData.lastAttackTime < 50) {
			console.log(`[Server] Combat: Attack rejected from ${attacker.name} due to click rate limiting`);
			return;
		}
		attacker.checkData.lastAttackTime = now;

		// Find the target player
		const target = [...this.players.values()].find(
			(p) => p.entityId === pkt.id,
		);
		if (!target) return;

		// Multi-target timing is a heuristic — log only, no kick.
		if (attacker.checkData.lastAttackedEntityId !== null && attacker.checkData.lastAttackedEntityId !== pkt.id) {
			console.log(`[Server] Combat: ${attacker.name} switched attack target (${attacker.checkData.lastAttackedEntityId} -> ${pkt.id})`);
		}
		attacker.checkData.lastAttackedEntityId = pkt.id;

		// Rotation history: mark recent entries as attacked (kept for logging only)
		const history = attacker.checkData.rotationHistory;
		for (const entry of history) {
			if (now - entry.time < 100) entry.attacked = true;
		}

		// Target hurt invulnerability cooldown (10 ticks / 450ms)
		if (target.checkData.lastHurtTime && now - target.checkData.lastHurtTime < 450) {
			console.log(`[Server] Combat: Attack ignored from ${attacker.name} to ${target.name} due to target invulnerability`);
			return;
		}

		// 1 & 2. Grim-style combined reach + angle check
		// Measures actual distance from eye to hitbox surface intercept point.
		// Tries current and previous-frame look vectors for tick-boundary attacks.
		// Tight 0.1-block expansion for latency only. Max 3.5 blocks (vanilla 3.0 + 0.5 buffer).

		const MAX_REACH = 3.5;
		const HITBOX_EXPANSION = 0.1;

		const eyePos = attacker.physics.pos.clone().setY(
			attacker.physics.pos.y + attacker.physics.eyeHeight,
		);

		const buildLook = (yaw: number, pitch: number): Vector3 => {
			const pc = Math.cos(pitch);
			return new Vector3(
				-Math.sin(yaw) * pc,
				Math.sin(pitch),
				-Math.cos(yaw) * pc,
			).normalize();
		};

		const look1 = buildLook(attacker.rotation.yaw, attacker.rotation.pitch);
		const prevRotEntry = attacker.checkData.rotationHistory.length >= 2
			? attacker.checkData.rotationHistory[attacker.checkData.rotationHistory.length - 2]
			: null;
		const look2 = prevRotEntry
			? buildLook(prevRotEntry.yaw, attacker.rotation.pitch)
			: null;

		const expandedBox = target.physics.boundingBox.clone().expandByScalar(HITBOX_EXPANSION);
		let bestInterceptDist = Infinity;
		for (const lookVec of look2 ? [look1, look2] : [look1]) {
			const ray = new Ray(eyePos, lookVec);
			const hp = new Vector3();
			if (ray.intersectBox(expandedBox, hp) !== null) {
				bestInterceptDist = Math.min(bestInterceptDist, eyePos.distanceTo(hp));
			}
		}

		if (bestInterceptDist === Infinity) {
			console.log(
				`[Server] Combat: Attack rejected from ${attacker.name} → ${target.name} (look ray missed hitbox)`,
			);
			return;
		}

		if (bestInterceptDist > MAX_REACH) {
			console.log(
				`[Server] Combat: Attack rejected from ${attacker.name} → ${target.name} (reach: ${bestInterceptDist.toFixed(3)} > ${MAX_REACH})`,
			);
			return;
		}

		// 3. Line of Sight Raytrace Check (anti-WallHack) — silent mitigation, no kick
		const targetFeet = target.physics.pos.clone();
		const targetCenter = target.physics.boundingBox.getCenter(new Vector3());
		const targetEye = targetFeet.clone().setY(targetFeet.y + target.physics.eyeHeight);

		const hitCenter = rayTraceBlocks(eyePos, targetCenter, false, true, false, attacker.physics.world);
		const hitFeet = rayTraceBlocks(eyePos, targetFeet, false, true, false, attacker.physics.world);
		const hitEye = rayTraceBlocks(eyePos, targetEye, false, true, false, attacker.physics.world);

		const blockedCenter = hitCenter && hitCenter.typeOfHit === TypeOfHit.BLOCK;
		const blockedFeet = hitFeet && hitFeet.typeOfHit === TypeOfHit.BLOCK;
		const blockedEye = hitEye && hitEye.typeOfHit === TypeOfHit.BLOCK;

		if (blockedCenter && blockedFeet && blockedEye) {
			console.log(`[Server] Combat: Attack rejected from ${attacker.name} → ${target.name} (blocked by wall — all 3 LOS raycasts failed)`);
			return;
		}

		// 4. Creative mode check
		if (target.gamemode === "creative") {
			return;
		}

		// 5. Determine if critical hit (falling, not on ground, not flying)
		const isCrit =
			!attacker.physics.onGround &&
			attacker.physics.motion.y < 0 &&
			!attacker.physics.abilities.flying;

		// 6. Calculate damage
		let damage = 2; // 1 heart
		if (isCrit) {
			damage = 3; // 1.5 hearts
		}

		// Apply damage
		target.health = Math.max(0, target.health - damage);
		target.physics.health = target.health;
		target.checkData.lastHurtTime = now;

		console.log(
			`[Server] Combat: ${attacker.name} attacked ${target.name} for ${damage} HP (Crit: ${isCrit}). Target Health: ${target.health}/20`,
		);

		// Sync health to the target client
		target.client.send(
			new CPacketUpdateHealth({
				id: target.entityId,
				hp: target.health,
				food: 20,
				foodSaturation: 5,
				oxygen: 20,
			}),
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
		const kbDir = new Vector3().subVectors(
			target.physics.pos,
			attacker.physics.pos,
		);
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
			kbDir.z * kbHorizontal,
		);

		// Apply velocity to server-side physics
		target.physics.motion.copy(knockbackVelocity);

		// Replicate velocity to the target client
		target.client.send(
			new CPacketEntityVelocity({
				id: target.entityId,
				motion: new PBFloatVector3({
					x: knockbackVelocity.x,
					y: knockbackVelocity.y,
					z: knockbackVelocity.z,
				}),
			}),
		);

		// 6. Death Handling
		if (target.health <= 0) {
			console.log(
				`[Server] Death: ${target.name} was slain by ${attacker.name}`,
			);

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
				}),
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
			}),
		);

		// Position player at spawn and sync health
		player.client.send(
			new CPacketPlayerPosLook({
				x: 0,
				y: 70,
				z: 0,
				yaw: 0,
				pitch: 0,
			}),
		);

		player.client.send(
			new CPacketUpdateHealth({
				id: player.entityId,
				hp: player.health,
				food: 20,
				foodSaturation: 5,
				oxygen: 20,
			}),
		);

		// Broadcast destroy & spawn sequence to all other clients to refresh player mesh cleanly
		const destroyPkt = new CPacketDestroyEntities({ ids: [player.entityId] });
		const spawnPkt = this.spawnPacket(
			player,
			this.getSid(player.client.socket),
		);

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
