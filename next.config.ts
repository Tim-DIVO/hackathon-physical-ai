import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  // Live runs write JSON under data/ while a session plays; the dev watcher must not
  // treat that as a code change, or it recompiles and can reload the page mid-session.
  webpack: (webpackConfig, { dev }) => {
    if (dev)
      webpackConfig.watchOptions = {
        ...webpackConfig.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/data/**", "**/public/videos/**"],
      };
    return webpackConfig;
  },
};
export default config;
