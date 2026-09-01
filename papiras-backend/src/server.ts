import { buildApp } from "./app";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`Papiras backend listening on port ${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
