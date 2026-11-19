/**
 * Local secrets file for provider access tokens. The database only stores a reference
 * (connections.access_token_ref). The file lives in ./secrets (gitignored), mode 600.
 */
import fs from "node:fs";
import path from "node:path";

interface SecretEntry {
  provider: string;
  access_token: string;
  item_id: string;
  institution_name?: string;
  created_at: string;
}
type SecretFile = Record<string, SecretEntry>;

export function secretsPath() {
  return process.env.SECRETS_PATH || path.join(process.cwd(), "secrets", "plaid-tokens.json");
}

function readAll(): SecretFile {
  const p = secretsPath();
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8")) as SecretFile;
}

function writeAll(data: SecretFile) {
  const p = secretsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
  fs.chmodSync(p, 0o600);
}

export function saveSecret(ref: string, entry: Omit<SecretEntry, "created_at">) {
  const all = readAll();
  all[ref] = { ...entry, created_at: new Date().toISOString() };
  writeAll(all);
}

export function getAccessToken(ref: string): string {
  const e = readAll()[ref];
  if (!e) throw new Error(`No access token found for ref ${ref} in ${secretsPath()}`);
  return e.access_token;
}
