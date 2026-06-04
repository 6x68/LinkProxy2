export class Material {
	translucent = false;
	blocksMovement(): boolean {
		return true;
	}
	isLiquid() {
		return false;
	}
	isSolid(): boolean {
		return true;
	}
	setTranslucent(): this {
		this.translucent = true;
		return this;
	}
	isOpaque() {
		return this.translucent ? false : this.blocksMovement();
	}
}

export class MaterialLiquid extends Material {
	override blocksMovement() {
		return !1;
	}
	override isSolid() {
		return !1;
	}
}

export class MaterialLogic extends Material {
	override isSolid() {
		return !1;
	}
	override blocksMovement() {
		return !1;
	}
}

export class MaterialPortal extends Material {
	override isSolid() {
		return !1;
	}
	override blocksMovement() {
		return !1;
	}
}

export class MaterialTransparent$1 extends Material {
	override isSolid() {
		return !0;
	}
	override blocksMovement() {
		return !0;
	}
}

export class MaterialTransparent extends Material {
	override isSolid() {
		return !1;
	}
	override blocksMovement() {
		return !1;
	}
}
