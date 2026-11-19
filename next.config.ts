import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const authUrl = process.env.AUTH_URL;
const allowedDevOrigins = authUrl ? [new URL(authUrl).host] : [];

const nextConfig: NextConfig = {
  // Hosting Plan B (ADR-0009): self-contained Node server output for the
  // production Dockerfile (hosting/Dockerfile). Adds .next/standalone to the
  // build; does not change `next dev` or existing `next start` behaviour.
  output: 'standalone',
  // Pin the trace root to this project. Without it Next 15 infers the git
  // repo root, which nests the standalone layout under
  // .next/standalone/.worktrees/<name>/ when building from a worktree.
  // Explicit is also what the Next docs recommend for Docker determinism.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  images: {
    domains: ['static.usernames.app-backend.toolsforhumanity.com'],
  },
  allowedDevOrigins,
  reactStrictMode: false,
};

export default nextConfig;
