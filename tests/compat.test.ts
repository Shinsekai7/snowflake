// @sapphire/snowflake's own test suite, ported: every expected id and field is unchanged.
// Where the original asserted the bugs this library fixes (silent masking, a free-running
// counter), the test now asserts the fixed behaviour and says so.
import { type DeconstructedSnowflake, DiscordSnowflake, Snowflake, TwitterSnowflake } from '../src'

// 2020-01-01
const sampleEpoch = 1577836800000n

beforeAll(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2020-01-01T00:00:00.000+00:00'))
})

afterAll(() => {
	vi.useRealTimers()
})

describe('Snowflake (ported from @sapphire/snowflake)', () => {
	describe('processId', () => {
		test('GIVEN default THEN returns 1n', () => {
			expect(new Snowflake(sampleEpoch).processId).toBe(1n)
		})

		test.each([15, 15n])('GIVEN valid value (%s) THEN returns same value as bigint', (value) => {
			const snowflake = new Snowflake(sampleEpoch)
			snowflake.processId = value
			expect(snowflake.processId).toBe(15n)
		})

		// was: masked to 8n
		test.each([4200, 4200n, -1])('GIVEN out-of-range value (%s) THEN throws instead of masking', (value) => {
			const snowflake = new Snowflake(sampleEpoch)
			expect(() => (snowflake.processId = value)).toThrow(RangeError)
			expect(snowflake.processId).toBe(1n)
		})
	})

	describe('workerId', () => {
		test('GIVEN default THEN returns 0n', () => {
			expect(new Snowflake(sampleEpoch).workerId).toBe(0n)
		})

		test.each([15, 15n])('GIVEN valid value (%s) THEN returns same value as bigint', (value) => {
			const snowflake = new Snowflake(sampleEpoch)
			snowflake.workerId = value
			expect(snowflake.workerId).toBe(15n)
		})

		// was: masked to 8n
		test.each([4200, 4200n, -1])('GIVEN out-of-range value (%s) THEN throws instead of masking', (value) => {
			const snowflake = new Snowflake(sampleEpoch)
			expect(() => (snowflake.workerId = value)).toThrow(RangeError)
			expect(snowflake.workerId).toBe(0n)
		})
	})

	describe('epoch', () => {
		test.each([sampleEpoch, Number(sampleEpoch), new Date(Number(sampleEpoch))])('GIVEN %s THEN returns 1577836800000n', (value) => {
			expect(new Snowflake(value).epoch).toBe(sampleEpoch)
		})
	})

	describe('generate', () => {
		test('GIVEN timestamp as number THEN returns predefined snowflake', () => {
			expect(new Snowflake(sampleEpoch).generate({ timestamp: 2524608000000 }).toString()).toBe('3971046231244804096')
		})

		test('GIVEN timestamp as Date THEN returns predefined snowflake', () => {
			expect(new Snowflake(sampleEpoch).generate({ timestamp: new Date(2524608000000) }).toString()).toBe('3971046231244804096')
		})

		test('GIVEN no options THEN returns predefined snowflake', () => {
			expect(new Snowflake(sampleEpoch).generate().toString()).toBe('4096')
		})

		test('GIVEN timestamp as NaN THEN throws', () => {
			expect(() => new Snowflake(sampleEpoch).generate({ timestamp: NaN })).toThrow(RangeError)
		})

		test('GIVEN timestamp as boolean THEN throws', () => {
			// @ts-expect-error testing fail case
			expect(() => new Snowflake(sampleEpoch).generate({ timestamp: true })).toThrowError(
				'"timestamp" must be a number, bigint, or Date (received boolean)'
			)
		})

		test('GIVEN multiple generate calls THEN generates distinct IDs', () => {
			const snowflake = new Snowflake(sampleEpoch)
			const ids = Array.from({ length: 10 }, () => snowflake.generate())
			expect(new Set(ids).size).toBe(ids.length)
		})

		test('GIVEN increment 2100n THEN returns predefined snowflake', () => {
			expect(new Snowflake(sampleEpoch).generate({ increment: 2100n }).toString()).toBe('6196')
		})

		// was: masked into range ('8191' for -1n, '5000' for 5000n)
		test.each([-1n, 5000n, 4096n])('GIVEN increment out of range (%s) THEN throws instead of masking', (increment) => {
			expect(() => new Snowflake(sampleEpoch).generate({ increment })).toThrow(RangeError)
		})

		// was: truncated ('106496' / '3411968')
		test('GIVEN overflowing processId or workerId THEN throws instead of truncating', () => {
			const snowflake = new Snowflake(sampleEpoch)
			expect(() => snowflake.generate({ processId: 0b1111_1010n })).toThrow(RangeError)
			expect(() => snowflake.generate({ workerId: 0b1111_1010n })).toThrow(RangeError)
		})
	})

	describe('deconstruct', () => {
		const expected: DeconstructedSnowflake = {
			id: 3971046231244935169n,
			timestamp: 2524608000000n,
			workerId: 1n,
			processId: 1n,
			increment: 1n,
			epoch: 1577836800000n
		}

		test('GIVEN id as string THEN returns data about snowflake', () => {
			expect(new Snowflake(sampleEpoch).deconstruct('3971046231244935169')).toStrictEqual(expected)
		})

		test('GIVEN id as bigint THEN returns data about snowflake', () => {
			expect(new Snowflake(sampleEpoch).deconstruct(3971046231244935168n)).toStrictEqual({
				...expected,
				id: 3971046231244935168n,
				increment: 0n
			})
		})

		test('GIVEN decode THEN same as deconstruct', () => {
			expect(new Snowflake(sampleEpoch).decode('3971046231244935169')).toStrictEqual(expected)
		})
	})

	describe('timestampFrom', () => {
		const snowflake = new Snowflake(sampleEpoch)

		test('GIVEN id as string THEN returns timestamp', () => {
			expect(snowflake.timestampFrom('3971046231244935169')).toBe(2524608000000)
		})

		test('GIVEN id as bigint THEN returns timestamp', () => {
			expect(snowflake.timestampFrom(3971046231244935168n)).toBe(2524608000000)
		})
	})

	describe.each([
		[String, String],
		[String, BigInt],
		[BigInt, String],
		[BigInt, BigInt]
	])('compare', (ctorA, ctorB) => {
		test.each([
			[ctorA(737141877803057244n), ctorB(254360814063058944n), 1],
			[ctorA(1737141877803057244n), ctorB(254360814063058944n), 1],
			[ctorA(737141877803057244n), ctorB(737141877803057244n), 0],
			[ctorA(254360814063058944n), ctorB(737141877803057244n), -1],
			[ctorA(254360814063058944n), ctorB(1737141877803057244n), -1]
		])('GIVEN %o and %o THEN returns %d', (a, b, expected) => {
			expect(Snowflake.compare(a as string | bigint, b as string | bigint)).toBe(expected)
		})
	})
})

describe('DiscordSnowflake (ported)', () => {
	test('GIVEN basic code THEN generates snowflake', () => {
		expect(DiscordSnowflake.generate().toString()).toBe('661720242585604096')
	})

	test('GIVEN id THEN deconstructs it', () => {
		expect(DiscordSnowflake.deconstruct('661720242585735168')).toStrictEqual<DeconstructedSnowflake>({
			id: 661720242585735168n,
			timestamp: 1577836800000n,
			workerId: 1n,
			processId: 1n,
			increment: 0n,
			epoch: 1420070400000n
		})
	})
})

describe('TwitterSnowflake (ported)', () => {
	test('GIVEN basic code THEN generates snowflake', () => {
		expect(TwitterSnowflake.generate().toString()).toBe('1212161512043450368')
	})

	test('GIVEN id THEN deconstructs it', () => {
		expect(TwitterSnowflake.deconstruct(1823945883910279168n)).toStrictEqual<DeconstructedSnowflake>({
			id: 1823945883910279168n,
			timestamp: 1723697560657n,
			workerId: 1n,
			processId: 1n,
			increment: 0n,
			epoch: 1288834974657n
		})
	})
})
