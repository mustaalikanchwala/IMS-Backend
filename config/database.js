import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Check if we're using DATABASE_URL (Render) or individual params (Local)
const isProduction = process.env.DATABASE_URL !== undefined;

const pool = new Pool(
  isProduction
    ? {
        // Production: Use Render's DATABASE_URL
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false  // Required for Render Postgres
        }
      }
    : {
        // Local development: Use individual params
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'inventory_db',
        port: process.env.DB_PORT || 5432
      }
);

// Test connection
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

// Export query method
const db = {
  query: (text, params) => pool.query(text, params),
  pool: pool
};

export default db;
