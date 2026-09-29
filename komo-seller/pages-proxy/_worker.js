const ORIGIN = "https://komo-seller.siastreet.workers.dev";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const dest = new URL(incoming.pathname + incoming.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", incoming.host);
    headers.delete("Host");
    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }
    const res = await fetch(dest, init);
    const out = new Headers(res.headers);
    const loc = out.get("Location");
    if (loc) {
      try {
        const u = new URL(loc, ORIGIN);
        if (u.hostname.endsWith("siastreet.workers.dev")) {
          u.protocol = incoming.protocol;
          u.host = incoming.host;
          out.set("Location", u.toString());
        }
      } catch (_) {}
    }
    return new Response(res.body, { status: res.status, headers: out });
  },
};
