import { EventEmitter } from "node:events";
import type { Message } from "@bufbuild/protobuf";
import { decode } from "@msgpack/msgpack";
import type { Socket } from "engine.io";
import { CPacketDisconnect } from "../gen/protocol2_pb.js";
import { type EncodeOptions, encode } from "./parser/encoder.js";

export interface ClientEvents {
	data: [object];
}

/** Represents a connected client. */
export default class Client extends EventEmitter<ClientEvents> {
	/** the underlying Socket for this connection. */
	readonly #socket: Socket;
	/** the socket's ID */
	readonly id: string;
	/** Constructs a client from a socket. */
	constructor(socket: Socket) {
		super();
		this.#socket = socket;
		this.#socket.on("message", this.#onData.bind(this));
		this.#socket.on("close", (a) => this.emit("close", a));
		this.id = (socket as unknown as Omit<Socket, "id"> & { id: string }).id;
	}
	get socket(): Socket {
		return this.#socket;
	}
	/** Handles data coming from the client. This is always MsgPack (Protobuf object -> object.toJSON -> MsgPack -> Sent), so we don't need anything else. */
	#onData(
		data:
			| string
			| ArrayLike<number>
			| ArrayBufferLike
			| ArrayBufferView<ArrayBufferLike>,
	) {
		if (typeof data === "string") {
			if (data === "0") {
				this.emit("data", { t: 0, d: null, n: "/" });
				return;
			}
			try {
				const parsed = JSON.parse(data);
				this.emit("data", parsed);
			} catch {
				this.disconnect("Invalid plaintext data received");
			}
			return;
		}

		let mp: object;
		try {
			mp = decode(data) as object;
		} catch (_) {
			this.disconnect("MessagePack decode error");
			return;
		}

		if (typeof mp !== "object" || mp == null) {
			this.disconnect(
				"MessagePack data isn't an object (or is null/undefined)",
			);
			return;
		}

		this.emit("data", mp);
	}
	send(packet: object | Message, options?: EncodeOptions) {
		const pkt = encode(packet, options);
		this.#socket.send(Buffer.from(pkt.buffer, pkt.byteOffset, pkt.byteLength));
		// this.#socket.send(packet instanceof Message ? packet.toBinary() : packet);
	}
	/** Disconnects the client with an optional reason, defaulting to `No reason provided`. */
	disconnect(reason: string = "No reason provided") {
		console.warn(`[Client] Disconnecting client. Reason: ${reason}`);
		if (reason)
			this.send(
				new CPacketDisconnect({
					reason: reason,
				}),
			);
		this.#socket.close(true);
	}
}
