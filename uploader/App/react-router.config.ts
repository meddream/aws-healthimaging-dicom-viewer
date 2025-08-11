import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: false,
  //basename: "/uploader" // Uncomment for compiligng for PROD
  basename: import.meta.env.BASE_URL,
} satisfies Config;
