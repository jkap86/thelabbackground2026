import pool from "../lib/pool.js";
import axiosInstance from "../lib/axios-instance.js";
const TWELVE_HOURS = 1000 * 60 * 60 * 12;
const positions = ["QB", "RB", "FB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
// Cheap query - get timestamp and freshness for ETag check
export async function getAllplayersEtagInfo() {
    const result = await pool.query("SELECT updated_at FROM common WHERE name = 'allplayers'");
    const updatedAt = result.rows[0]?.updated_at;
    if (!updatedAt) {
        return { etag: "", lastModified: undefined, isFresh: false };
    }
    const isFresh = Date.now() - TWELVE_HOURS < new Date(updatedAt).getTime();
    return {
        etag: `W/"${new Date(updatedAt).getTime()}"`,
        lastModified: new Date(updatedAt),
        isFresh,
    };
}
// Get cached data from DB
export async function getAllplayersCached() {
    const result = await pool.query("SELECT data FROM common WHERE name = 'allplayers'");
    return result.rows[0]?.data ?? null;
}
// Fetch fresh data from Sleeper API and update DB
export async function refreshAllplayers() {
    const response = await axiosInstance.get("https://api.sleeper.app/v1/players/nfl");
    const allplayers = [];
    Object.values(response.data)
        .filter((player) => player.active &&
        player.fantasy_positions?.length > 0 &&
        positions.includes(player.position))
        .forEach((player) => {
        const { player_id, position, team, full_name, first_name, last_name, age, fantasy_positions, years_exp, active, } = player;
        allplayers.push({
            player_id,
            position: position === "FB" ? "RB" : position,
            team: team || "FA",
            full_name: position === "DEF" ? `${player_id} DEF` : full_name,
            first_name,
            last_name,
            age,
            fantasy_positions: fantasy_positions.map((pos) => pos === "FB" ? "RB" : pos),
            years_exp,
            active,
        });
    });
    await pool.query(`INSERT INTO common (name, data)
     VALUES ($1, $2)
     ON CONFLICT (name)
     DO UPDATE SET data = EXCLUDED.data`, ["allplayers", JSON.stringify(allplayers)]);
    return allplayers;
}
// Main function - returns fresh data (from cache if valid, or refreshed from API)
export async function getAllplayers() {
    const { isFresh } = await getAllplayersEtagInfo();
    if (isFresh) {
        const cached = await getAllplayersCached();
        if (cached) {
            const { etag, lastModified } = await getAllplayersEtagInfo();
            return { data: cached, etag, lastModified: lastModified };
        }
    }
    // Refresh from API
    const data = await refreshAllplayers();
    const now = new Date();
    return {
        data,
        etag: `W/"${now.getTime()}"`,
        lastModified: now,
    };
}
