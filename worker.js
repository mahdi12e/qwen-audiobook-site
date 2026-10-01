import { onRequestGet, onRequestPost, onRequestOptions } from "./functions/api/tts.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/tts" || url.pathname === "/api/tts/") {
      if (request.method === "OPTIONS") return onRequestOptions({ request, env, ctx });
      if (request.method === "GET") return onRequestGet({ request, env, ctx });
      if (request.method === "POST") return onRequestPost({ request, env, ctx });
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST, OPTIONS" }
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
