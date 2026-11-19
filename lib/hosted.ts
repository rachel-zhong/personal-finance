/**
 * Settings for running the app on a server (Railway) instead of your Mac.
 * Every value comes from environment variables, so the same code runs in both places.
 */

/** True on Railway (it sets RAILWAY_ENVIRONMENT_NAME) or when HOSTED=1. */
export function isHosted() {
  return process.env.HOSTED === "1" || !!process.env.RAILWAY_ENVIRONMENT_NAME;
}

/** The demo website (DEMO=1): made-up data, rebuilt on every start and every night; banks and uploads turned off. */
export function isDemo() {
  return process.env.DEMO === "1";
}

/** Login is on whenever a password is set (always set it when hosted). */
export function authEnabled() {
  return !!process.env.APP_PASSWORD;
}

/**
 * Pay data: always on your Mac. On a server only when HOSTED_INCLUDE_COMPENSATION=true.
 * When off, the Compensation tab and every pay route are hidden.
 */
export function compensationEnabled() {
  return isDemo() || !isHosted() || process.env.HOSTED_INCLUDE_COMPENSATION === "true";
}

/** Reading pay PDFs needs Apple's PDFKit and Vision, so uploads only work on a Mac. */
export function payUploadsEnabled() {
  return !isHosted() && process.env.NODE_ENV !== "test";
}
