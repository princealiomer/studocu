import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright-core', 'playwright-aws-lambda'],
};

export default nextConfig;
