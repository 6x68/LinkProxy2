import { type Box3, Vector3 } from "three";
import BlockPos from "../BlockPos.js";
import Blocks, { BlockLiquid } from "../blocks.js";
import type { PhysicsPlayer } from "../move.js";
import type { Material } from "./material.js";

export default function handleMaterialAcceleration(
	bb: Box3,
	_: Material,
	plr: PhysicsPlayer,
) {
	const g = Math.floor(bb.min.x);
	const y = Math.floor(bb.max.x + 1);
	const x = Math.floor(bb.min.y);
	const S = Math.floor(bb.max.y + 1);
	const b = Math.floor(bb.min.z);
	const v = Math.floor(bb.max.z + 1);
	let w = false;
	let k = new Vector3(0, 0, 0);
	const E = new BlockPos(0, 0, 0);
	const world = plr.world;
	for (let T = x; T < S; ++T) {
		for (let C = g; C < y; ++C) {
			for (let A = b; A < v; ++A) {
				E.set(C, T, A);
				const R = world.getBlockState(E);
				const L = R.block;
				if (L.name === "liquid") {
					const D =
						T + 1 - BlockLiquid.getLiquidHeightPercent(R.getProp("level"));
					if (S >= D) {
						w = true;
						k = L.modifyAcceleration(world, E, plr, k);
						if (L === Blocks.lava) {
							plr.inLava = true;
						}
						if (k.length() > 0) {
							k = k.normalize();
							const F = 0.014;
							plr.motion.x += k.x * F;
							plr.motion.y += k.y * F;
							plr.motion.z += k.z * F;
						}
						return true;
					}
				}
			}
		}
	}
	return w;
}
