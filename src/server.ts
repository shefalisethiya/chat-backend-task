import { app } from "./app";
import { config } from "./config";
import { checkDatabase, pool } from "./db";

async function main(): Promise<void> {
  await checkDatabase();
  const server = app.listen(config.port, () => {
    console.log(`Chat backend listening on http://localhost:${config.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});