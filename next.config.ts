import type { NextConfig } from "next";

/**
 * Which build is this?
 *
 * Netlify sets COMMIT_REF at build time. Inlining a short form of it means the
 * error screen can say which version of the app a phone is actually running -
 * which turns "I deployed a fix but it still fails" from a guess into a fact.
 * Browsers and installed apps hold on to old code far longer than anyone
 * expects, and without this there is no way to tell that apart from a bug.
 */
const buildRef =
  process.env.COMMIT_REF?.slice(0, 7) ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  "local";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_REF: buildRef,
  },
};

export default nextConfig;
