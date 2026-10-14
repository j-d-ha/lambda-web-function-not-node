import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "Ok", backend: "node" }, 200);
});

export default app;
