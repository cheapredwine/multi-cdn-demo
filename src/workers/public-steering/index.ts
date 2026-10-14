/**
 * Public steering Worker.
 *
 * Sits in front of the Cloudflare CDN pool. Three steering modes:
 * - passthrough: serve directly from R2, inject `served-by: cf-edge`
 * - path_routing: `/video/*` served from R2 (cf-edge); other paths 302 to CloudFront
 * - percent_rollout: ROLLOUT_PCT% served from R2; rest 302 to CloudFront
 *
 * In path_routing mode, the redirect to CloudFront for non-video paths is the
 * mechanism that makes "video locked to CF" substantively true (not just a
 * response header). Demo curl loops on `/video/*` show only `served-by: cf-edge`;
 * loops on `/images/*` show 302s with Location pointing at the CloudFront pool.
 */

import { incrementBytesServed } from "../../lib/meter";
import type { Env } from "../../types";

const MODE_PASSTHROUGH = "passthrough";
const MODE_PATH_ROUTING = "path_routing";
const MODE_PERCENT_ROLLOUT = "percent_rollout";

const PROVIDERS = [
	{ slug: "alvarez", name: "Dr. Elena Alvarez", role: "Cardiology" },
	{ slug: "chen", name: "Dr. Marcus Chen", role: "Neurology" },
	{ slug: "okafor", name: "Dr. Amara Okafor", role: "Oncology" },
	{ slug: "rahman", name: "Dr. Tariq Rahman", role: "Orthopedics" },
	{ slug: "subramaniam", name: "Dr. Priya Subramaniam", role: "Pediatrics" },
] as const;

function cloudfrontHostname(env: Env): string {
	return `cloudfront-pool.${env.DOMAIN || "demo.jsherron.com"}`;
}

function isCloudFrontRequest(request: Request): boolean {
	const via = request.headers.get("via") || "";
	const ua = request.headers.get("user-agent") || "";
	return (
		request.headers.has("x-multicdn-demo-secret") ||
		via.toLowerCase().includes("cloudfront") ||
		ua.toLowerCase().includes("cloudfront")
	);
}

function renderLandingPage(
	servedBy: "cf-edge" | "cloudfront",
	mode: string,
	domain: string
): string {
	const isCf = servedBy === "cf-edge";
	const heroLabel = isCf ? "Cloudflare Edge (cf-edge)" : "AWS CloudFront (cloudfront)";
	const heroBg = isCf ? "bg-orange-500" : "bg-indigo-600";
	const heroPill = isCf
		? "bg-orange-100 text-orange-900 border-orange-300"
		: "bg-indigo-100 text-indigo-900 border-indigo-300";

	const providerCards = PROVIDERS.map(
		(p) => `
      <div class="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col items-center text-center">
        <img id="img-${p.slug}" src="/images/providers/${p.slug}.jpg" alt="${p.name}" class="w-20 h-20 rounded-full object-cover mb-2 border-2 border-gray-300" />
        <p class="font-semibold text-gray-800 text-sm">${p.name}</p>
        <p class="text-xs text-gray-500 mb-2">${p.role}</p>
        <span id="badge-${p.slug}" class="text-xs font-mono px-2.5 py-0.5 rounded-full bg-gray-200 text-gray-700">checking...</span>
      </div>`
	).join("");

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-CDN Live Steering — Demo Hospital</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen p-4 md:p-8">
  <div class="max-w-5xl mx-auto space-y-6">
    <div id="heroBanner" class="${heroBg} text-white rounded-2xl shadow-lg p-6 md:p-8 transition-colors duration-300">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs uppercase tracking-wider font-semibold opacity-90">Multi-CDN Load Balancer · Live Who-Served-Me View</p>
          <h1 class="text-2xl md:text-4xl font-extrabold mt-1">
            Served by: <span id="heroServedBy" class="underline decoration-white/60">${heroLabel}</span>
          </h1>
          <p class="text-sm opacity-90 mt-2">
            Single R2 origin (<code class="bg-black/20 px-1.5 py-0.5 rounded">multicdn-demo-20260505-2351</code>) · Steering mode: <code class="bg-black/20 px-1.5 py-0.5 rounded">${mode}</code>
          </p>
        </div>
        <div class="flex flex-col items-end gap-2">
          <span id="heroHeaderPill" class="px-3 py-1 rounded-full text-xs font-mono font-bold border ${heroPill}">
            served-by: ${servedBy}
          </span>
          <button onclick="window.location.href = window.location.pathname + '?cb=' + Date.now()" class="bg-white text-gray-900 hover:bg-gray-100 font-semibold text-sm px-4 py-2 rounded-lg shadow">
            Reload Page to Flip CDN
          </button>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-2xl shadow p-6">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h2 class="text-lg font-bold text-gray-900">Live Request Stream (Watching CDN Steering Flip)</h2>
          <p class="text-sm text-gray-500">Probes <code class="text-xs bg-gray-100 px-1.5 py-0.5 rounded">/images/logo.png?cb=...</code> and reads the <code class="text-xs bg-gray-100 px-1.5 py-0.5 rounded">served-by</code> response header on each request.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="togglePollBtn" class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            Pause Auto-Poll
          </button>
          <button id="burstBtn" class="bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            Burst 10 Requests
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div class="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p class="text-xs uppercase text-gray-500 font-semibold">Latest Probe</p>
          <p id="latestWinner" class="text-xl font-extrabold mt-1 text-gray-900">${servedBy}</p>
        </div>
        <div class="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p class="text-xs uppercase text-orange-800 font-semibold">Cloudflare Edge (cf-edge)</p>
          <p class="text-2xl font-extrabold text-orange-600 mt-1"><span id="cfCount">0</span> <span id="cfPct" class="text-sm font-normal text-orange-800">(0%)</span></p>
        </div>
        <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <p class="text-xs uppercase text-indigo-800 font-semibold">AWS CloudFront (cloudfront)</p>
          <p class="text-2xl font-extrabold text-indigo-600 mt-1"><span id="awsCount">0</span> <span id="awsPct" class="text-sm font-normal text-indigo-800">(0%)</span></p>
        </div>
      </div>

      <div class="w-full h-4 bg-gray-200 rounded-full overflow-hidden flex mb-4">
        <div id="cfBar" class="bg-orange-500 h-full transition-all duration-300" style="width: 50%"></div>
        <div id="awsBar" class="bg-indigo-600 h-full transition-all duration-300" style="width: 50%"></div>
      </div>

      <div id="chipStream" class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs font-mono"></div>
    </div>

    <div class="bg-white rounded-2xl shadow p-6">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h2 class="text-lg font-bold text-gray-900">Provider Directory Assets (Per-Image CDN Attribution)</h2>
          <p class="text-sm text-gray-500">Each image is fetched from the same R2 bucket through the Load Balancer; its badge shows which CDN served that specific file.</p>
        </div>
        <button id="refreshProvidersBtn" class="bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300">
          Re-fetch All 5 Images
        </button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        ${providerCards}
      </div>
    </div>

    <div class="text-xs text-gray-500 flex flex-wrap justify-between gap-2 px-1">
      <span>Companion views: <a href="https://portal.${domain}" class="underline hover:text-gray-800">Patient Portal</a> · <a href="https://audit.${domain}" class="underline hover:text-gray-800">Live Audit Log</a> · <a href="https://meter.${domain}" class="underline hover:text-gray-800">Zero-Egress Meter</a></span>
      <span>Direct pools: <a href="https://cf-pool.${domain}/" class="underline hover:text-gray-800">cf-pool</a> · <a href="https://cloudfront-pool.${domain}/" class="underline hover:text-gray-800">cloudfront-pool</a></span>
    </div>
  </div>

  <script>
    const providers = ['alvarez', 'chen', 'okafor', 'rahman', 'subramaniam'];
    let cfTotal = 0;
    let awsTotal = 0;
    let seq = 0;
    let pollTimer = null;

    function styleHeroFor(sb) {
      const isCf = sb.toLowerCase().includes('cf') && !sb.toLowerCase().includes('cloudfront');
      const banner = document.getElementById('heroBanner');
      const title = document.getElementById('heroServedBy');
      const pill = document.getElementById('heroHeaderPill');
      banner.className = (isCf ? 'bg-orange-500' : 'bg-indigo-600') + ' text-white rounded-2xl shadow-lg p-6 md:p-8 transition-colors duration-300';
      title.textContent = isCf ? 'Cloudflare Edge (cf-edge)' : 'AWS CloudFront (cloudfront)';
      pill.textContent = 'served-by: ' + sb;
      pill.className = 'px-3 py-1 rounded-full text-xs font-mono font-bold border ' +
        (isCf ? 'bg-orange-100 text-orange-900 border-orange-300' : 'bg-indigo-100 text-indigo-900 border-indigo-300');
    }

    function recordHit(sb) {
      seq++;
      const lower = (sb || 'unknown').toLowerCase();
      const isCf = lower.includes('cf') && !lower.includes('cloudfront');
      if (isCf) cfTotal++;
      else if (lower.includes('cloudfront')) awsTotal++;

      const total = cfTotal + awsTotal || 1;
      const cfPct = Math.round((cfTotal / total) * 100);
      const awsPct = 100 - cfPct;

      document.getElementById('cfCount').textContent = String(cfTotal);
      document.getElementById('cfPct').textContent = '(' + cfPct + '%)';
      document.getElementById('awsCount').textContent = String(awsTotal);
      document.getElementById('awsPct').textContent = '(' + awsPct + '%)';
      document.getElementById('cfBar').style.width = cfPct + '%';
      document.getElementById('awsBar').style.width = awsPct + '%';

      const latest = document.getElementById('latestWinner');
      latest.textContent = '#' + seq + ' → ' + sb;
      latest.className = 'text-xl font-extrabold mt-1 ' + (isCf ? 'text-orange-600' : 'text-indigo-600');
      styleHeroFor(sb);

      const chip = document.createElement('span');
      chip.className = 'px-2 py-0.5 rounded font-semibold ' +
        (isCf ? 'bg-orange-100 text-orange-800 border border-orange-300' : 'bg-indigo-100 text-indigo-800 border border-indigo-300');
      chip.textContent = '#' + seq + ' ' + sb;
      const stream = document.getElementById('chipStream');
      stream.insertBefore(chip, stream.firstChild);
      while (stream.children.length > 60) {
        stream.removeChild(stream.lastChild);
      }
    }

    async function probeOnce() {
      try {
        const cb = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const resp = await fetch('/images/logo.png?cb=' + cb, { method: 'HEAD', cache: 'no-store' });
        const sb = resp.headers.get('served-by') || 'unknown';
        recordHit(sb);
      } catch (err) {
        console.error('Probe failed:', err);
      }
    }

    async function loadProviders() {
      await Promise.all(providers.map(async (slug) => {
        const badge = document.getElementById('badge-' + slug);
        const img = document.getElementById('img-' + slug);
        badge.textContent = 'loading...';
        badge.className = 'text-xs font-mono px-2.5 py-0.5 rounded-full bg-gray-200 text-gray-700';
        try {
          const cb = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
          const url = '/images/providers/' + slug + '.jpg?cb=' + cb;
          const resp = await fetch(url, { cache: 'no-store' });
          const sb = resp.headers.get('served-by') || 'unknown';
          const blob = await resp.blob();
          img.src = URL.createObjectURL(blob);
          const isCf = sb.toLowerCase().includes('cf') && !sb.toLowerCase().includes('cloudfront');
          badge.textContent = sb;
          badge.className = 'text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border ' +
            (isCf ? 'bg-orange-100 text-orange-900 border-orange-300' : 'bg-indigo-100 text-indigo-900 border-indigo-300');
          img.className = 'w-20 h-20 rounded-full object-cover mb-2 border-4 ' +
            (isCf ? 'border-orange-500' : 'border-indigo-600');
        } catch (e) {
          badge.textContent = 'error';
        }
      }));
    }

    document.getElementById('togglePollBtn').addEventListener('click', () => {
      const btn = document.getElementById('togglePollBtn');
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        btn.textContent = 'Resume Auto-Poll';
        btn.className = 'bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg';
      } else {
        pollTimer = setInterval(probeOnce, 1500);
        btn.textContent = 'Pause Auto-Poll';
        btn.className = 'bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg';
      }
    });

    document.getElementById('burstBtn').addEventListener('click', async () => {
      for (let i = 0; i < 10; i++) {
        await probeOnce();
      }
    });

    document.getElementById('refreshProvidersBtn').addEventListener('click', loadProviders);

    probeOnce();
    loadProviders();
    pollTimer = setInterval(probeOnce, 1500);
  </script>
</body>
</html>`;
}

/**
 * Normalize incoming path to R2 object key.
 * Strips leading `/` and ensures `public/` prefix.
 *
 * @param pathname - raw request pathname
 * @returns R2 object key
 */
function normalizePath(pathname: string): string {
	const trimmed = pathname.replace(/^\//, "");
	if (trimmed.startsWith("public/")) {
		return trimmed;
	}
	return `public/${trimmed}`;
}

/**
 * Serve an object from the R2 bucket and meter the bytes served.
 *
 * @param env - Worker env with R2 binding
 * @param ctx - execution context, used to defer the meter write off the critical path
 * @param key - R2 object key
 * @param extraHeaders - additional response headers
 * @returns Response or null if not found
 */
async function serveFromR2(
	env: Env,
	ctx: ExecutionContext,
	key: string,
	extraHeaders: Record<string, string> = {}
): Promise<Response | null> {
	const object = await env.BUCKET.get(key);
	if (!object) {
		return null;
	}

	ctx.waitUntil(incrementBytesServed(env, object.size));

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	headers.set("served-by", "cf-edge");
	headers.set("access-control-expose-headers", "served-by, routing-decision");
	for (const [k, v] of Object.entries(extraHeaders)) {
		headers.set(k, v);
	}

	return new Response(object.body, { headers });
}

/**
 * Main fetch handler.
 *
 * @param request - incoming request
 * @param env - Worker environment
 * @param ctx - execution context (used for deferred meter writes)
 * @returns Response
 */
export async function handlePublicSteering(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	const url = new URL(request.url);
	const mode = env.STEERING_MODE || MODE_PASSTHROUGH;

	if (url.pathname === "/" || url.pathname === "/index.html") {
		const servedBy = isCloudFrontRequest(request) ? "cloudfront" : "cf-edge";
		const domain = env.DOMAIN || "demo.jsherron.com";
		const html = renderLandingPage(servedBy, mode, domain);
		return new Response(html, {
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "private, no-store, no-cache, must-revalidate, max-age=0",
				"served-by": servedBy,
				"access-control-expose-headers": "served-by, routing-decision",
			},
		});
	}

	// Passthrough mode: serve everything from R2
	if (mode === MODE_PASSTHROUGH) {
		const key = normalizePath(url.pathname);
		const resp = await serveFromR2(env, ctx, key);
		if (resp) return resp;
		return new Response("Not found", { status: 404 });
	}

	// Path routing mode: video served from R2 (CF pool), everything else 302→CloudFront
	if (mode === MODE_PATH_ROUTING) {
		if (url.pathname.startsWith("/video/")) {
			const key = normalizePath(url.pathname);
			const resp = await serveFromR2(env, ctx, key, {
				"routing-decision": "video-locked-to-cf",
			});
			if (resp) return resp;
			return new Response("Not found", { status: 404 });
		}
		// Non-video paths get redirected to CloudFront so the steering decision
		// is actually behavioral, not just a response-header label.
		const cfUrl = `https://${cloudfrontHostname(env)}${url.pathname}`;
		return Response.redirect(cfUrl, 302);
	}

	// Percent rollout mode: randomly redirect some traffic to CloudFront
	if (mode === MODE_PERCENT_ROLLOUT) {
		const pct = Number.parseInt(env.ROLLOUT_PCT || "0", 10);
		const roll = Math.floor(Math.random() * 100);
		if (roll < pct) {
			// Serve from R2 via this Worker
			const key = normalizePath(url.pathname);
			const resp = await serveFromR2(env, ctx, key, {
				"routing-decision": "rollout-cf",
			});
			if (resp) return resp;
			return new Response("Not found", { status: 404 });
		}
		// Redirect to CloudFront
		const cfUrl = `https://${cloudfrontHostname(env)}${url.pathname}`;
		return Response.redirect(cfUrl, 302);
	}

	return new Response("Unknown steering mode", { status: 500 });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handlePublicSteering(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
