/**
 * Optional second login step: makes a secret for an authenticator app (iPhone Passwords, Google Authenticator, 1Password …).
 *
 *   npm run hosted:authenticator
 *
 * Put the printed secret in Railway as TOTP_SECRET, and add the same secret to your authenticator app.
 * Nothing is saved on this Mac. Don't share or commit the secret.
 */
import { randomBytes } from "node:crypto";
import { base32Encode } from "../../lib/auth";

const secret = base32Encode(randomBytes(20));
const uri = `otpauth://totp/My%20Money?secret=${secret}&issuer=My%20Money&algorithm=SHA1&digits=6&period=30`;
console.log(`
Secret (Railway variable TOTP_SECRET, and "setup key" in your authenticator app):

  ${secret.match(/.{1,4}/g)!.join(" ")}

iPhone: Settings > Passwords > (new password for your app's address) > Set Up Verification Code > Enter Setup Key.
Or paste this link into an app that accepts otpauth links:
  ${uri}
`);
