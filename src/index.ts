import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { Server, type Socket } from "engine.io";
import GameServer from "./GameServer.js";
import { ENABLE_HTTPS } from "./config.js";

const httpsServer = ENABLE_HTTPS
	? createServer({
			key: readFileSync("./certs/key.pem"),
			cert: readFileSync("./certs/cert.pem"),
		})
	: createServer();

const io = new Server({
	cors: { origin: "https://miniblox.io" },
	transports: ["websocket"],
});

io.attach(httpsServer, { path: "/socket.io" });

const game = new GameServer();

io.on("connection", (socket: Socket) => {
	game.addClient(socket);
});

httpsServer.listen(3002, () => {
	console.log("Server @ https://localhost:3002");
});
