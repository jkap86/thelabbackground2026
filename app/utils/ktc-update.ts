import axiosInstance from "../lib/axios-instance.js";
import * as cheerio from "cheerio";
import pool from "../lib/pool.js";
import { parentPort } from "worker_threads";
import { getAllplayers } from "./get-allplayers.js";
import { KtcPlayerDbUpdate, ktcPlayerObj } from "../lib/types/ktc-types.js";
import { Allplayer } from "../lib/types/common-types.js";

const controlValue = new Date().getTime() - 12 * 60 * 60 * 1000;

const KTC_HISTORY_UPDATE_INCREMENT = 10;
const MAX_INIT_RETRIES = 3;

export const updateKtcDataHistory = async (initRetryCount = 0) => {
  const { linksToUpdate, ktc_map_dynasty } = await getKtcLinksToUpdate();

  if (Object.keys(ktc_map_dynasty).length === 0) {
    if (initRetryCount >= MAX_INIT_RETRIES) {
      console.error("Failed to initialize KTC map after max retries");
      parentPort?.postMessage({ syncComplete: false, error: "init_failed" });
      return;
    }
    await updateKtcDataCurrent();
    await updateKtcDataHistory(initRetryCount + 1);
    return;
  }

  for await (const link of linksToUpdate.slice(
    0,
    KTC_HISTORY_UPDATE_INCREMENT
  )) {
    const sleeperId = ktc_map_dynasty[link].sleeper_id;

    try {
      await updatePlayerKtcHistory(link, sleeperId);

      ktc_map_dynasty[link].sync = new Date().getTime();
    } catch (error) {
      console.error(
        `Error updating KTC history for player link: ${link}, sleeper ID: ${sleeperId}`,
        error
      );
    }
  }

  await upsertIntoCommon("ktc_map_dynasty", ktc_map_dynasty, new Date());

  if (linksToUpdate.length <= KTC_HISTORY_UPDATE_INCREMENT) {
    parentPort?.postMessage({ syncComplete: true });
    console.log(`KTC dynasty history update complete at ${new Date()}`);
  }
};

export const updateKtcDataCurrent = async () => {
  const ktcUrl = `https://keeptradecut.com/dynasty-rankings?page=0&filters=QB|WR|RB|TE|RDP&format=2`;

  const [allplayersArray, { ktc_map_dynasty, ktc_unmatched_dynasty }] =
    await Promise.all([getAllplayers(), getKtcMapAndUnmatched()]);

  const allplayers: { [player_id: string]: Allplayer } = Object.fromEntries(
    allplayersArray.data.map((player) => [player.player_id, player])
  );

  const response = await axiosInstance.get(ktcUrl);

  const html = response.data;
  const $ = cheerio.load(html);

  const date = new Date().toISOString().split("T")[0];

  const currentValues: KtcPlayerDbUpdate[] = [];

  $("script").each((i, el) => {
    const scriptContent = $(el).html();

    const match = scriptContent?.match(
      /var playersArray\s*=\s*(\[[\s\S]*?\]);/
    );

    if (match && match[1]) {
      const playersArrayJson = match[1];
      let playersArray: ktcPlayerObj[];
      try {
        playersArray = JSON.parse(playersArrayJson);
      } catch (err) {
        console.error("Failed to parse KTC players array JSON:", err);
        return;
      }

      playersArray.forEach((player) => {
        let sleeperId = matchPlayer(
          player,
          allplayers,
          ktc_map_dynasty
        ).sleeperId;

        if (sleeperId) {
          const overall_rank = player.superflexValues?.tepp?.rank ?? null;

          const position_rank =
            player.superflexValues?.tepp?.positionalRank ?? null;

          const value = player.superflexValues?.tepp?.value ?? 0;

          const ktcPlayerDbUpdate: KtcPlayerDbUpdate = {
            player_id: sleeperId,
            date,
            value,
            overall_rank,
            position_rank,
          };

          currentValues.push(ktcPlayerDbUpdate);

          if (ktc_map_dynasty[player.slug]?.sync) {
            ktc_map_dynasty[player.slug].sync = new Date().getTime();
          } else if (!ktc_unmatched_dynasty.links.includes(player.slug)) {
            ktc_unmatched_dynasty.links.push(player.slug);
          }
        }
      });
    }
  });

  await upsertIntoCommon("ktc_map_dynasty", ktc_map_dynasty, new Date());

  await upsertIntoCommon(
    "ktc_unmatched_dynasty",
    ktc_unmatched_dynasty,
    new Date()
  );

  console.log(
    currentValues.length + " KTC dynasty current values to upsert..."
  );
  await upsertKtcValues(currentValues);

  console.log(`KTC dynasty values updated successfully at ${new Date()}`);
};

export const getKtcLinksToUpdate = async () => {
  const { ktc_map_dynasty } = await getKtcMapAndUnmatched();

  const linksToUpdate = Object.keys(ktc_map_dynasty).filter(
    (link) =>
      !ktc_map_dynasty[link].sync || ktc_map_dynasty[link].sync < controlValue
  );

  console.log(`${linksToUpdate.length} KTC Dynasty Players to update...`);

  return { linksToUpdate, ktc_map_dynasty };
};

const getKtcMapAndUnmatched = async () => {
  const ktc_unmatched_db = await pool.query(
    `
        SELECT * 
        FROM common 
        WHERE name = $1;
    `,
    [`ktc_unmatched_dynasty`]
  );

  const ktc_unmatched_dynasty = ktc_unmatched_db.rows[0]?.data || { links: [] };

  const ktc_map_db = await pool.query(
    `
        SELECT * 
        FROM common 
        WHERE name = $1;
    `,
    [`ktc_map_dynasty`]
  );

  const ktc_map_dynasty = ktc_map_db.rows[0]?.data || {};

  return { ktc_map_dynasty, ktc_unmatched_dynasty };
};

// Player name aliases for matching KTC names to Sleeper names
const NAME_ALIASES: Record<string, string> = {
  "marquise brown": "hollywood brown",
};

// Pattern to match name suffixes (only at end of string)
const SUFFIX_PATTERN = /\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i;

const matchPlayer = (
  player: ktcPlayerObj,
  allplayers: { [player_id: string]: Allplayer },
  ktc_map: { [key: string]: { sleeper_id: string; sync: number } }
) => {
  if (ktc_map[player.slug])
    return { sleeperId: ktc_map[player.slug].sleeper_id };

  if (["-early-", "-mid-", "-late-"].some((pt) => player.slug.includes(pt))) {
    return { sleeperId: formatPickLink(player.slug) };
  }

  const getMatchName = (name: string) => {
    let normalized = name.toLowerCase();

    // Apply known aliases
    for (const [from, to] of Object.entries(NAME_ALIASES)) {
      normalized = normalized.replace(from, to);
    }

    // Remove suffixes (only at end of string)
    normalized = normalized.replace(SUFFIX_PATTERN, "");

    // Remove non-alpha characters
    return normalized.replace(/[^a-z]/g, "");
  };

  let matches = Object.keys(allplayers).filter((sleeper_id) => {
    const positon_check =
      player.position?.toLowerCase() ===
      allplayers[sleeper_id]?.position?.toLowerCase();

    const name_check =
      getMatchName(player.playerName).startsWith(
        getMatchName(allplayers[sleeper_id]?.first_name.slice(0, 3))
      ) &&
      getMatchName(player.playerName).includes(
        getMatchName(allplayers[sleeper_id]?.last_name)
      );

    return positon_check && name_check;
  });

  if (matches.length > 1) {
    matches = matches.filter(
      (sleeper_id) =>
        convertTeamAbbrev(player.team) === allplayers[sleeper_id]?.team
    );
  }

  if (matches.length === 1) {
    const sleeperId = matches[0];

    ktc_map[player.slug] = { sleeper_id: sleeperId, sync: 0 };

    return { sleeperId };
  } else {
    return { sleeperId: undefined };
  }
};

const convertTeamAbbrev = (ktcTeam: string) => {
  const teamMap: { [ktcTeam: string]: string } = {
    KCC: "KC",
    LVR: "LV",
    JAC: "JAX",
    NEP: "NE",
    TBB: "TB",
    GBP: "GB",
    NOS: "NO",
    SFO: "SF",
  };

  return teamMap[ktcTeam] || ktcTeam;
};

const formatPickLink = (link: string) => {
  const link_array = link.split("-");

  return `${link_array[0]} ${
    link_array[1].charAt(0).toUpperCase() + link_array[1].slice(1)
  } ${link_array[2]}`;
};

const upsertIntoCommon = async (field: string, data: {}, updated_at: Date) => {
  await pool.query(
    `
        INSERT INTO common (name, data, updated_at) 
        VALUES ($1, $2, $3)
        ON CONFLICT (name) 
        DO UPDATE SET 
            data = EXCLUDED.data,
            updated_at = EXCLUDED.updated_at
        RETURNING *;
        `,
    [field, data, updated_at]
  );
};

const upsertKtcValues = async (data: KtcPlayerDbUpdate[]) => {
  if (data.length === 0) return;

  const query = `
        INSERT INTO ktc_dynasty (player_id, date, value, overall_rank, position_rank) 
        VALUES  ${data
          .map(
            (_, i) =>
              `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${
                i * 5 + 5
              })`
          )
          .join(", ")}
        ON CONFLICT (player_id, date) 
        DO UPDATE SET 
            value = EXCLUDED.value,
            overall_rank = EXCLUDED.overall_rank,
            position_rank = EXCLUDED.position_rank
        RETURNING *;
        `;

  const values = data.flatMap((d) => [
    d.player_id,
    d.date,
    d.value,
    d.overall_rank,
    d.position_rank,
  ]);

  if (values.length !== data.length * 5) {
    console.error(
      `Values mismatch: expected ${data.length * 5}, got ${values.length}`
    );
    console.error("Sample data item:", data[0]);
    return;
  }

  await pool.query(query, values);
};

const updatePlayerKtcHistory = async (link: string, sleeper_id: string) => {
  const player_historical_values: { [date: string]: KtcPlayerDbUpdate } = {};

  const response = await axiosInstance.get(
    `https://keeptradecut.com/dynasty-rankings/players/` + link
  );

  const html = response.data;
  const $ = cheerio.load(html);

  $("script").each((index, element) => {
    const content = $(element).html();

    const match = content?.match(/var playerSuperflex\s*=\s*(\{[\s\S]*?\});/);

    if (match && match[1]) {
      let playerObj;
      try {
        playerObj = JSON.parse(match[1]);
      } catch (err) {
        console.error("Failed to parse KTC player history JSON:", err);
        return;
      }
      const position = playerObj.adjacentPositionalPlayers?.[0]?.position;
      const historicalValues =
        position === "TE" ? playerObj.tepp?.history : playerObj.overallValue;

      if (!historicalValues) return;

      historicalValues.forEach((obj: { d: string; v: number }) => {
        const overall_rank =
          playerObj.overallRankHistory?.find(
            (or: { d: string; v: number }) => or.d === obj.d
          )?.v ?? null;

        const position_rank =
          playerObj.positionalRankHistory?.find(
            (or: { d: string; v: number }) => or.d === obj.d
          )?.v ?? null;

        const date_string = `20${obj.d.slice(0, 2)}-${obj.d.slice(
          2,
          4
        )}-${obj.d.slice(4, 6)}`;

        const date = new Date(date_string).toISOString().split("T")[0];
        const value = obj.v;

        player_historical_values[date] = {
          player_id: sleeper_id,
          date,
          value,
          overall_rank,
          position_rank,
        };
      });
    }
  });

  const player_historical_values_array = Object.values(
    player_historical_values
  );

  await upsertKtcValues(player_historical_values_array);
};
