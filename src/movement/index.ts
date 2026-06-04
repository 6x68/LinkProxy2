import type { Vector3 } from "three";
import type { SPacketPlayerInput } from "../../gen/protocol2_pb.js";
import type { PhysicsPlayer } from "./move.js";

/**
 *
 * @param player the player
 * @param param1 the input to simulate from
 * @returns where the player should go next.
 * @returns the next position. otherwise, the input didn't have the required fields.
 */
export function simulate(
	player: PhysicsPlayer,
	{ yaw, sprint, sneak, jump, up, down, left, right }: SPacketPlayerInput,
): Vector3 | undefined {
	if (
		yaw === undefined ||
		sprint === undefined ||
		sneak === undefined ||
		jump === undefined ||
		up === undefined ||
		down === undefined ||
		left === undefined ||
		right === undefined
	)
		return undefined;
	player.yaw = yaw;

	player.sprinting = sprint;
	player.sneak = sneak;
	player.jumping = jump;

	player.moveForward = (up ? -1 : 0) + (down ? 1 : 0);

	player.moveStrafe = (right ? 1 : 0) + (left ? -1 : 0);

	if (player.sneak) {
		player.moveForward *= 0.3;
		player.moveStrafe *= 0.3;
	}

	player.tick();

	return player.pos.clone();
}
