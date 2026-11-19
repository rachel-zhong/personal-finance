# Put My Money online with Railway

**Goal:** open the app on your phone from anywhere, with only you able to log in, and every bank still connected.

**Time:** about 30 minutes. Do the steps in order. Each step says what it is, why it's needed, how to do it, and how you'll know it worked.

---

## Words you'll see

| Word | What it means in plain terms |
|---|---|
| **Railway** | A company that rents you a computer on the internet (a "server") that runs the app all the time. |
| **Service** | Your app on Railway. It's the `personal-finance` box on your project screen. |
| **Deploy** | Railway building the app from your GitHub code and starting it. It happens by itself after every change. |
| **Volume** | A permanent storage drive attached to the server, like plugging a USB drive into it. Without it, the server forgets everything on every restart. |
| **Mount path** | The folder name the app uses for that drive. For this app it's always `/data`. |
| **Domain** | The web address of your app, like `something.up.railway.app`. |
| **Variables** | Private settings you type into Railway: passwords, keys, options. They never go to GitHub. |
| **Terminal** | The Mac app where you type commands (Applications → Utilities → Terminal). |
| **Project folder** | The finance-app folder on your Mac. In Terminal, go there first with `cd ~/Documents/finance-app`. |

**What stays private**

| Thing | Where it lives |
|---|---|
| The app's code | GitHub (public, no personal data in it) |
| Your bank data and bank keys | The volume on Railway, reachable only by the app |
| Pay data | Stays on your Mac (unless you turn it on later) |
| Passwords and keys | Railway variables |

---

## Step 0 · Set a spending limit

- **What:** a cap on how much Railway can charge you.
- **Why:** Railway bills by usage. A cap makes sure you never pay more than the $5 your plan includes. If usage hits the cap, Railway pauses the app instead of charging more.
- **How:**
  1. In Railway, click your workspace name (top left) → **Usage**.
  2. Find **Usage limits** and set a **hard limit** of **$5**.
- **You'll know it worked:** the Usage page shows the $5 limit.

**Expected cost:** about $3–5 a month (a small always-on server plus under 1 GB of storage). This is an estimate; the Usage page shows the real number after a few days. Plaid costs nothing extra.

---

## Step 1 · Create the project from GitHub ✅

- **What:** tells Railway to build the app from your GitHub code.
- **Why:** Railway needs the code to run the app.
- **How:** railway.com → **New Project** → **Deploy from GitHub repo** → pick `personal-finance`.
- **You'll know it worked:** the service shows **Deployment successful** (green).

---

## Step 2 · Attach a volume (the permanent drive)

- **What:** a storage drive attached to the app's server.
- **Why:** your database and bank keys are saved there, so they survive restarts and updates. Without it, everything would be wiped on each update.
- **How:**
  1. Open your project screen (where the `personal-finance` box is).
  2. **Right-click** the `personal-finance` box → **Attach volume**.
     - _Or:_ click **+ Create** (top right) → **Volume** → choose `personal-finance`.
  3. When asked for the **Mount path**, type exactly: `/data`
  4. Confirm.
- **You'll know it worked:** a small drive icon appears attached to the `personal-finance` box, and Railway deploys once more.

**Cost:** about $0.15 a month, inside your $5.

---

## Step 3 · Get a web address

- **What:** a public address (domain) to open your app.
- **Why:** without one, the app runs but nothing can reach it.
- **How:**
  1. Click the `personal-finance` box → **Settings** tab.
  2. Find **Networking** → click **Generate Domain**.
  3. If it asks for a port, leave the suggested one.
- **You'll know it worked:** you see an address like `something.up.railway.app`. **Copy it and keep it handy**: it's called *your app address* below.

Opening it now may show an error page. That's expected until Step 4.

---

## Step 4 · Fill in the settings (variables)

- **What:** private settings the app reads when it starts: your login password, your Plaid keys, and where the drive is.
- **Why:** the app can't log you in, reach your banks or find the drive without them.
- **How:**
  1. Click the `personal-finance` box → **Variables** tab → **Raw Editor**.
  2. Paste this block:
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
  3. Fill in the empty ones (table below), then click **Update Variables** and **Deploy** if Railway asks.

| Setting | What it is | What to type |
|---|---|---|
| `DATABASE_PATH`, `SECRETS_PATH` | Where on the drive the app keeps your data | Keep as is |
| `APP_PASSWORD` | The password you'll log in with | A long password from your password manager (20+ characters) |
| `SESSION_SECRET` | A random code that keeps "stay signed in" safe. You never type it again. | In Terminal, run `openssl rand -base64 48` and paste the result |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Your Plaid keys, so the app can read your banks | Same as on your Mac. In Terminal, in the project folder: `grep PLAID .env.local` |
| `PLAID_ENV` | Use your real banks, not Plaid's test banks | Keep `production` |
| `TZ` | Your time zone, so "today" and the daily sync match your clock | e.g. `America/Los_Angeles` or `America/New_York` |
| `HOSTED_INCLUDE_COMPENSATION` | Whether pay data is allowed online | Keep `false` (pay stays on your Mac) |

- **You'll know it worked:** after the deploy turns green, open your app address. You see a **login page** that says "My Money · Private". Log in with your `APP_PASSWORD`. The app is empty for now; your data comes in Step 6.

---

## Step 5 · (Optional) Add a 6-digit login code

- **What:** a second login step. After the password, you type a 6-digit code that your iPhone generates and changes every 30 seconds.
- **Why:** even if someone learns your password, they can't log in without your phone.
- **How:**
  1. In Terminal, in the project folder: `npm run hosted:authenticator`
  2. It prints a **secret** (a group of letters and numbers). Copy it.
  3. In Railway → **Variables** → add `TOTP_SECRET` = that secret → deploy.
  4. On your iPhone: **Settings → Passwords** → open or create the entry for your app address → **Set Up Verification Code** → **Enter Setup Key** → paste the secret.
- **You'll know it worked:** the login page now asks for a code, and your iPhone offers to fill it in.

Email codes aren't included: they'd need an outside email service, which may cost money.

---

## Step 6 · Copy your data to Railway (one time)

- **What:** sends a copy of your Mac's data and bank keys to the drive on Railway.
- **Why:** so every bank stays connected. Reconnecting would use up Plaid Trial slots.
- **How:**
  1. Open Terminal and go to the project folder: `cd ~/Documents/finance-app`
  2. Run (replace with your app address):
     ```bash
     npm run hosted:upload -- https://YOUR-APP-ADDRESS
     ```
  3. It shows what it will send, for example "7 connections, 25 accounts … no pay data".
  4. Type your `APP_PASSWORD`. Nothing appears as you type; that's on purpose. Press Enter.
  5. Type the 6-digit code if you did Step 5; otherwise just press Enter.
- **You'll know it worked:** it says **✓ Uploaded**. Open your app address and tap **Sync now**: your accounts appear.

**Why it's safe**

- It sends a **copy**. Your Mac's data is never changed.
- Pay data is removed from the copy before sending.
- It's encrypted on the way, and only works after logging in.
- Railway checks the file first. If anything looks wrong, nothing changes.
- It won't overwrite data already on Railway. To overwrite on purpose, add `--replace` at the end; the old data is kept as a backup.

---

## Step 7 · Let banks send you back to the app

- **What:** registers your app address with Plaid as a safe place to return to.
- **Why:** many large banks open their own sign-in page and then send you back to the app. On a phone, Plaid only returns to addresses you've registered. You need this only when re-connecting a bank or adding investment details.
- **How (in this order):**
  1. **Plaid first:** Plaid Dashboard → API settings → **Allowed redirect URIs** → add `https://YOUR-APP-ADDRESS/oauth` → save.
  2. **Then Railway:** Variables → add `PLAID_REDIRECT_URI` = `https://YOUR-APP-ADDRESS/oauth` → deploy.
- **You'll know it worked:** on Connections & files, **Re-connect** opens Plaid without an error.

If you do Railway before Plaid, opening Plaid in the app shows an error until Plaid has the address.

Never add a bank you already have as a new connection. Use **Re-connect** on the existing one, which doesn't use a Trial slot.

---

## Step 8 · Put the app on your iPhone home screen

- **What:** an app icon on your home screen that opens My Money full screen.
- **Why:** it feels like a normal app, with no browser bars.
- **How:**
  1. On your iPhone, open **Safari** and go to your app address.
  2. Tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**.
  3. Open it from the home screen and **log in there once**. The home-screen app keeps its own login, separate from Safari.
- **You'll know it worked:** the icon opens straight into the app, and you stay logged in for 30 days.

---

## Everyday use

| Situation | What happens |
|---|---|
| Daily sync | Automatic once a day after 6:00 (your time zone). **Sync now** still works anytime. |
| App updates | When new code goes to GitHub, Railway rebuilds by itself. Your data on the drive stays. |
| 5 wrong passwords in a row | Login locks for 15 minutes. |
| Log out | Connections & files → **Log out on this device**. |
| Log out every device | Change `APP_PASSWORD` (or `SESSION_SECRET`) in Railway, then deploy. |
| Your Mac app | Keeps working, with its own separate copy of the data. Edits made online don't copy back to the Mac, so pick one as your main place. |
| Pay data online later | Set `HOSTED_INCLUDE_COMPENSATION=true`, then rerun Step 6 with `--replace --include-pay`. Pay documents are still added on your Mac. |

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Deploy shows red | The build or start failed | Click the deployment → **View logs** → send a screenshot to Claude |
| Error page instead of login | A Step 4 setting is missing | Check every Step 4 variable is filled in |
| "Couldn't reach the app" during upload | The address is wrong, or the app isn't running | Check it starts with `https://` and the deploy is green |
| "The server already has N connections" | Data is already on Railway, protected from overwriting | Add `--replace` only if you mean to overwrite |
| "Too many wrong tries" | The 15-minute lock | Wait 15 minutes |
| Plaid shows a redirect error | Step 7 done in the wrong order | Add the address in Plaid first, then the variable |

---

© 2026 rachel-zhong. All rights reserved. See [LICENSE](../LICENSE).
