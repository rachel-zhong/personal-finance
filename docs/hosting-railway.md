# Put My Money online with Railway

**Result:** the app runs on Railway, you open it on your phone from anywhere, and only you can log in. Your banks stay connected (no reconnecting, so no Plaid Trial slots used).

**Time:** about 30 minutes. Do the steps in order.

**What stays private**

| Thing | Where it lives |
|---|---|
| The code | GitHub (public, no personal data) |
| Your database and Plaid tokens | A private disk ("volume") on Railway, only reachable by the app |
| Pay data | Stays on your Mac, unless you later set `HOSTED_INCLUDE_COMPENSATION=true` |
| Passwords and keys | Railway "Variables" (never in GitHub) |

---

## Step 0 · Cost check (do this first)

- Railway's Hobby plan is $5 a month and includes $5 of usage.
- This app should use roughly $3–5 a month: a small always-on server plus a disk under 1 GB.
  - _This is an estimate._ Railway's usage page shows the real number after a few days.
- **Stop surprise charges:** in Railway, open your workspace → **Usage** → set a **hard usage limit** of $5. Railway stops the app instead of billing more.
- If your account is on the free trial, keeping the app running means switching to Hobby. That's a paid plan, so decide on it before going further.
- Plaid: no change. The daily sync uses the same free (Trial) calls as Sync now. "Refresh now" on Investments is also free on Trial.

---

## Step 1 · Create the project from GitHub

1. Go to railway.com → **New Project** → **Deploy from GitHub repo**.
2. Pick your repository (`personal-finance`). Allow Railway access to it if asked.
3. Railway starts a first build right away. **It's fine if this first deploy fails or shows an error.** The settings come next.

Railway reads `railway.json` from the repo, which tells it how to build, how to start (`npm run start:hosted`), and how to check the app is up (`/api/health`).

---

## Step 2 · Add the private disk (volume)

1. In the project, click your service (the box with the repo name).
2. Right-click the service, or open the command menu (⌘K) → **Add Volume**.
3. **Mount path:** `/data`
4. Save. This disk keeps your data when the app restarts or updates.

---

## Step 3 · Get a web address

1. Service → **Settings** → **Networking** → **Generate Domain**.
2. You get an address like `https://something.up.railway.app`. Write it down; it's **your app address** below.

---

## Step 4 · Set the variables

Service → **Variables** → **Raw Editor**, paste this, then fill in each value:

```
DATABASE_PATH=/data/finance.db
SECRETS_PATH=/data/secrets/plaid-tokens.json
APP_PASSWORD=
SESSION_SECRET=
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=production
TZ=America/Los_Angeles
HOSTED_INCLUDE_COMPENSATION=false
```

| Variable | What to put |
|---|---|
| `APP_PASSWORD` | A long password you'll use to log in. Use your password manager to make one (20+ characters). |
| `SESSION_SECRET` | A long random string. Make one in Terminal on your Mac: `openssl rand -base64 48` |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | The same values as in your Mac's `.env.local` (production secret). |
| `TZ` | Your time zone, so "today" and the daily sync use your clock. Examples: `America/Los_Angeles`, `America/New_York`. |
| `HOSTED_INCLUDE_COMPENSATION` | Leave `false`. The Compensation tab is hidden and no pay data is uploaded. |

**Optional:**

| Variable | Default | Use |
|---|---|---|
| `TOTP_SECRET` | none | Second login step with an authenticator code. See Step 5. |
| `SYNC_HOUR` | `6` | Hour of the daily sync (0–23, your time zone). |
| `PLAID_REDIRECT_URI` | none | Set in Step 7, **after** adding it in Plaid. |

Click **Deploy** (or wait for the automatic redeploy). Open your app address: you should see the **login page**. Log in with `APP_PASSWORD`. The app is empty for now; that's expected.

---

## Step 5 · (Optional) Add an authenticator code

A second step at login: your password plus a 6-digit code from your phone.

1. On your Mac, in Terminal, in the project folder:
   ```bash
   npm run hosted:authenticator
   ```
2. It prints a **secret**. Copy it.
3. In Railway → Variables, add `TOTP_SECRET` = that secret. Redeploy.
4. On your iPhone: **Settings → Passwords**, open (or create) the entry for your app address → **Set Up Verification Code** → **Enter Setup Key** → paste the secret.
5. From now on, login asks for the code too. iPhone can fill it in for you.

Email codes instead would need an outside email service, so they aren't built in.

---

## Step 6 · Upload your data (one time)

This copies your Mac's database and Plaid tokens to Railway, so every bank stays connected.

1. On your Mac, in Terminal, in the project folder:
   ```bash
   npm run hosted:upload -- https://YOUR-APP-ADDRESS
   ```
2. It shows what it will send, for example "7 connections, 25 accounts, … no pay data".
3. Type your `APP_PASSWORD` (it stays hidden as you type), then the authenticator code if you set one up (otherwise press Enter).
4. You should see **✓ Uploaded**.
5. Open your app address and tap **Sync now**.

**What the upload does to keep things safe**

- It works on a **copy** of your database. Your Mac's data is never changed.
- Pay data is removed from the copy before sending.
- Everything goes over HTTPS, and only after logging in.
- The server checks the file first (valid database, a token for every connection, no pay data) and changes nothing if a check fails.
- If the server already has data, it refuses. To overwrite on purpose, add `--replace`; the old files are kept as backups on the volume.

---

## Step 7 · Let banks send you back to the app (Plaid redirect)

Some banks open their own sign-in page and then return to the app. On a phone, that return needs an address registered with Plaid.

1. Plaid Dashboard → API settings → **Allowed redirect URIs** → add: `https://YOUR-APP-ADDRESS/oauth`
2. Save in Plaid.
3. Then, in Railway → Variables, add `PLAID_REDIRECT_URI` = the same `https://YOUR-APP-ADDRESS/oauth`. Redeploy.

Do them in this order: if the variable is set before Plaid knows the address, opening Plaid in the app shows an error.

You only need this when re-connecting a bank or adding investment details. Never add a bank as a new connection: use **Re-connect** on the existing one, which doesn't use a Trial slot.

---

## Step 8 · Add it to your iPhone home screen

1. On your iPhone, open **Safari** and go to your app address.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the home screen and **log in there once**. The home-screen app keeps its own login, separate from Safari.
4. It stays signed in for 30 days on that phone.

---

## Everyday use

| Thing | How it works |
|---|---|
| Daily sync | Automatic, once a day after 6:00 (your `TZ`). The **Sync now** button still works anytime. |
| Updates | Pushing new code to GitHub's main redeploys automatically. Your data on the volume stays. |
| Wrong password | After 5 wrong tries in a row, login locks for 15 minutes. |
| Log out | Connections & files → **Log out on this device**. |
| Sign out every device | Change `APP_PASSWORD` (or `SESSION_SECRET`) in Railway and redeploy. |
| Pay data later | Set `HOSTED_INCLUDE_COMPENSATION=true`, then rerun the upload with `--replace --include-pay`. Pay documents are still added on your Mac (reading them needs macOS). |
| Mac app | Keeps working as before, with its own copy of the data. Changes made online (category edits, matches) don't flow back to the Mac. Pick one as your main place. |

## If something goes wrong

| What you see | What to do |
|---|---|
| Deploy fails | Service → **Deployments** → open the latest → **View logs**. Most often a missing variable from Step 4. |
| "Couldn't reach the app" during upload | Check the address starts with `https://`, and that the latest deploy is green. |
| "The server already has N connections" | It's protecting existing data. Add `--replace` only if you mean to overwrite. |
| Login says "Too many wrong tries" | Wait 15 minutes. |
| Plaid shows a redirect error | Step 7 order: add the address in Plaid first, then the variable. |
