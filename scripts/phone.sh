#!/bin/sh
# Build and start My Money for your iPhone, reached privately over Tailscale.
# The app itself stays on 127.0.0.1:3000; `tailscale serve` shares it only with devices signed in to your tailnet.
set -e

TS="$(command -v tailscale || true)"
[ -z "$TS" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [ -z "$TS" ]; then
  echo "Tailscale isn't installed. Get it from https://tailscale.com/download (Mac and iPhone), sign in on both, then run npm run phone again."
  exit 1
fi

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 is in use (probably npm run dev). Stop it with Ctrl+C in that Terminal tab, then run npm run phone again."
  exit 1
fi

TAILSCALE_HOST="$("$TS" status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).Self?.DNSName||"").replace(/\.$/,""))}catch{console.log("")}})')"
export TAILSCALE_HOST NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-phone

npx next build
"$TS" serve --bg 3000
echo ""
echo "On your iPhone (signed in to Tailscale), open:  https://${TAILSCALE_HOST:-<your-mac>.<tailnet>.ts.net}"
echo "Then Share > Add to Home Screen. Keep this window open; Ctrl+C stops the app."
echo ""
exec npx next start -H 127.0.0.1 -p 3000
