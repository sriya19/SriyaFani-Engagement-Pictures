import { writeFile } from "node:fs/promises";
import { build } from "vite";

const apiOrigin = new URL(process.env.ALBUM_API_ORIGIN || "https://sriya-fani-engagement-album.milkycabin2.chatgpt.site").origin;
if (!apiOrigin.startsWith("https://")) throw new Error("Use an HTTPS album backend.");
await build({
  mode: "pages",
  base: "/SriyaFani-Engagement-Pictures/",
  define: { "import.meta.env.VITE_ALBUM_API_ORIGIN": JSON.stringify(apiOrigin) },
  plugins: [{
    name: "guest-page-security",
    transformIndexHtml() {
      return [{
        tag: "meta", injectTo: "head-prepend",
        attrs: { "http-equiv": "Content-Security-Policy", content:
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src " + apiOrigin +
          "; img-src 'self' blob:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'" },
      }];
    },
  }],
});
await writeFile("dist/.nojekyll", "");
