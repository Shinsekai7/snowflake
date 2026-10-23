import { Snowflake } from './Snowflake'

/**
 * Discord's epoch: 2015-01-01T00:00:00.000Z.
 * {@link https://discord.com/developers/docs/reference#snowflakes}
 */
export const DiscordEpoch = 1420070400000n

/**
 * Twitter's epoch: 2010-11-04T01:42:54.657Z, from the archived snowflake repository.
 * {@link https://github.com/twitter-archive/snowflake/blob/b3f6a3c6ca8e1b6847baa6ff42bf72201e2c2231/src/main/scala/com/twitter/service/snowflake/IdWorker.scala#L25}
 */
export const TwitterEpoch = 1288834974657n

/**
 * Shared generator with Discord's epoch, mainly for reading Discord ids. To generate ids of your
 * own, make a `new Snowflake({ epoch: DiscordEpoch, workerId, processId })` per process instead,
 * so concurrent generators never share a worker / process pair.
 */
export const DiscordSnowflake = new Snowflake(DiscordEpoch)

/** Shared generator with Twitter's epoch; same advice as {@link DiscordSnowflake}. */
export const TwitterSnowflake = new Snowflake(TwitterEpoch)
