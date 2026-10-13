import { buildApp } from "./app";
const host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 3001),
  token = process.env.API_TOKEN,
  publicAccess = process.env.PUBLIC_ACCESS === "true";
const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
if (
  !loopback &&
  ((!publicAccess && (!token || token.length < 32)) ||
    !process.env.PUBLIC_ORIGIN?.startsWith("https://"))
)
  throw new Error(
    "非本地监听必须设置至少 32 字符的 API_TOKEN 及 HTTPS PUBLIC_ORIGIN",
  );
const app = await buildApp({
  databasePath: process.env.DATABASE_PATH,
  token,
  publicAccess,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  logger: true,
  seed: process.env.SEED_DEMO !== "false",
});
await app.listen({ host, port });
console.log(`Bead Pattern Workbench: http://${host}:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
