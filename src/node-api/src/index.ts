import { serve } from "@hono/node-server";
import app from "./app.js";

const [host = "localhost", port = "3000"]: string[] =
  process.env.AWS_LAMBDA_HTTP_ENDPOINT?.split(":") ?? [];

serve(
  {
    fetch: app.fetch,
    hostname: host,
    port: Number(port),
  },
  (info) => {
    console.log(`Server is running on http://${host}:${port}`);
  },
);
