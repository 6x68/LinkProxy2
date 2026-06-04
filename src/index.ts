import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { Server, type Socket } from "engine.io";
import { Vector3 } from "three";
import {
	CPacketJoinGame,
	CPacketMessage,
	CPacketPlayerPosLook,
	CPacketPlayerReconciliation,
	CPacketPong,
	CPacketSpawnPlayer,
	CPacketTimeUpdate,
	PBVector3,
	type SPacketPlayerInput,
} from "../gen/protocol2_pb.js";
import Client from "./client.js";
import { simulate } from "./movement/index.js";
import Player from "./player.js";
import { ID_TO_NAME, type SPACKET_MAP } from "./protocol/index.js";
import { createFlatChunk } from "./terrain.js";

const httpsServer = createServer({
	key: readFileSync("./certs/key.pem"),
	cert: readFileSync("./certs/cert.pem"),
});

const io = new Server({
	cors: {
		origin: "https://miniblox.io",
	},
	transports: ["websocket"],
});

io.attach(httpsServer, {
	path: "/socket.io",
});

const SPAWN_POS = new Vector3(0, 70, 0);
const TOLERANCE = 0.03;

io.on("connection", (socket: Socket) => {
	const cl = new Client(socket);
	const player = new Player(cl, SPAWN_POS);

	cl.on("data", (d) => {
		//@ts-expect-error: should probably cat.
		const dataArray = d && typeof d === "object" ? (d.data ?? d.d) : null;
		if (Array.isArray(dataArray)) {
			const packetId = dataArray[0] as number;
			const payload = dataArray[1];
			// biome-ignore lint/style/noNonNullAssertion: d
			const packetName = ID_TO_NAME[packetId]! as keyof typeof SPACKET_MAP;

			switch (packetName) {
				case "SPacketLoginStart": {
					console.log(
						"[Socket] Login started by client. Sending JoinGame packet...",
					);
					const clientVersion = payload?.clientVersion || "3.41.74";
					cl.send(
						new CPacketJoinGame({
							canConnect: true,
							gamemode: "creative",
							name: "Player",
							tick: 0,
							dimension: 0,
							enablePlayerCollision: true,
							serverInfo: {
								serverId: "local-1-1",
								serverName: "Local Server",
								serverVersion: clientVersion,
								serverCategory: "survival",
								accessControl: "public",
								startTime: 0n,
								worldType: "flat",
								pvpEnabled: false,
								cheats: "all",
							},
						}),
					);

					// Send a 5x5 grid of initial chunks around spawn
					console.log("[Socket] Sending initial flat grass chunks...");
					for (let cx = -2; cx <= 2; cx++) {
						for (let cz = -2; cz <= 2; cz++) {
							cl.send(createFlatChunk(cx, cz));
						}
					}

					// Send time update (make it noon so it's bright)
					console.log("[Socket] Sending time update (noon)...");
					cl.send(
						new CPacketTimeUpdate({
							totalTime: 6000,
							worldTime: 6000,
						}),
					);

					// Spawn the player at (0, 70, 0)
					console.log("[Socket] Sending player spawn position...");
					cl.send(
						new CPacketPlayerPosLook({
							x: SPAWN_POS.x,
							y: SPAWN_POS.y,
							z: SPAWN_POS.z,
							yaw: 0,
							pitch: 0,
						}),
					);
					return;
				}
				case "SPacketRequestChunk": {
					const x = payload?.x ?? 0;
					const z = payload?.z ?? 0;
					console.log(
						`[Socket] Generating requested chunk at X: ${x}, Z: ${z}`,
					);
					cl.send(createFlatChunk(x, z));
					return;
				}
				case "SPacketPing": {
					const timeVal = payload?.time ? BigInt(payload.time) : 0n;
					cl.send(new CPacketPong({ time: timeVal, mspt: 50, tick: 0 }));
					return;
				}
				case "SPacketPlayerInput": {
					const pl = payload as SPacketPlayerInput;
					const nextPos = simulate(player.physics, pl);
					const np = nextPos ?? player.physics.pos;
					const reconcile = new CPacketPlayerReconciliation({
						lastProcessedInput: pl.sequenceNumber,
						pitch: pl.pitch,
						yaw: pl.yaw,
						reset: false,
						x: np.x,
						y: np.y,
						z: np.z,
					});
					if (nextPos) {
						player.physics.pos.copy(nextPos);
					} else {
						reconcile.reset = true;
						// failed to simulate, don't let the client (possibly) abuse this.
					}
					const {
						x: cX,
						y: cY,
						z: cZ,
					} = pl.pos as { x: number; y: number; z: number };
					const serverDistance = np.distanceTo({
						x: cX,
						y: cY,
						z: cZ,
					});
					if (serverDistance > TOLERANCE) {
						reconcile.reset = true;
					}
					const resetting = reconcile.reset ?? false;
					cl.send(
						new CPacketMessage({
							text: `\\${resetting ? "red" : "green"}\\Server distance\\reset\\: \\yellow\\${serverDistance}\\reset\\`,
						}),
					);
					cl.send(reconcile);
					return;
				}
				case "SPacketPlayerPosLook":
					break;
				case "SPacketAnalytics":
					break;
				case "SPacketEntityAction":
					break;
				case "SPacketPlaceBlock":
					break;
				case "SPacketAdminAction":
				case "SPacketClickWindow":
				case "SPacketCloseWindow":
				case "SPacketConfirmTransaction":
				case "SPacketEnchantItem":
				case "SPacketHeldItemChange":
				case "SPacketMessage":
				case "SPacketOpenShop":
				case "SPacketPlayerAbilities":
				case "SPacketPlayerAction":
				case "SPacketRespawn":
				case "SPacketTabComplete":
				case "SPacketUpdateSign":
				case "SPacketUseEntity":
				case "SPacketUpdateCommandBlock":
				case "SPacketQueueNext":
					break;
				case "SPacketBreakBlock":
					break;
				case "SPacketClick":
					break;
				case "SPacketCraftItem":
					break;
				case "SPacketUpdateInventory":
					break;
				case "SPacketUseItem":
					break;
				default:
					console.warn("Unhandled packet:", packetName, payload);
					return;
			}
		} else if (
			typeof d === "object" &&
			d !== null &&
			"t" in d &&
			"d" in d &&
			d.t === 0 &&
			d.d === null
		) {
			// Engine.io connection handshake (respond only with sid)
			cl.send(
				{
					// @ts-expect-error: It's private, but I need to use it
					sid: socket.id as string,
					pid: null,
				},
				{ packetType: 0 },
			);
			console.log("[Socket] Engine.io handshake completed.");
		} else {
			console.log("[Socket] Received unknown format:", d);
		}
	});
	cl.on("close", () => {
		console.log("disconnected");
	});
});

httpsServer.listen(3002, () => {
	console.log("Server @ https://localhost:3002");
});
