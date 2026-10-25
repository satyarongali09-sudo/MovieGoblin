import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { supabaseAdmin } from "./services/supabase.js";
import attendanceRoutes from "./routes/attendance.js";
import classroomRoutes from "./routes/classrooms.js";
import materialRoutes from "./routes/materials.js";
import mediaRoutes from "./routes/media.js";
import pollRoutes from "./routes/polls.js";
import questionRoutes from "./routes/questions.js";
import sessionRoutes from "./routes/sessions.js";
import moviegoblinRoutes from "./routes/moviegoblin.js";

const app = express();

const configuredOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) {
    return true;
  }
  if (configuredOrigins.includes(origin)) {
    return true;
  }
  // In development, allow localhost and 127.0.0.1 on any port (e.g., 3000, 3001)
  if (env.NODE_ENV !== "production") {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return true;
    }
  }
  return false;
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "vidyasetu-api" });
});

app.get("/health/supabase", async (_req, res) => {
  const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });

  if (error) {
    return res.status(503).json({ ok: false, service: "vidyasetu-api", supabase: "unavailable" });
  }

  return res.json({ ok: true, service: "vidyasetu-api", supabase: "connected" });
});

app.use("/classrooms", classroomRoutes);
app.use("/sessions", sessionRoutes);
app.use("/materials", materialRoutes);
app.use("/polls", pollRoutes);
app.use("/questions", questionRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/media", mediaRoutes);
app.use("/moviegoblin", moviegoblinRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Unexpected server error.";
  res.status(500).json({ error: message });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(env.PORT, () => {
    console.log(`VIDYASETU API listening on port ${env.PORT}`);
  });
}

export default app;
