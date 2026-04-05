import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: [], // example top-level setting
}

nextConfig.allowedDevOrigins = ['192.168.56.1']

export default nextConfig
