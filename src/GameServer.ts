import { Box3, Vector3 } from "three";
import { type Socket } from "engine.io";
import {
	CPacketBlockUpdate,
	CPacketDestroyEntities,
	CPacketEntityProperties,
	CPacketJoinGame,
	CPacketMessage,
	CPacketPlayerList,
	CPacketPlayerPosLook,
	CPacketPlayerReconciliation,
	CPacketPong,
	CPacketSpawnPlayer,
	CPacketTimeUpdate,
	PBCosmetics,
	PBFloatVector3,
	PBModifier,
	PBSnapshot,
	PlayerData,
	SPacketEntityAction,
	SPacketHeldItemChange,
	SPacketPlaceBlock,
	SPacketPlayerAbilities,
	SPacketPlayerPosLook,
	type SPacketPlayerInput,
} from "../gen/protocol2_pb.js";
import Client from "./client.js";
import Player from "./player.js";
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
				if (player.gamemode !== "creative") {
					cl.disconnect(
						"Sent invalid player abilities packet while in creative mode",
					);
					return;
				}
				const pl = payload as SPacketPlayerAbilities;
				if (pl.isFlying) player.physics.abilities.isFlying = pl.isFlying;
				break;
			}
			case "SPacketClick":
				break; // TODO
			case "SPacketEntityAction": {
				const player = this.getPlayer(socket);
				if (!player) return;
				const pl = payload as SPacketEntityAction;
				if (pl.id !== player.entityId) {
					cl.disconnect(
						"Sent entity action with a different entity ID than your entity ID",
					);
					return;
				}
				return;
			}
			case "SPacketHeldItemChange":
				return this.handleHeld(socket, payload);
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
			cl.disconnect("Sequence number went backwards???");
			return;
		} else {
			checkData.lastSequenceNumber = payload.sequenceNumber;
		}
		checkData.hadInput = true;
		if (!checkData.hadPos && checkData.inputOrderExempt <= 0) {
			cl.disconnect("Missing pos look before input packet");
			return;
		}
		if (!payload.pos) {
			cl.disconnect("Missing position in SPacketPlayerInput");
			return;
		}
		checkData.hadPos = false;
		if (player.physics.abilities.isFlying) {
			// just accept it.
			// TODO: simulate even while flying. it'd require a bit more code, and its flying so who cares anyway. this isn't like mc where making fly speed faster is a common thing in "legit" / "pvp" clients.
			cl.send(
				new CPacketPlayerReconciliation({
					lastProcessedInput: payload.sequenceNumber,
					pitch: payload.pitch,
					yaw: payload.yaw,
					reset: false,
					x: payload.pos.x,
					y: payload.pos.y,
					z: payload.pos.z,
				}),
			);
			return;
		}
		if (!payload.pos) return;

		let reset = false;

		if (checkData.predictedNextPos) {
			const clientPos = new Vector3(
				payload.pos.x!,
				payload.pos.y!,
				payload.pos.z!,
			);
			const ep = checkData.predictedNextPos;
			const dist = clientPos.distanceTo(ep);
			/*
				The speed boost for sprinting should be calculated on the client (client starts sprinting and tells server -> client updates speed attribute -> instantly starts going faster),
				not the server (client tells server -> c2s latency -> server updates move speed attribute -> s2c latency -> client receives it and goes faster).
				Doing so just adds latency,
				and it makes it worse anticheat wise since you have to add more latency compensation to see
				when the player actually got the move speed attribute update and then simulate properly.
			*/
			if (dist > 0.07) {
				console.info(`Server distance: ${dist}`);
				reset = true;
			}
		}

		player.physics.pos.set(payload.pos.x!, payload.pos.y!, payload.pos.z!);
		player.physics.boundingBox = new Box3(
			new Vector3(payload.pos.x! - 0.3, payload.pos.y!, payload.pos.z! - 0.3),
			new Vector3(
				payload.pos.x! + 0.3,
				payload.pos.y! + 1.8,
				payload.pos.z! + 0.3,
			),
		);

		const nextPos = simulate(player.physics, payload);
		if (nextPos) {
			player.physics.pos.copy(nextPos);
			checkData.lastAuthoritativePos.copy(nextPos);
			checkData.predictedNextPos = nextPos.clone();
		}

		if (
			payload.sprint !== undefined &&
			payload.sprint !== checkData.prevSprinting
		) {
			checkData.prevSprinting = payload.sprint;
			cl.send(
				new CPacketEntityProperties({
					id: player.entityId,
					data: [
						new PBSnapshot({
							id: "generic.movementSpeed",
							value: player.physics.movementSpeedAttribute.getBaseValue(),
							modifiers: payload.sprint
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
				lastProcessedInput: payload.sequenceNumber,
				pitch: payload.pitch,
				yaw: payload.yaw,
				reset,
				x: nextPos?.x ?? checkData.lastAuthoritativePos.x,
				y: nextPos?.y ?? checkData.lastAuthoritativePos.y,
				z: nextPos?.z ?? checkData.lastAuthoritativePos.z,
			}),
		);
	}

	private handlePosLook(cl: Client, payload: SPacketPlayerPosLook): void {
		const player = [...this.players.values()].find((p) => p.client === cl);
		if (!player) return;
		const { checkData } = player;
		if (checkData.inputOrderExempt > 0) {
			checkData.inputOrderExempt--;
		}
		if (!checkData.hadInput && checkData.inputOrderExempt <= 0) {
			cl.disconnect("Missing input packet before pos look packet");
			return;
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
}
