import { albumApi } from "./album/api.js";
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      // This deployment authenticates its host by a verified, configured mobile number.
      // Platform identity headers are meaningful only on the managed Sites gateway.
      return albumApi(request, { ...env, SITES_OWNER_EMAIL: undefined }, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
