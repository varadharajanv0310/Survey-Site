import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
  },
}

export default config
