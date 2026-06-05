export enum AttributeOperation {
	ADD_NUMBER = 0,
	ADD_SCALAR = 1,
	MULTIPLY_TOTAL = 2,
}

export class AttributeModifier {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly amount: number,
		public readonly operation: AttributeOperation,
	) {}
}
export class AttributeInstance {
	private baseValue: number;
	private modifiers = new Map<string, AttributeModifier>();

	constructor(baseValue: number) {
		this.baseValue = baseValue;
	}

	getBaseValue(): number {
		return this.baseValue;
	}

	setBaseValue(value: number): void {
		this.baseValue = value;
	}

	applyModifier(modifier: AttributeModifier): void {
		this.modifiers.set(modifier.id, modifier);
	}

	removeModifier(id: string): void {
		this.modifiers.delete(id);
	}

	getModifier(id: string): AttributeModifier | undefined {
		return this.modifiers.get(id);
	}

	getAttributeValue(): number {
		let value = this.baseValue;

		// operation 0
		for (const mod of this.modifiers.values()) {
			if (mod.operation === AttributeOperation.ADD_NUMBER) {
				value += mod.amount;
			}
		}

		// operation 1
		let op1 = value;
		for (const mod of this.modifiers.values()) {
			if (mod.operation === AttributeOperation.ADD_SCALAR) {
				op1 += value * mod.amount;
			}
		}

		// operation 2
		let result = op1;
		for (const mod of this.modifiers.values()) {
			if (mod.operation === AttributeOperation.MULTIPLY_TOTAL) {
				result *= 1 + mod.amount;
			}
		}

		return result;
	}
}
