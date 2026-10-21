import { FastifyInstance } from "fastify";
import { db } from "../database.js";
import { authenticate } from "../middleware/auth.js";
import { sendToUserSockets } from "../realtime.js";

// The user's synced settings: an encrypted blob only their devices can
// read (migrations/010_user_settings.sql).

const settingsRateLimit = {
  rateLimit: {
    max: 60,
    timeWindow: "1 minute",
  },
};

// Encrypted JSON, base64: plenty for the settings and per-chat looks.
const MAX_SETTINGS_LENGTH = 64 * 1024;

export default async function settingsRoutes(server: FastifyInstance) {
  // GET the synced settings (null if there are none).
  server.get(
    "/api/settings",
    { preHandler: authenticate, config: settingsRateLimit },
    async (request) => {
      const result = await db.query(
        "SELECT data, updated_at FROM user_settings WHERE user_id = $1",
        [request.user.id],
      );
      const row = result.rows[0];

      return { settings: row ? { data: row.data, updated_at: row.updated_at } : null };
    },
  );

  // REPLACE them; the user's other devices load them again.
  server.put<{ Body: { data: string } }>(
    "/api/settings",
    {
      preHandler: authenticate,
      config: settingsRateLimit,
      schema: {
        body: {
          type: "object",
          required: ["data"],
          properties: {
            data: { type: "string", pattern: "^s1:[A-Za-z0-9+/=]+$", maxLength: MAX_SETTINGS_LENGTH },
          },
        },
      },
    },
    async (request) => {
      const result = await db.query(
        `
        INSERT INTO user_settings (user_id, data, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        `,
        [request.user.id, request.body.data],
      );
      const updatedAt = result.rows[0].updated_at;

      sendToUserSockets(request.user.id, { type: "settings_changed", updatedAt });

      return { updated_at: updatedAt };
    },
  );
}
