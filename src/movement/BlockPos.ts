import { Box3, Vector3, type Vector3Like } from "three";
import { PBBlockPos } from "../../gen/protocol2_pb.js";
import { CELL_WIDTH } from "./consts.js";

function* blockPosIterator(miV: BlockPos, maV: BlockPos) {
	const min = new BlockPos(
		Math.min(miV.x, maV.x),
		Math.min(miV.y, maV.y),
		Math.min(miV.z, maV.z),
	);
	const max = new BlockPos(
		Math.max(miV.x, maV.x),
		Math.max(miV.y, maV.y),
		Math.max(miV.z, maV.z),
	);
	let current = min;
	while (true) {
		yield current;
		if (current.equals(max)) return;
		let x = current.x;
		let y = current.y;
		let z = current.z;
		if (x < max.x) {
			x++;
		} else if (y < max.y) {
			x = min.x;
			y++;
		} else if (z < max.z) {
			x = min.x;
			y = min.y;
			z++;
		}
		current = new BlockPos(x, y, z);
	}
}

export default class BlockPos {
	static ORIGIN = new BlockPos(0, 0, 0);
	constructor(
		public x: number,
		public y: number,
		public z: number,
	) {
		x = Math.round(x);
		y = Math.round(y);
		z = Math.round(z);
	}

	getX() {
		return this.x;
	}
	getY() {
		return this.y;
	}
	getZ() {
		return this.z;
	}
	static fromVector(vec: Vector3Like) {
		return new BlockPos(vec.x, vec.y, vec.z);
	}
	static fromJSON(data: { x?: number; y?: number; z?: number }) {
		return new BlockPos(data.x || 0, data.y || 0, data.z || 0);
	}
	static fromProto(bp: PBBlockPos) {
		return new BlockPos(Number(bp.x), Number(bp.y), Number(bp.z));
	}
	static fromString(s: `${number},${number},${number}`) {
		const [x, y, z] = s.split(",").map((y) => parseInt(y, 10));
		if (x === undefined || y === undefined || z === undefined)
			throw new Error(
				`Improperly formatted BlockPos string. expected 'x,y,z', got '${s}'`,
			);
		return new BlockPos(x, y, z);
	}
	toVec3() {
		return new Vector3(this.x, this.y, this.z);
	}
	toArray() {
		return [this.x, this.y, this.z];
	}
	static fromArray(arr: [number, number, number]) {
		return new BlockPos(arr[0], arr[1], arr[2]);
	}
	static fromEntity(e: { pos: Vector3 }) {
		return new BlockPos(e.pos.x, e.pos.y, e.pos.z);
	}
	toAABB() {
		return new Box3().setFromCenterAndSize(
			new Vector3(this.x + 0.5, this.y + 0.5, this.z + 0.5),
			new Vector3(0.5, 0.5, 0.5),
		);
	}
	set(x: number, y: number, z: number) {
		this.x = Math.floor(x);
		this.y = Math.floor(y);
		this.z = Math.floor(z);
	}
	add(x: number, y: number, z: number) {
		return x === 0 && y === 0 && z === 0
			? this
			: new BlockPos(this.x + x, this.y + y, this.z + z);
	}
	subtract(x: number, y: number, z: number) {
		return x === 0 && y === 0 && z === 0
			? this
			: new BlockPos(this.x - x, this.y - y, this.z - z);
	}
	cellPos() {
		return [
			Math.floor(this.x / CELL_WIDTH),
			Math.floor(this.y / CELL_WIDTH),
			Math.floor(this.z / CELL_WIDTH),
		] as const;
	}
	up(n = 1) {
		return n === 0 ? this : new BlockPos(this.x, this.y + n, this.z);
	}
	down(n = 1) {
		return n === 0 ? this : new BlockPos(this.x, this.y - n, this.z);
	}
	north(n = 1) {
		return n === 0 ? this : new BlockPos(this.x, this.y, this.z - n);
	}
	south(n = 1) {
		return n === 0 ? this : new BlockPos(this.x, this.y, this.z + n);
	}
	east(n = 1) {
		return n === 0 ? this : new BlockPos(this.x + n, this.y, this.z);
	}
	west(n = 1) {
		return n === 0 ? this : new BlockPos(this.x - n, this.y, this.z);
	}
	distanceTo(other: BlockPos) {
		return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
	}
	distanceToSquared(other: BlockPos) {
		return (
			(this.x - other.x) ** 2 +
			(this.y - other.y) ** 2 +
			(this.z - other.z) ** 2
		);
	}
	// offset(dir: EnumFacing, h = 1) {
	// 	const p = dir.directionVec;
	// 	return new BlockPos(this.x + p.x * h, this.y + p.y * h, this.z + p.z * h);
	// }
	equals(other: BlockPos) {
		return this.x === other.x && this.y === other.y && this.z === other.z;
	}
	toProto() {
		return new PBBlockPos({ x: this.x, y: this.y, z: this.z });
	}
	toString() {
		return `${this.x},${this.y},${this.z}` as const;
	}
	static getAllInBoxMutable(min: BlockPos, max: BlockPos) {
		const all = [];
		for (let x = min.x; x <= max.x; x++)
			for (let y = min.y; y <= max.y; y++)
				for (let z = min.z; z <= max.z; z++) all.push(new BlockPos(x, y, z));
		return all;
	}
	clone() {
		return new BlockPos(this.x, this.y, this.z);
	}
	static iterator(miV: BlockPos, maV: BlockPos) {
		return { [Symbol.iterator]: () => blockPosIterator(miV, maV) };
	}
}
