import * as mysql from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config();

const initializeDatabase = async () => {
  let connection: mysql.Connection | null = null;

  try {
    // Create connection without selecting a database first
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306", 10),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
    });

    console.log("✓ Connected to MySQL server");

    // Create database if it doesn't exist
    const dbName = process.env.DB_NAME || "chess_puzzles";
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✓ Database '${dbName}' created or already exists`);

    // Select the database
    await connection.changeUser({ database: dbName });
    console.log(`✓ Using database '${dbName}'`);

    // Create api_keys table for authentication
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INT AUTO_INCREMENT PRIMARY KEY,
        api_key VARCHAR(255) UNIQUE NOT NULL,
        description VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP NULL,
        created_by VARCHAR(100),
        INDEX idx_api_key (api_key),
        INDEX idx_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ Table 'api_keys' created or already exists");

    console.log("\n✓ Authentication tables initialized successfully!");
    console.log("\nNext steps:");
    console.log("1. Add your API keys to the database:");
    console.log("   INSERT INTO api_keys (api_key, description) VALUES ('your-api-key', 'Your description');");
    console.log("\n2. Insert sample keys for testing:");
    console.log("   INSERT INTO api_keys (api_key, description) VALUES");
    console.log("     ('test-key-1', 'Test key 1'),");
    console.log("     ('test-key-2', 'Test key 2'),");
    console.log("     ('test-key-3', 'Test key 3');");
    console.log("\n3. View all API keys:");
    console.log("   SELECT id, api_key, description, is_active, created_at FROM api_keys;");

  } catch (error) {
    console.error("✗ Error initializing database:", error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

// Run the initialization
initializeDatabase();

