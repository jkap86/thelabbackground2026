import { Pool } from "pg";
const ssl = process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
});
pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
});
export default pool;
