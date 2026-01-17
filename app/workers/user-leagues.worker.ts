import { parentPort } from "worker_threads";
import pool from "../lib/pool.js";
import axiosInstance from "../lib/axios-instance.js";
import { SleeperLeague } from "../lib/types/sleeper-types";
import { updateLeagues } from "../utils/update-leagues.js";

if (!process.env.SEASON) {
  throw new Error("SEASON environment variable is required");
}

const INCREMENT_LEAGUES = 250;

const getUserIdsToUpdate = async () => {
  const getUserIdsQuery = `
      SELECT user_id 
      FROM users
      ORDER BY updated_at ASC 
      LIMIT 100;
    `;

  const users_to_update = await pool.query(getUserIdsQuery);

  return users_to_update.rows.map((r) => r.user_id);
};

const upsertUserIds = async (user_ids_updated: string[]) => {
  const upsertUsersQuery = `
      INSERT INTO users (user_id, username, type, created_at, updated_at) 
      VALUES ${user_ids_updated
        .map(
          (_, i) =>
            `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${
              i * 5 + 5
            })`
        )
        .join(",")}
      ON CONFLICT (user_id) DO UPDATE SET
        updated_at = EXCLUDED.updated_at;
    `;

  const values = user_ids_updated.flatMap((user_id) => [
    user_id,
    "",
    "",
    new Date(),
    new Date(),
  ]);

  await pool.query(upsertUsersQuery, values);
};

const updateUsers = async (league_ids_queue: string[], season: string) => {
  if (league_ids_queue.length < INCREMENT_LEAGUES) {
    const user_ids_to_update = await getUserIdsToUpdate();

    const league_ids_to_add = league_ids_queue;

    const batchSize = 10;

    for (let i = 0; i < user_ids_to_update.length; i += batchSize) {
      const batch = user_ids_to_update.slice(i, i + batchSize);

      const user_ids_updated: string[] = [];

      await Promise.all(
        batch.map(async (user_id) => {
          try {
            const leagues = await axiosInstance.get(
              `https://api.sleeper.app/v1/user/${user_id}/leagues/nfl/${season}`
            );

            const league_ids = leagues.data.map(
              (league: SleeperLeague) => league.league_id
            );

            const existingLeaguesQuery = `
                SELECT league_id
                FROM leagues
                WHERE league_id = ANY($1)
                ORDER BY updated_at ASC;
            `;

            const existingLeague_ids = await pool.query(existingLeaguesQuery, [
              league_ids,
            ]);

            const newLeague_ids = league_ids.filter(
              (league_id: string) =>
                !existingLeague_ids.rows
                  .map((r) => r.league_id)
                  .includes(league_id)
            );

            league_ids_to_add.push(...newLeague_ids);

            user_ids_updated.push(user_id);
          } catch (err) {
            console.error(`Failed to fetch leagues for user ${user_id}:`, err);
          }
        })
      );

      await upsertUserIds(user_ids_updated);
    }

    return {
      league_ids_queue_updated: Array.from(new Set(league_ids_to_add)),
    };
  } else {
    return { league_ids_queue_updated: league_ids_queue };
  }
};

parentPort?.on("message", async (message) => {
  try {
    const { leagueIdsQueue } = message;

    const state: { week: number; leg: number; season: string } = await (
      await axiosInstance.get("https://api.sleeper.app/v1/state/nfl")
    ).data;

    const week =
      process.env.SEASON === state.season
        ? Math.max(Math.min(state.week, state.leg), 1)
        : 1;

    const result = await updateUsers(
      leagueIdsQueue,
      process.env.SEASON as string
    );

    let outOfDateLeagueIds;

    if (result.league_ids_queue_updated.length < INCREMENT_LEAGUES) {
      const outOfDateLeaguesQuery = `
        SELECT league_id
        FROM leagues
        ORDER BY updated_at ASC
        LIMIT $1;
      `;

      const outOfDateLeagues = await pool.query(outOfDateLeaguesQuery, [
        INCREMENT_LEAGUES - result.league_ids_queue_updated.length,
      ]);

      outOfDateLeagueIds = outOfDateLeagues.rows.map((l) => l.league_id);

      console.log({ outOfDateLeagueIds: outOfDateLeagueIds.length });
    }

    const updated_league_ids = await updateLeagues(
      [
        ...result.league_ids_queue_updated.slice(0, INCREMENT_LEAGUES),
        ...(outOfDateLeagueIds || []),
      ],
      outOfDateLeagueIds || [],
      week
    );

    parentPort?.postMessage(
      result.league_ids_queue_updated.filter(
        (league_id) =>
          !updated_league_ids.some((l) => l.league_id === league_id)
      )
    );
  } catch (err) {
    console.error("Worker fatal error:", err);
    parentPort?.postMessage([]);
  } finally {
    parentPort?.close();
  }
});
