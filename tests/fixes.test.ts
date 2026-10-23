// One test per issue found in @sapphire/snowflake 3.5.5, each failing there and passing here.
import { DiscordEpoch, Snowflake } from '../src'

const T = 1792700000000 // a fixed "now"

/** A generator on Discord's epoch with a clock under the test's control. */
function withClock(start = T) {
	let now = start
	const snowflake = new Snowflake({ epoch: DiscordEpoch, clock: () => now })
	return { snowflake, set: (ms: number) => (now = ms) }
}

const isStrictlyIncreasing = (ids: bigint[]) => ids.every((id, i) => i === 0 || id > ids[i - 1]!)

describe('1. more than 4096 ids in one millisecond', () => {
	test('no duplicates: 10,000 ids with a frozen clock', () => {
		const { snowflake } = withClock()
		const ids = Array.from({ length: 10_000 }, () => snowflake.generate())
		expect(new Set(ids).size).toBe(10_000) // sapphire: 5,000 ids already gave 904 duplicates
	})

	test('past the last sequence value, the id moves to the next millisecond', () => {
		const { snowflake } = withClock()
		const ids = Array.from({ length: 4097 }, () => snowflake.deconstruct(snowflake.generate()))
		expect(ids[4095]).toMatchObject({ timestamp: BigInt(T), increment: 4095n })
		expect(ids[4096]).toMatchObject({ timestamp: BigInt(T + 1), increment: 0n })
	})
})

describe('2. sequence restarts every millisecond, ids stay in order', () => {
	test('a new millisecond starts at increment 0', () => {
		const { snowflake, set } = withClock()
		snowflake.generate()
		snowflake.generate()
		set(T + 1)
		expect(snowflake.deconstruct(snowflake.generate()).increment).toBe(0n)
	})

	test('ids are strictly increasing across many milliseconds and bursts', () => {
		const { snowflake, set } = withClock()
		const ids: bigint[] = []
		for (let ms = 0; ms < 50; ms++) {
			set(T + ms)
			// bursts of up to 6000: some milliseconds overflow into the next
			for (let i = 0; i < (ms % 7) * 1000; i++) ids.push(snowflake.generate())
		}
		expect(isStrictlyIncreasing(ids)).toBe(true) // sapphire: wrapped to smaller ids inside a millisecond
	})
})

describe('3. clock going back', () => {
	test('ids keep increasing and never repeat when the clock jumps back', () => {
		const { snowflake, set } = withClock()
		const before = Array.from({ length: 3 }, () => snowflake.generate())
		set(T - 5_000) // e.g. an NTP correction
		const after = Array.from({ length: 3 }, () => snowflake.generate())
		const all = [...before, ...after]
		expect(isStrictlyIncreasing(all)).toBe(true)
		expect(new Set(all).size).toBe(6)
	})

	test('the timestamp holds at the last one used until the clock catches up', () => {
		const { snowflake, set } = withClock()
		snowflake.generate()
		set(T - 10)
		expect(snowflake.timestampFrom(snowflake.generate())).toBe(T)
		set(T + 3)
		expect(snowflake.timestampFrom(snowflake.generate())).toBe(T + 3)
	})
})

describe('4. timestampFrom is exact', () => {
	test('largest field values: no off-by-one from floating point', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		const id = snowflake.generate({ timestamp: T, workerId: 31n, processId: 31n, increment: 4095n })
		expect(snowflake.timestampFrom(id)).toBe(T) // sapphire: T + 1
	})

	test('agrees with deconstruct for many ids', () => {
		const { snowflake, set } = withClock()
		for (let i = 0; i < 2000; i++) {
			set(T + i * 977)
			const id = snowflake.generate({ workerId: BigInt(i % 32), processId: BigInt((i * 7) % 32) })
			expect(BigInt(snowflake.timestampFrom(id))).toBe(snowflake.deconstruct(id).timestamp)
		}
	})
})

describe('5. timestamps outside the layout', () => {
	test('before the epoch: throws (sapphire returned a negative id)', () => {
		expect(() => new Snowflake(DiscordEpoch).generate({ timestamp: Number(DiscordEpoch) - 1 })).toThrow(/before the epoch/)
	})

	test('past the last timestamp the layout holds: throws (sapphire returned an id wider than 64 bits)', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		const last = DiscordEpoch + snowflake.layout.maxTimestampOffset
		expect(snowflake.generate({ timestamp: last }) < 2n ** 64n).toBe(true)
		expect(() => snowflake.generate({ timestamp: last + 1n })).toThrow(/past the last one/)
	})

	test('a rejected timestamp leaves the generator untouched', () => {
		const { snowflake } = withClock()
		expect(() => snowflake.generate({ timestamp: 2n ** 62n })).toThrow(RangeError)
		expect(snowflake.timestampFrom(snowflake.generate())).toBe(T)
	})
})

describe('6. out-of-range worker / process ids', () => {
	test('worker 32 throws instead of becoming worker 0', () => {
		expect(() => new Snowflake({ epoch: DiscordEpoch, workerId: 32 })).toThrow(RangeError)
		expect(() => new Snowflake(DiscordEpoch).generate({ workerId: 32n })).toThrow(RangeError)
	})

	test('different workers never produce the same id', () => {
		const a = new Snowflake({ epoch: DiscordEpoch, workerId: 0, clock: () => T })
		const b = new Snowflake({ epoch: DiscordEpoch, workerId: 31, clock: () => T })
		const ids = [...Array.from({ length: 5000 }, () => a.generate()), ...Array.from({ length: 5000 }, () => b.generate())]
		expect(new Set(ids).size).toBe(10_000)
	})
})

describe('7. number inputs', () => {
	test('a number increment is used, not silently ignored', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		expect(snowflake.deconstruct(snowflake.generate({ timestamp: T, increment: 7 })).increment).toBe(7n)
	})

	test('number worker and process ids are accepted per call', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		expect(snowflake.deconstruct(snowflake.generate({ timestamp: T, workerId: 3, processId: 4 }))).toMatchObject({ workerId: 3n, processId: 4n })
	})

	test('unsafe numbers throw instead of losing precision', () => {
		expect(() => new Snowflake(DiscordEpoch).deconstruct(2 ** 60 as unknown as bigint)).toThrow(RangeError)
	})
})

describe('8. decode works detached', () => {
	test('const { decode } = snowflake; decode(id)', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		const { decode } = snowflake
		const id = snowflake.generate({ timestamp: T })
		// a plain call, with no `this`: sapphire throws here
		expect(decode(id).timestamp).toBe(BigInt(T))
		expect([id].map(snowflake.decode)[0]!.timestamp).toBe(BigInt(T))
	})
})

describe('9. per-process ids in the constructor', () => {
	test('workerId / processId can be given up front', () => {
		const snowflake = new Snowflake({ epoch: DiscordEpoch, workerId: 12, processId: 3, clock: () => T })
		expect(snowflake.deconstruct(snowflake.generate())).toMatchObject({ workerId: 12n, processId: 3n })
	})
})

describe('10. smaller issues', () => {
	test('generateString gives a JSON-safe decimal string', () => {
		const { snowflake } = withClock()
		const id = snowflake.generateString()
		expect(typeof id).toBe('string')
		expect(JSON.parse(JSON.stringify({ id })).id).toBe(id)
	})

	test('compare handles leading zeros (sapphire sorted "0099" after "100")', () => {
		expect(Snowflake.compare('0099', '100')).toBe(-1)
		expect(Snowflake.compare('000737141877803057244', 737141877803057244n)).toBe(0)
	})

	test('ids that are not decimal integers are rejected', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		expect(() => snowflake.deconstruct('12abc')).toThrow(SyntaxError)
		expect(() => snowflake.deconstruct(-5n)).toThrow(RangeError)
		expect(() => snowflake.deconstruct(2n ** 64n)).toThrow(/wider than 64 bits/)
	})
})

describe('63-bit layout (PostgreSQL bigint, Java long)', () => {
	test('every id stays below 2^63 up to the last timestamp', () => {
		const snowflake = new Snowflake({ epoch: DiscordEpoch, bits: { total: 63 } })
		const last = DiscordEpoch + snowflake.layout.maxTimestampOffset
		const id = snowflake.generate({ timestamp: last, workerId: 31n, processId: 31n, increment: 4095n })
		expect(id).toBe(2n ** 63n - 1n)
		expect(() => snowflake.generate({ timestamp: last + 1n })).toThrow(RangeError)
	})

	test('a 64-bit layout from the same epoch passes 2^63 halfway', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		const half = DiscordEpoch + (snowflake.layout.maxTimestampOffset + 1n) / 2n
		expect(snowflake.generate({ timestamp: half }) >= 2n ** 63n).toBe(true)
	})
})

describe('custom layouts', () => {
	test('10-bit machine id, 12-bit sequence, 41-bit timestamp in 63 bits', () => {
		const snowflake = new Snowflake({ epoch: DiscordEpoch, bits: { worker: 10, process: 0, increment: 12, total: 63 }, workerId: 1000, processId: 0 })
		expect(snowflake.layout).toMatchObject({ timestampBits: 41, maxWorkerId: 1023n, maxProcessId: 0n })
		const id = snowflake.generate({ timestamp: T })
		expect(snowflake.deconstruct(id)).toMatchObject({ timestamp: BigInt(T), workerId: 1000n, processId: 0n, increment: 0n })
	})

	test('a layout that leaves too few timestamp bits is refused', () => {
		expect(() => new Snowflake({ epoch: DiscordEpoch, bits: { worker: 15, process: 15 } })).toThrow(/bits left for the timestamp/)
	})
})

describe('range query helpers', () => {
	test('every id made at a millisecond sits between minIdAt and maxIdAt', () => {
		const { snowflake } = withClock()
		const ids = Array.from({ length: 100 }, () => snowflake.generate({ workerId: 31n, processId: 31n }))
		for (const id of ids) {
			expect(id >= snowflake.minIdAt(T) && id <= snowflake.maxIdAt(T)).toBe(true)
		}
		expect(snowflake.maxIdAt(T - 1)).toBeLessThan(snowflake.minIdAt(T))
	})
})

describe('explicit timestamps', () => {
	test('the same explicit timestamp continues the sequence instead of repeating', () => {
		const snowflake = new Snowflake(DiscordEpoch)
		const ids = Array.from({ length: 4096 }, () => snowflake.generate({ timestamp: T }))
		expect(new Set(ids).size).toBe(4096)
		expect(() => snowflake.generate({ timestamp: T })).toThrow(/No more ids for timestamp/)
	})

	test('an earlier explicit timestamp gives that millisecond\'s first id and does not move the generator back', () => {
		const { snowflake } = withClock()
		const latest = snowflake.generate()
		expect(snowflake.deconstruct(snowflake.generate({ timestamp: T - 100 })).increment).toBe(0n)
		expect(snowflake.generate()).toBeGreaterThan(latest)
	})
})
