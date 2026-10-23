/**
 * Snowflake IDs: 64-bit (or 63-bit) integers made of a timestamp, a worker id, a process id and a
 * per-millisecond sequence, so they are unique and sort by creation time.
 *
 * Twitter / Discord layout (the default):
 * ```
 * 64                                          22     17     12          0
 *  000000111011000111100001101001000101000000  00001  00000  000000000000
 *           milliseconds since the epoch       worker  process  increment
 * ```
 *
 * A drop-in successor to `@sapphire/snowflake` that, on one generator, guarantees unique and
 * increasing IDs: the sequence restarts every millisecond, and when it runs out (more than 4096
 * IDs in a millisecond) or the clock goes back, generation carries on from the last millisecond
 * used instead of repeating or going backwards. Out-of-range input throws instead of being masked.
 */

/** A point in time: milliseconds since the Unix epoch, or a Date. */
export type TimeInput = number | bigint | Date

/** Something that becomes a non-negative integer. */
export type IntegerInput = number | bigint

export interface SnowflakeBits {
	/** Bits of the worker id. @default 5 */
	worker?: number
	/** Bits of the process id. @default 5 */
	process?: number
	/** Bits of the per-millisecond sequence. @default 12 */
	increment?: number
	/**
	 * Width of the whole id. 64 is the Twitter / Discord layout; 63 keeps every id positive in a
	 * signed 64-bit integer, such as PostgreSQL's `bigint` or Java's `long`. The timestamp gets the bits left over.
	 * @default 64
	 */
	total?: 63 | 64
}

export interface SnowflakeOptions {
	/** Where timestamps count from. Pick one close to today: the timestamp field fills up after 2^timestampBits ms. */
	epoch: TimeInput
	/** Default worker id for generated ids. Give every generator that runs at the same time its own worker / process pair. @default 0 */
	workerId?: IntegerInput
	/** Default process id for generated ids. @default 1 */
	processId?: IntegerInput
	/** Field widths. */
	bits?: SnowflakeBits
	/** The clock, in milliseconds since the Unix epoch. Replace it in tests. @default Date.now */
	clock?: () => number | bigint
}

export interface SnowflakeGenerateOptions {
	/**
	 * Timestamp of the id. Without it the clock is used, and ids are guaranteed unique and increasing.
	 * With it, the id belongs to that millisecond: it continues the sequence when it is the latest
	 * millisecond used, and starts at 0 for an earlier one (which doesn't move the generator back).
	 * @default the clock
	 */
	timestamp?: TimeInput
	/**
	 * Use this sequence value as is (0 to 4095 by default), outside the generator's own sequence.
	 * Uniqueness is then up to you.
	 */
	increment?: IntegerInput
	/** Worker id for this id only. */
	workerId?: IntegerInput
	/** Process id for this id only. */
	processId?: IntegerInput
}

/** Object returned by {@link Snowflake.deconstruct}. */
export interface DeconstructedSnowflake {
	/** The id as a bigint. */
	id: bigint
	/** Milliseconds since the Unix epoch, when the id was made. */
	timestamp: bigint
	workerId: bigint
	processId: bigint
	increment: bigint
	/** The epoch the generator counts from. */
	epoch: bigint
}

/** The resolved field widths and limits of a {@link Snowflake}. */
export interface SnowflakeLayout {
	totalBits: number
	timestampBits: number
	workerBits: number
	processBits: number
	incrementBits: number
	maxWorkerId: bigint
	maxProcessId: bigint
	maxIncrement: bigint
	/** Largest timestamp offset (ms after the epoch) that still fits. */
	maxTimestampOffset: bigint
}

/** The largest worker id in the default layout. */
export const MaximumWorkerId = 0b11111n
/** The largest process id in the default layout. */
export const MaximumProcessId = 0b11111n
/** The largest per-millisecond sequence value in the default layout. */
export const MaximumIncrement = 0b111111111111n

const mask = (bits: number) => (1n << BigInt(bits)) - 1n

function toBigInt(value: unknown, name: string): bigint {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new RangeError(`"${name}" must be a safe integer (received ${value})`)
		return BigInt(value)
	}
	throw new TypeError(`"${name}" must be a number or bigint (received ${typeof value})`)
}

function toTime(value: unknown, name: string): bigint {
	if (value instanceof Date) {
		const time = value.getTime()
		if (Number.isNaN(time)) throw new RangeError(`"${name}" is an invalid Date`)
		return BigInt(time)
	}
	if (typeof value === 'number' || typeof value === 'bigint') return toBigInt(value, name)
	throw new TypeError(`"${name}" must be a number, bigint, or Date (received ${typeof value})`)
}

function inRange(value: IntegerInput, max: bigint, name: string): bigint {
	const v = toBigInt(value, name)
	if (v < 0n || v > max) throw new RangeError(`"${name}" must be between 0 and ${max} (received ${v})`)
	return v
}

/** A snowflake as a bigint: from a bigint, a safe integer, or a decimal string. */
function toId(id: unknown): bigint {
	let value: bigint
	if (typeof id === 'bigint') value = id
	else if (typeof id === 'string') {
		if (!/^\d+$/.test(id)) throw new SyntaxError(`"${id}" is not a snowflake: expected decimal digits`)
		value = BigInt(id)
	} else if (typeof id === 'number') value = toBigInt(id, 'id')
	else throw new TypeError(`A snowflake must be a bigint or decimal string (received ${typeof id})`)
	if (value < 0n) throw new RangeError(`A snowflake can't be negative (received ${value})`)
	return value
}

export class Snowflake {
	readonly #epoch: bigint
	readonly #epochNumber: number
	readonly #layout: SnowflakeLayout
	readonly #clock: () => number | bigint
	readonly #shiftTimestamp: bigint
	readonly #shiftWorker: bigint
	readonly #shiftProcess: bigint
	#workerId: bigint
	#processId: bigint
	/** Last millisecond (absolute) the sequence was used for, and the sequence value used. */
	#lastTimestamp = -1n
	#sequence = 0n

	/**
	 * @param options the epoch alone (as `@sapphire/snowflake` takes it), or {@link SnowflakeOptions}
	 */
	public constructor(options: TimeInput | SnowflakeOptions) {
		const opts: SnowflakeOptions =
			typeof options === 'object' && !(options instanceof Date) ? options : { epoch: options }

		this.#epoch = toTime(opts.epoch, 'epoch')
		if (this.#epoch < 0n) throw new RangeError(`"epoch" can't be before 1970 (received ${this.#epoch})`)
		this.#epochNumber = Number(this.#epoch)
		this.#clock = opts.clock ?? (() => Date.now())

		const totalBits = opts.bits?.total ?? 64
		if (totalBits !== 63 && totalBits !== 64) throw new RangeError(`"bits.total" must be 63 or 64 (received ${totalBits})`)
		const workerBits = opts.bits?.worker ?? 5
		const processBits = opts.bits?.process ?? 5
		const incrementBits = opts.bits?.increment ?? 12
		for (const [name, bits] of [['worker', workerBits], ['process', processBits], ['increment', incrementBits]] as const) {
			if (!Number.isInteger(bits) || bits < 0) throw new RangeError(`"bits.${name}" must be a non-negative integer (received ${bits})`)
		}
		if (incrementBits < 1) throw new RangeError('"bits.increment" must be at least 1')
		const timestampBits = totalBits - workerBits - processBits - incrementBits
		// below ~35 bits the id space runs out within a year: almost certainly a mistake
		if (timestampBits < 35) throw new RangeError(`Only ${timestampBits} bits left for the timestamp: use fewer worker / process / increment bits`)

		this.#layout = Object.freeze({
			totalBits,
			timestampBits,
			workerBits,
			processBits,
			incrementBits,
			maxWorkerId: mask(workerBits),
			maxProcessId: mask(processBits),
			maxIncrement: mask(incrementBits),
			maxTimestampOffset: mask(timestampBits)
		})
		this.#shiftProcess = BigInt(incrementBits)
		this.#shiftWorker = this.#shiftProcess + BigInt(processBits)
		this.#shiftTimestamp = this.#shiftWorker + BigInt(workerBits)

		this.#workerId = inRange(opts.workerId ?? 0n, this.#layout.maxWorkerId, 'workerId')
		this.#processId = inRange(opts.processId ?? (this.#layout.maxProcessId >= 1n ? 1n : 0n), this.#layout.maxProcessId, 'processId')
	}

	/** The epoch, as a bigint. */
	public get epoch(): bigint {
		return this.#epoch
	}

	/** The epoch, as a number. */
	public get epochNumber(): number {
		return this.#epochNumber
	}

	/** Field widths and limits. */
	public get layout(): Readonly<SnowflakeLayout> {
		return this.#layout
	}

	/** The worker id used by default. */
	public get workerId(): bigint {
		return this.#workerId
	}

	/** Sets the default worker id. Throws a RangeError when it doesn't fit (it used to be silently masked). */
	public set workerId(value: IntegerInput) {
		this.#workerId = inRange(value, this.#layout.maxWorkerId, 'workerId')
	}

	/** The process id used by default. */
	public get processId(): bigint {
		return this.#processId
	}

	/** Sets the default process id. Throws a RangeError when it doesn't fit (it used to be silently masked). */
	public set processId(value: IntegerInput) {
		this.#processId = inRange(value, this.#layout.maxProcessId, 'processId')
	}

	/**
	 * Generates a snowflake.
	 *
	 * Without options, ids from one generator are unique and strictly increasing: the sequence
	 * restarts each millisecond; past its last value, or when the clock goes back, the id takes the
	 * next millisecond instead (ids may then run slightly ahead of the clock until it catches up).
	 */
	public generate(options: SnowflakeGenerateOptions = {}): bigint {
		const workerId = options.workerId === undefined ? this.#workerId : inRange(options.workerId, this.#layout.maxWorkerId, 'workerId')
		const processId = options.processId === undefined ? this.#processId : inRange(options.processId, this.#layout.maxProcessId, 'processId')

		let timestamp: bigint
		let increment: bigint

		if (options.increment !== undefined) {
			// a fixed increment: exactly the id asked for, outside the generator's sequence
			increment = inRange(options.increment, this.#layout.maxIncrement, 'increment')
			timestamp = options.timestamp === undefined ? this.#now() : toTime(options.timestamp, 'timestamp')
		} else if (options.timestamp !== undefined) {
			timestamp = toTime(options.timestamp, 'timestamp')
			// check the range before touching the sequence, so a rejected timestamp leaves no trace
			this.#offset(timestamp)
			if (timestamp < this.#lastTimestamp) {
				// an earlier millisecond: its first id, without moving the generator back
				increment = 0n
			} else {
				if (timestamp === this.#lastTimestamp) {
					if (this.#sequence === this.#layout.maxIncrement) {
						throw new RangeError(`No more ids for timestamp ${timestamp}: all ${this.#layout.maxIncrement + 1n} have been used`)
					}
					this.#sequence++
				} else {
					this.#sequence = 0n
				}
				this.#lastTimestamp = timestamp
				increment = this.#sequence
			}
		} else {
			timestamp = this.#next()
			increment = this.#sequence
		}

		return this.#compose(timestamp, workerId, processId, increment)
	}

	/** {@link generate}, as a decimal string: ready for JSON, which can't hold a bigint. */
	public generateString(options?: SnowflakeGenerateOptions): string {
		return this.generate(options).toString()
	}

	/** Splits a snowflake into its fields. */
	public deconstruct(id: string | bigint): DeconstructedSnowflake {
		const value = this.#checkWidth(toId(id))
		const { maxWorkerId, maxProcessId, maxIncrement } = this.#layout
		return {
			id: value,
			timestamp: (value >> this.#shiftTimestamp) + this.#epoch,
			workerId: (value >> this.#shiftWorker) & maxWorkerId,
			processId: (value >> this.#shiftProcess) & maxProcessId,
			increment: value & maxIncrement,
			epoch: this.#epoch
		}
	}

	/** Alias for {@link deconstruct}, bound to this generator: it still works detached (`const { decode } = snowflake`). */
	public readonly decode = (id: string | bigint): DeconstructedSnowflake => this.deconstruct(id)

	/**
	 * The timestamp stored in a snowflake, in milliseconds since the Unix epoch. Computed with
	 * bigints: going through a floating-point number could be a millisecond off.
	 */
	public timestampFrom(id: string | bigint): number {
		return Number(this.#checkWidth(toId(id)) >> this.#shiftTimestamp) + this.#epochNumber
	}

	/** The smallest id possible at a timestamp: for "ids created from this time on" queries. */
	public minIdAt(timestamp: TimeInput): bigint {
		return this.#offset(toTime(timestamp, 'timestamp')) << this.#shiftTimestamp
	}

	/** The largest id possible at a timestamp: for "ids created up to this time" queries. */
	public maxIdAt(timestamp: TimeInput): bigint {
		return (this.#offset(toTime(timestamp, 'timestamp')) << this.#shiftTimestamp) | mask(Number(this.#shiftTimestamp))
	}

	/**
	 * Orders two snowflakes: -1 if `a` is older than `b`, 0 if they are the same, 1 if `a` is newer.
	 * Works for any mix of bigints and decimal strings, leading zeros included.
	 */
	public static compare(a: string | bigint, b: string | bigint): -1 | 0 | 1 {
		const x = toId(a)
		const y = toId(b)
		return x === y ? 0 : x < y ? -1 : 1
	}

	/** The next millisecond for an automatic id, with the sequence set for it. */
	#next(): bigint {
		const now = this.#now()
		if (now > this.#lastTimestamp) {
			this.#lastTimestamp = now
			this.#sequence = 0n
		} else if (this.#sequence < this.#layout.maxIncrement) {
			// same millisecond, or the clock went back: keep counting in the last one used
			this.#sequence++
		} else {
			// sequence used up: borrow the next millisecond rather than repeat an id or wait
			this.#lastTimestamp++
			this.#sequence = 0n
		}
		return this.#lastTimestamp
	}

	#now(): bigint {
		return toTime(this.#clock(), 'clock()')
	}

	/** Milliseconds after the epoch, checked to fit the timestamp field. */
	#offset(timestamp: bigint): bigint {
		const offset = timestamp - this.#epoch
		if (offset < 0n) throw new RangeError(`Timestamp ${timestamp} is before the epoch (${this.#epoch})`)
		if (offset > this.#layout.maxTimestampOffset) {
			throw new RangeError(
				`Timestamp ${timestamp} is past the last one this layout can hold (${this.#epoch + this.#layout.maxTimestampOffset}): use a later epoch`
			)
		}
		return offset
	}

	#compose(timestamp: bigint, workerId: bigint, processId: bigint, increment: bigint): bigint {
		return (this.#offset(timestamp) << this.#shiftTimestamp) | (workerId << this.#shiftWorker) | (processId << this.#shiftProcess) | increment
	}

	#checkWidth(id: bigint): bigint {
		if (id > mask(this.#layout.totalBits)) throw new RangeError(`${id} is wider than ${this.#layout.totalBits} bits`)
		return id
	}
}
