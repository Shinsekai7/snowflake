# @shinsekai/snowflake

Snowflake IDs as BigInts that are **unique and strictly increasing**, with a layout you can fit into a
signed 64-bit column. Invalid input throws instead of silently producing a wrong id.

No dependencies. ESM, CommonJS and a `<script>` build (global `ShinsekaiSnowflake`). Node 18+ and every modern browser.

```ts
import { Snowflake } from '@shinsekai/snowflake'

const snowflake = new Snowflake({
	epoch: new Date('2026-01-01T00:00:00.000Z'),
	workerId: 3, // one worker / process pair per generator running at the same time
	processId: 7
})

const id = snowflake.generate() // 1234567890123456n
const json = snowflake.generateString() // '1234567890123456', safe for JSON
snowflake.deconstruct(id) // { id, timestamp, workerId: 3n, processId: 7n, increment, epoch }
snowflake.timestampFrom(id) // ms since the Unix epoch, exact
```

## Layout

| bits  | 63 – 22   | 21 – 17 | 16 – 12 | 11 – 0    |
| ----- | --------- | ------- | ------- | --------- |
| field | timestamp | worker  | process | increment |
| width | 42        | 5       | 5       | 12        |

The timestamp is milliseconds after your epoch. With the default 64 bits it lasts ~139 years; with
`bits: { total: 63 }` it lasts ~69 years and **every id fits a signed 64-bit integer** (PostgreSQL
`bigint`, MySQL `BIGINT`, Java `long`). With the default 64-bit layout, ids pass 2^63 halfway through,
which overflows those columns (with Discord's epoch: on 2084-09-06).

```ts
// For a database: 63 bits, epoch close to today
const ids = new Snowflake({ epoch: Date.UTC(2026, 0, 1), bits: { total: 63 }, workerId: 1 })

// Any layout: 10-bit machine id, no process field
const custom = new Snowflake({ epoch: Date.UTC(2026, 0, 1), bits: { worker: 10, process: 0, increment: 12, total: 63 } })
custom.layout // { totalBits: 63, timestampBits: 41, maxWorkerId: 1023n, ... }
```

## API

### `new Snowflake(epoch | options)`

- `epoch` — `number | bigint | Date`. You can pass the epoch alone instead of an options object.
- `workerId` (default `0`), `processId` (default `1`) — must fit their fields, or a `RangeError` is thrown.
- `bits` — `{ worker = 5, process = 5, increment = 12, total = 64 }`. At least 35 bits must be left for the timestamp.
- `clock` — `() => number | bigint`, default `Date.now`. Inject one in tests.

### `generate(options?)` / `generateString(options?)`

With no options, ids come from the clock and a per-millisecond sequence:

- The sequence restarts at 0 every millisecond, and ids are strictly increasing.
- More than 4096 ids in a millisecond: the next id borrows the next millisecond instead of repeating.
- The clock goes back (NTP, VM resume): the last timestamp is held until the clock catches up, so ids never repeat or go backwards.

Options (all optional): `timestamp`, `increment`, `workerId`, `processId`.

- `timestamp` — make an id for that time. Repeated calls with the same timestamp continue its sequence
  and throw once it's full; a timestamp earlier than the last one used gets increment 0 and doesn't move the generator back.
- `increment` — use exactly this sequence value (no state is touched).
- Every value is range-checked. A timestamp before the epoch or past the last one the layout holds throws a `RangeError`.

### Reading ids

- `deconstruct(id)` / `decode(id)` — fields as bigints. `decode` is bound, so `ids.map(snowflake.decode)` works.
- `timestampFrom(id)` — exact milliseconds as a number.
- `minIdAt(time)` / `maxIdAt(time)` — id bounds for range queries: `WHERE id BETWEEN $1 AND $2`.
- `Snowflake.compare(a, b)` — `-1 | 0 | 1` for strings or bigints, for sorting.

Ids can be a bigint, a safe integer number or a decimal string. Anything else (`'12abc'`, negatives, ids
wider than the layout, unsafe numbers) throws instead of producing a wrong answer.

### Presets

`DiscordEpoch`, `TwitterEpoch`, and shared `DiscordSnowflake` / `TwitterSnowflake` generators — handy for
reading Discord or Twitter ids. To generate your own, create a generator per process with its own worker / process ids.

## Guarantees

- **Unique:** one generator never returns the same id twice, even past 4096 ids per millisecond.
- **Ordered:** ids from one generator are strictly increasing, even when the clock goes back.
- **Exact:** `timestampFrom` and `deconstruct` return exactly what went in; no floating-point rounding.
- **Checked:** worker ids, process ids, increments and timestamps that don't fit their fields throw a `RangeError`
  instead of being masked or overflowing. To fit a larger value such as a hash, mask it yourself: `workerId: hash & 31`.

## Development

```bash
pnpm install
pnpm test       # vitest
pnpm typecheck
pnpm build      # dist/: ESM, CJS, IIFE, .d.ts
```

## License

MIT. See [LICENSE](LICENSE).
