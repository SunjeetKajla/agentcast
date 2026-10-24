/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages export TypeScript source (no build step); Next compiles them.
  transpilePackages: ["@agentcast/shared"],
};

module.exports = nextConfig;
