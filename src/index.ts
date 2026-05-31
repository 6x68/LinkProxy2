import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { Server, type Socket } from "engine.io";
import Client from "./client";
import {
	CPacketConfirmTransaction,
	CPacketJoinGame,
} from "../gen/protocol2_pb";

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

io.on("connection", (socket: Socket) => {
	const cl = new Client(socket);

	cl.on("data", (d) => {
		if (
			typeof d === "object" &&
			d !== null &&
			"t" in d &&
			"d" in d &&
			d.t === 0 &&
			d.d === null
		) {
			cl.send({
				// @ts-expect-error: It's private, but I need to use it
				sid: socket.id as string,
				pid: null,
			});
			cl.send(
				new CPacketJoinGame({
					canConnect: false,
					errorMessage: "no cat found",
				}),
			);
			// cl.disconnect("You have been kicked from this planet by cpn");
		} else {
			console.log("got data:", d);
		}
	});

	cl.on("close", () => {
		console.log("disconnected");
	});
});

httpsServer.listen(3002, () => {
	console.log("Server @ https://localhost:3002");
});
