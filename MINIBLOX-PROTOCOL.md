# Miniblox Protocol

Not documenting all the packets, just how they serialize / deserialize packets.

## Decoding (S2C)

```js
import { decompress } from "brotli";
import { decode } from "@msgpack/msgpack";

class ClientDecoder extends Decoder {
	async add(body) {
        try {
            const metaHead = new Uint8Array(body)[0]
                , protobufMsg = metaHead & 1;
            let content = new Uint8Array(body, 1, body.byteLength - 1);
            content = content.slice(1);
            if (protobufMsg) {
                const packetID = metaHead >> 2, compressed = metaHead & 2, packet = ID_TO_PACKET[packetID];
                compressed && (content = decompress(content)); // brotli
                const bin = packet.fromBinary(content); // protobuf
                packet.typeName === "ClientBoundCombined" ? bin.packets.forEach(pkt => {
                    this.emit("decoded", {
                        type: 2,
                        nsp: "/",
                        data: [pkt.packet.case, pkt.packet.value]
                    })
                }) : this.emit("decoded", {
                    type: 2,
                    nsp: "/",
                    data: [packet.typeName, bin]
                })
            } else {
                const packetType = metaHead >> 5 & 7;
                this.emit("decoded", {
                    type: packetType,
                    nsp: "/",
                    data: decode(content) // messagepack
                })
            }
        } catch (et) {
            console.error("ClientDecoder.add", et)
        }
	}
}
```

## Encoding (S2C)

can't be asked to figure it out, used Gemini for ts.
```js
import { compress } from "brotli";
import { encode } from "@msgpack/msgpack";

class ServerEncoder {
    encode(packetName, payload, useProtobuf = true, useCompression = false) {
        let metaHead = 0;
        let content;

        if (useProtobuf) {
            // 1. Set the Protobuf flag (bit 0)
            metaHead |= 1;

            // 2. Set the Compression flag (bit 1)
            if (useCompression) metaHead |= 2;

            // 3. Shift Packet ID into place (starts at bit 2)
            const packetID = NAME_TO_ID[packetName];
            metaHead |= (packetID << 2);

            const packet = ID_TO_PACKET[packetID];
            content = packet.toBinary(payload);

            if (useCompression) {
                content = compress(content); // Brotli
            }
        } else {
            // 1. Protobuf flag is 0 (MessagePack mode)
            // 2. Shift MessagePack packet type into place (bits 5-7)
            const packetType = payload.type || 2; 
            metaHead |= (packetType << 5);

            content = encode(payload.data);
        }

        // Miniblox format: [metaHead] [0x00 separator/padding] [content]
        const finalPacket = new Uint8Array(2 + content.byteLength);
        finalPacket[0] = metaHead;
        finalPacket[1] = 0; // The content.slice(1) in decoder skips this byte
        finalPacket.set(new Uint8Array(content), 2);

        return finalPacket.buffer;
    }
}
```

## Encoding (C2S)

```js
// literally just MessagePack
import { encode } from "@msgpack/msgpack";

class ClientEncoder {
	encode(data) {
	    return (
			data.type === 2 && data.data[1] && data.data[1].toJson && (data.data[1] = data.data[1].toJson(),
				data.data[0] = NAME_TO_ID[data.data[0]]),
			[encode(data)]);
	}
}
```
