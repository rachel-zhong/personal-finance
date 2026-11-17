import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { createPlaidClient } from "@/lib/connectors/plaid/client";
import { getAccessToken } from "@/lib/secrets";

export const runtime = "nodejs";

/** Create a Link token. Pass { connectionId } to re-authenticate an existing connection (update mode), or with addAccounts to choose which accounts it shares. */
export async function POST(req: Request) {
  return handle(async () => {
    const { connectionId, addAccounts } = (await req.json().catch(() => ({}))) as { connectionId?: string; addAccounts?: boolean };
    let accessToken: string | undefined;
    if (connectionId) {
      const c = await getDb().get<{ access_token_ref: string }>(
        "SELECT access_token_ref FROM connections WHERE id = ?", [connectionId]);
      if (!c) throw new Error("Unknown connection");
      accessToken = getAccessToken(c.access_token_ref);
    }
    const { link_token } = await createPlaidClient().linkTokenCreate({ accessToken, addAccounts: !!addAccounts });
    return { link_token };
  });
}
