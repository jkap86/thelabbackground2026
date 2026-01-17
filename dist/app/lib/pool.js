import { Pool } from "pg";
if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
}
// Heroku Postgres uses self-signed certificates, requiring rejectUnauthorized: false
// This is the standard configuration for Heroku-hosted PostgreSQL databases
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
