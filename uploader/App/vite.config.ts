import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";



export default defineConfig({
  base: '/uploader/', // Uncomment for compiligng for PROD
  plugins: [reactRouter()],

})