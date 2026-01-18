import {
  User,
  League,
  DraftPick,
  Roster,
  Draft,
  DraftPickRecord,
} from "../lib/types/manager-types";
import {
  SleeperDraft,
  SleeperDraftDraftPick,
  SleeperDraftPick,
  SleeperLeague,
  SleeperRoster,
  SleeperTransaction,
  SleeperUser,
} from "../lib/types/sleeper-types";
import { Trade } from "../lib/types/trades-types";
import axiosInstance from "../lib/axios-instance.js";
import pool from "../lib/pool.js";
import { PoolClient } from "pg";

export async function updateLeagues(
  toUpdate: string[],
  db: string[],
  week: number
) {
  const usersToUpsert: User[] = [];
  const leaguesToUpsert: League[] = [];
  const tradesToUpsert: Trade[] = [];
  const draftsToUpsert: Draft[] = [];
  const draftPicksToUpsert: DraftPickRecord[] = [];

  const currentSeason =
    process.env.SEASON || new Date().getFullYear().toString();

  const batchSize = 5;

  for (let i = 0; i < toUpdate.length; i += batchSize) {
    await Promise.all(
      toUpdate.slice(i, i + batchSize).map(async (league_id) => {
        try {
          const league: { data: SleeperLeague } = await axiosInstance.get(
            `https://api.sleeper.app/v1/league/${league_id}`
          );

          const rosters: { data: SleeperRoster[] } = await axiosInstance.get(
            `https://api.sleeper.app/v1/league/${league_id}/rosters`
          );

          const users: { data: SleeperUser[] } = await axiosInstance.get(
            `https://api.sleeper.app/v1/league/${league_id}/users`
          );

          const drafts = await axiosInstance.get(
            `https://api.sleeper.app/v1/league/${league_id}/drafts`
          );
          const tradedPicks = await axiosInstance.get(
            `https://api.sleeper.app/v1/league/${league_id}/traded_picks`
          );

          const { draftPicks, draftOrder, startupCompletionTime } =
            getLeagueDraftPicks(
              league.data,
              rosters.data,
              users.data,
              drafts.data,
              tradedPicks.data
            );

          // Process completed current-season drafts
          const completedDrafts = (drafts.data as SleeperDraft[]).filter(
            (d) => d.status === "complete" && d.season === currentSeason
          );

          if (completedDrafts.length > 0) {
            const existingDraftIds = await getExistingCompletedDraftIds(
              completedDrafts.map((d) => d.draft_id)
            );

            for (const draft of completedDrafts) {
              if (!existingDraftIds.has(draft.draft_id)) {
                // Fetch picks for this new completed draft
                const picksResponse: { data: SleeperDraftDraftPick[] } =
                  await axiosInstance.get(
                    `https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`
                  );

                // Add draft to upsert
                draftsToUpsert.push({
                  draft_id: draft.draft_id,
                  league_id: draft.league_id,
                  season: draft.season,
                  type: draft.type,
                  status: draft.status,
                  rounds: draft.settings.rounds,
                  start_time: draft.start_time,
                  last_picked: draft.last_picked,
                  draft_order: draft.draft_order,
                  slot_to_roster_id: draft.slot_to_roster_id || null,
                  settings: draft.settings,
                });

                // Add picks to upsert
                for (const pick of picksResponse.data) {
                  draftPicksToUpsert.push({
                    draft_id: pick.draft_id,
                    player_id: pick.player_id,
                    picked_by: pick.picked_by,
                    roster_id: pick.roster_id,
                    round: pick.round,
                    draft_slot: pick.draft_slot,
                    pick_no: pick.pick_no,
                    amount: pick.metadata?.amount
                      ? parseInt(pick.metadata.amount, 10)
                      : null,
                    is_keeper: pick.is_keeper ?? false,
                  });
                }
              }
            }
          }

          const rostersUsername = getRostersUsernames(
            rosters.data,
            users.data,
            draftPicks
          );

          rostersUsername.forEach((roster) => {
            if (
              !usersToUpsert.some((user) => user.user_id === roster.user_id) &&
              roster.user_id
            ) {
              usersToUpsert.push({
                user_id: roster.user_id,
                username: roster.username,
                avatar: roster.avatar,
                type: "LM",
              });
            }
          });

          const trades = await getTrades(
            league.data,
            week,
            rostersUsername,
            draftOrder,
            startupCompletionTime
          );

          tradesToUpsert.push(...trades);

          leaguesToUpsert.push({
            league_id: league.data.league_id,
            name: league.data.name,
            avatar: league.data.avatar,
            roster_positions: league.data.roster_positions || [],
            scoring_settings: league.data.scoring_settings || {},
            settings: league.data.settings,
            rosters: rostersUsername,
            status: league.data.status,
            season: league.data.season,
          });
        } catch (err: unknown) {
          if (err instanceof Error) {
            console.log(err.message);
          } else {
            console.log("An unknown error occurred.");
          }
        }
      })
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const newUsersCount = await upsertUsers(usersToUpsert, client);
    const newLeaguesCount = await upsertLeagues(leaguesToUpsert, client);
    const newTradesCount = await upsertTrades(tradesToUpsert, client);
    const newDraftsCount = await upsertDrafts(draftsToUpsert, client);
    const newDraftPicksCount = await upsertDraftPicks(
      draftPicksToUpsert,
      client
    );

    console.log({
      newUsersCount,
      newLeaguesCount,
      newTradesCount,
      newDraftsCount,
      newDraftPicksCount,
    });

    await client.query("COMMIT");
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    console.error("Failed to upsert leagues data:", err);
  } finally {
    client.release();
  }

  return leaguesToUpsert;
}

function getLeagueDraftPicks(
  league: SleeperLeague,
  rosters: SleeperRoster[],
  users: SleeperUser[],
  drafts: SleeperDraft[],
  tradedPicks: SleeperDraftPick[]
) {
  const draftSeason =
    league.status === "pre_draft"
      ? parseInt(league.season, 10)
      : parseInt(league.season, 10) + 1;

  const draftOrder: { [key: string]: number } | undefined = drafts.find(
    (draft) =>
      draft.season === draftSeason.toString() &&
      draft.settings.rounds === league.settings.draft_rounds
  )?.draft_order;

  const startupCompletionTime =
    league.previous_league_id && parseInt(league.previous_league_id, 10) > 0
      ? 1
      : drafts.find(
          (draft) =>
            draft.status === "complete" &&
            draft.settings.rounds > league.settings.draft_rounds
        )?.last_picked ?? undefined;

  const draftPicks: { [key: number]: DraftPick[] } = {};

  rosters.forEach((roster) => {
    const teamDraftPicks: DraftPick[] = [];

    const user = users.find((user) => user.user_id === roster.owner_id);

    for (let i = draftSeason; i <= draftSeason + 2; i++) {
      for (let j = 1; j <= league.settings.draft_rounds; j++) {
        const isTraded = tradedPicks.some(
          (tradedPick) =>
            parseInt(tradedPick.season, 10) === i &&
            tradedPick.round === j &&
            tradedPick.roster_id === roster.roster_id
        );

        if (isTraded) continue;

        teamDraftPicks.push({
          season: i,
          round: j,
          roster_id: roster.roster_id,
          original_username: user?.display_name || "Orphan",
          order:
            (i === draftSeason && draftOrder?.[roster.owner_id]) || undefined,
        });
      }
    }

    draftPicks[roster.roster_id] = teamDraftPicks;
  });

  tradedPicks
    .filter((tradedPick) => parseInt(tradedPick.season, 10) >= draftSeason)
    .forEach((tradedPick) => {
      if (!draftPicks[tradedPick.owner_id]) {
        draftPicks[tradedPick.owner_id] = [];
      }

      const originalRoster = rosters.find(
        (roster) => roster.roster_id === tradedPick.roster_id
      );

      const originalUser = users.find(
        (user) => user.user_id === originalRoster?.owner_id
      );

      draftPicks[tradedPick.owner_id].push({
        season: parseInt(tradedPick.season, 10),
        round: tradedPick.round,
        roster_id: tradedPick.roster_id,
        original_username: originalUser?.display_name || "Orphan",
        order:
          tradedPick.season === draftSeason.toString()
            ? originalRoster?.owner_id
              ? draftOrder?.[originalRoster.owner_id]
              : undefined
            : undefined,
      });

      const index = draftPicks[tradedPick.previous_owner_id]?.findIndex(
        (draftPick) =>
          draftPick.season === parseInt(tradedPick.season, 10) &&
          draftPick.round === tradedPick.round &&
          draftPick.roster_id === tradedPick.roster_id
      );

      if (index !== undefined && index !== -1) {
        draftPicks[tradedPick.previous_owner_id].splice(index, 1);
      }
    });

  return { draftPicks, draftOrder, startupCompletionTime };
}

function getRostersUsernames(
  rosters: SleeperRoster[],
  users: SleeperUser[],
  draftPicks: { [key: number]: DraftPick[] } | undefined
) {
  const rostersUsernames = rosters.map((roster) => {
    const user = users.find((user) => user.user_id === roster.owner_id);

    return {
      ...roster,
      user_id: roster.owner_id,
      username: user?.display_name || "Orphan",
      avatar: user?.avatar ?? null,
      players: roster.players || [],
      starters: roster.starters || [],
      taxi: roster.taxi || [],
      reserve: roster.reserve || [],
      draftPicks: draftPicks?.[roster.roster_id] || [],
      wins: roster.settings.wins,
      losses: roster.settings.losses,
      ties: roster.settings.ties,
      fp: parseFloat(
        `${roster.settings.fpts}.${roster.settings.fpts_decimal || 0}`
      ),
      fpa: parseFloat(
        `${roster.settings.fpts_against}.${
          roster.settings.fpts_against_decimal || 0
        }`
      ),
    };
  });

  return rostersUsernames;
}

function computeHistoricalRoster(
  roster: Roster,
  subsequentTransactions: SleeperTransaction[]
): Roster {
  let players = [...roster.players];
  let draftPicks = [...roster.draftPicks];

  // Process transactions in reverse chronological order (most recent first)
  for (const txn of subsequentTransactions) {
    // Reverse adds: remove players that were added after this trade
    if (txn.adds) {
      for (const [playerId, rosterIdTxn] of Object.entries(txn.adds)) {
        if (rosterIdTxn === roster.roster_id) {
          players = players.filter((p) => p !== playerId);
        }
      }
    }

    // Reverse drops: add back players that were dropped after this trade
    if (txn.drops) {
      for (const [playerId, rosterIdTxn] of Object.entries(txn.drops)) {
        if (rosterIdTxn === roster.roster_id && !players.includes(playerId)) {
          players.push(playerId);
        }
      }
    }

    // Reverse draft pick trades
    for (const dp of txn.draft_picks || []) {
      if (dp.owner_id === roster.roster_id) {
        // This roster received a pick after - remove it
        draftPicks = draftPicks.filter(
          (p) =>
            !(
              p.season === parseInt(dp.season, 10) &&
              p.round === dp.round &&
              p.roster_id === dp.roster_id
            )
        );
      }
      if (dp.previous_owner_id === roster.roster_id) {
        // This roster gave away a pick after - add it back
        draftPicks.push({
          season: parseInt(dp.season, 10),
          round: dp.round,
          roster_id: dp.roster_id,
          original_username: roster.username,
          order: undefined,
        });
      }
    }
  }

  return {
    ...roster,
    players,
    draftPicks,
  };
}

async function getTrades(
  league: SleeperLeague,
  week: number,
  rosters: Roster[],
  draftOrder: { [key: string]: number } | undefined,
  startupCompletionTime: number | undefined
) {
  if (league.settings.disable_trades) return [];

  const transactions: { data: SleeperTransaction[] } = await axiosInstance.get(
    `https://api.sleeper.app/v1/league/${league.league_id}/transactions/${week}`
  );

  // Get ALL completed transactions sorted by time (ascending)
  const allTransactions = transactions.data
    .filter(
      (t) =>
        t.status === "complete" &&
        startupCompletionTime &&
        t.status_updated > startupCompletionTime
    )
    .sort((a, b) => a.status_updated - b.status_updated);

  // Filter for trades only
  const trades = allTransactions.filter((t) => t.type === "trade");

  return trades.map((t) => {
    // Find all transactions that happened AFTER this trade (reverse chronological)
    const subsequentTransactions = allTransactions
      .filter((txn) => txn.status_updated > t.status_updated)
      .sort((a, b) => b.status_updated - a.status_updated);

    // Compute historical roster for each roster
    const historicalRosters = rosters.map((roster) =>
      computeHistoricalRoster(roster, subsequentTransactions)
    );

    const adds: { [player_id: string]: string } = {};
    const drops: { [player_id: string]: string } = {};

    const draftPicks = t.draft_picks.map((draftPick) => {
      const originalUserId = rosters.find(
        (roster) => roster.roster_id === draftPick.roster_id
      )?.user_id;

      const order =
        draftPick.season === league.season
          ? draftOrder?.[originalUserId || ""]
          : undefined;

      return {
        season: draftPick.season,
        round: draftPick.round,
        new:
          rosters.find((roster) => roster.roster_id === draftPick.owner_id)
            ?.user_id ?? "0",
        old:
          rosters.find(
            (roster) => roster.roster_id === draftPick.previous_owner_id
          )?.user_id ?? "0",
        original:
          rosters.find((roster) => roster.roster_id === draftPick.roster_id)
            ?.username ?? "Team " + draftPick,
        order,
      };
    });

    if (t.adds) {
      Object.keys(t.adds).forEach((add) => {
        const manager = rosters.find(
          (roster) => roster.roster_id === t.adds[add]
        );

        adds[add] = manager?.user_id || "0";
      });
    }

    if (t.drops) {
      Object.keys(t.drops).forEach((drop) => {
        const manager = rosters.find(
          (roster) => roster.roster_id === t.drops[drop]
        );

        drops[drop] = manager?.user_id || "0";
      });
    }

    return {
      transaction_id: t.transaction_id,
      status_updated: t.status_updated,
      league_id: league.league_id,
      league: {
        league_id: league.league_id,
        name: league.name,
        avatar: league.avatar,
        roster_positions: league.roster_positions || [],
        scoring_settings: league.scoring_settings || {},
        settings: league.settings,
        status: league.status,
        season: league.season,
      },
      adds,
      drops,
      draft_picks: draftPicks,
      rosters: historicalRosters.map((roster) => ({
        roster_id: roster.roster_id,
        user_id: roster.user_id,
        username: roster.username,
        avatar: roster.avatar,
        players: roster.players,
        draftPicks: roster.draftPicks,
        wins: roster.wins,
        losses: roster.losses,
        ties: roster.ties,
        fp: roster.fp,
        fpa: roster.fpa,
      })),
    };
  });
}

async function upsertUsers(users: User[], client: PoolClient) {
  if (users.length === 0) return 0;

  const upsertUsersQuery = `
    INSERT INTO users (user_id, username, avatar, type)
    VALUES ${users
      .map(
        (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
      )
      .join(",")}
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      avatar = EXCLUDED.avatar,
      type = CASE
        WHEN users.type = 'S' THEN users.type
        ELSE EXCLUDED.type
      END;
  `;

  const values = users.flatMap((user) => [
    user.user_id,
    user.username,
    user.avatar,
    user.type,
  ]);

  const result = await client.query(upsertUsersQuery, values);

  return result.rows.filter((row) => row.is_insert).length;
}

function countSlot(positions: string[], slot: string): number {
  return positions.filter((p) => p === slot).length;
}

function countIdp(positions: string[]): number {
  return positions.filter((p) => ["DL", "LB", "DB", "IDP_FLEX"].includes(p))
    .length;
}

function countStarters(positions: string[]): number {
  return positions.filter((p) => p !== "BN").length;
}

async function upsertLeagues(leagues: League[], client: PoolClient) {
  if (leagues.length === 0) return 0;

  const cols = 26; // Total columns per league
  const upsertLeaguesQuery = `
    INSERT INTO leagues (
      league_id, name, avatar, season, status, settings, scoring_settings, roster_positions, rosters,
      qb_count, rb_count, wr_count, te_count, flex_count, super_flex_count, rec_flex_count, wrrb_flex_count,
      k_count, def_count, bn_count, dl_count, lb_count, db_count, idp_flex_count, starter_count, idp_count
    )
    VALUES ${leagues.map(
      (_, i) =>
        `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(
          ", "
        )})`
    )}
    ON CONFLICT (league_id) DO UPDATE SET
      name = EXCLUDED.name,
      avatar = EXCLUDED.avatar,
      season = EXCLUDED.season,
      status = EXCLUDED.status,
      settings = EXCLUDED.settings,
      scoring_settings = EXCLUDED.scoring_settings,
      roster_positions = EXCLUDED.roster_positions,
      rosters = EXCLUDED.rosters,
      qb_count = EXCLUDED.qb_count,
      rb_count = EXCLUDED.rb_count,
      wr_count = EXCLUDED.wr_count,
      te_count = EXCLUDED.te_count,
      flex_count = EXCLUDED.flex_count,
      super_flex_count = EXCLUDED.super_flex_count,
      rec_flex_count = EXCLUDED.rec_flex_count,
      wrrb_flex_count = EXCLUDED.wrrb_flex_count,
      k_count = EXCLUDED.k_count,
      def_count = EXCLUDED.def_count,
      bn_count = EXCLUDED.bn_count,
      dl_count = EXCLUDED.dl_count,
      lb_count = EXCLUDED.lb_count,
      db_count = EXCLUDED.db_count,
      idp_flex_count = EXCLUDED.idp_flex_count,
      starter_count = EXCLUDED.starter_count,
      idp_count = EXCLUDED.idp_count;
  `;

  const values = leagues.flatMap((league) => {
    const positions = league.roster_positions || [];
    return [
      league.league_id,
      league.name,
      league.avatar,
      league.season,
      league.status,
      JSON.stringify(league.settings),
      JSON.stringify(league.scoring_settings),
      JSON.stringify(league.roster_positions),
      JSON.stringify(league.rosters),
      countSlot(positions, "QB"),
      countSlot(positions, "RB"),
      countSlot(positions, "WR"),
      countSlot(positions, "TE"),
      countSlot(positions, "FLEX"),
      countSlot(positions, "SUPER_FLEX"),
      countSlot(positions, "REC_FLEX"),
      countSlot(positions, "WRRB_FLEX"),
      countSlot(positions, "K"),
      countSlot(positions, "DEF"),
      countSlot(positions, "BN"),
      countSlot(positions, "DL"),
      countSlot(positions, "LB"),
      countSlot(positions, "DB"),
      countSlot(positions, "IDP_FLEX"),
      countStarters(positions),
      countIdp(positions),
    ];
  });

  const result = await client.query(upsertLeaguesQuery, values);

  return result.rows.filter((row) => row.is_insert).length;
}

async function upsertTrades(trades: Trade[], client: PoolClient) {
  if (trades.length === 0) return 0;

  const upsertTradesQuery = `
    INSERT INTO trades (transaction_id, status_updated, league_id, adds, drops, draft_picks, rosters)
    VALUES ${trades.map(
      (_, i) =>
        `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${
          i * 7 + 5
        }, $${i * 7 + 6}, $${i * 7 + 7})`
    )}
    ON CONFLICT (transaction_id) DO UPDATE SET
      draft_picks = EXCLUDED.draft_picks,
      rosters = EXCLUDED.rosters;
  `;

  const values = trades.flatMap((trade) => [
    trade.transaction_id,
    new Date(trade.status_updated),
    trade.league_id,
    JSON.stringify(trade.adds),
    JSON.stringify(trade.drops),
    JSON.stringify(trade.draft_picks),
    JSON.stringify(trade.rosters),
  ]);

  const result = await client.query(upsertTradesQuery, values);

  return result.rows.filter((row) => row.is_insert).length;
}

async function getExistingCompletedDraftIds(
  draftIds: string[]
): Promise<Set<string>> {
  if (draftIds.length === 0) return new Set();

  const query = `
    SELECT draft_id FROM drafts
    WHERE draft_id = ANY($1) AND status = 'complete';
  `;

  const result = await pool.query(query, [draftIds]);
  return new Set(result.rows.map((row) => row.draft_id));
}

async function upsertDrafts(drafts: Draft[], client: PoolClient) {
  if (drafts.length === 0) return 0;

  const upsertDraftsQuery = `
    INSERT INTO drafts (draft_id, league_id, season, type, status, rounds, start_time, last_picked, draft_order, slot_to_roster_id, settings)
    VALUES ${drafts
      .map(
        (_, i) =>
          `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${
            i * 11 + 5
          }, $${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${
            i * 11 + 10
          }, $${i * 11 + 11})`
      )
      .join(",")}
    ON CONFLICT (draft_id) DO UPDATE SET
      status = EXCLUDED.status,
      last_picked = EXCLUDED.last_picked,
      updated_at = CURRENT_TIMESTAMP;
  `;

  const values = drafts.flatMap((draft) => [
    draft.draft_id,
    draft.league_id,
    draft.season,
    draft.type,
    draft.status,
    draft.rounds,
    draft.start_time,
    draft.last_picked,
    JSON.stringify(draft.draft_order),
    JSON.stringify(draft.slot_to_roster_id),
    JSON.stringify(draft.settings),
  ]);

  const result = await client.query(upsertDraftsQuery, values);

  return result.rows.filter((row) => row.is_insert).length;
}

async function upsertDraftPicks(picks: DraftPickRecord[], client: PoolClient) {
  if (picks.length === 0) return 0;

  const upsertDraftPicksQuery = `
    INSERT INTO draft_picks (draft_id, player_id, picked_by, roster_id, round, draft_slot, pick_no, amount, is_keeper)
    VALUES ${picks
      .map(
        (_, i) =>
          `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${
            i * 9 + 5
          }, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9})`
      )
      .join(",")}
    ON CONFLICT (draft_id, pick_no) DO NOTHING;
  `;

  const values = picks.flatMap((pick) => [
    pick.draft_id,
    pick.player_id,
    pick.picked_by,
    pick.roster_id,
    pick.round,
    pick.draft_slot,
    pick.pick_no,
    pick.amount,
    pick.is_keeper,
  ]);

  const result = await client.query(upsertDraftPicksQuery, values);

  return result.rows.filter((row) => row.is_insert).length;
}
