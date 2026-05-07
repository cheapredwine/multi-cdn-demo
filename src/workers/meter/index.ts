/**
 * Egress meter Worker.
 *
 * Displays live origin egress costs and comparisons.
 * Reads bytes-served counter from R2, updated by public and secure Workers.
 */

import { currentHourKey } from "../../lib/meter";
import type { Env } from "../../types";

function formatGB(bytes: number): string {
	return (bytes / 1e9).toFixed(2);
}

function formatDollars(cents: number): string {
	if (cents === 0) return "$0.00";
	const dollars = cents / 100;
	return `$${dollars.toFixed(2)}`;
}

async function getBytesServed(env: Env): Promise<number> {
	const key = currentHourKey();
	const object = await env.BUCKET.get(key);
	if (!object) return 0;
	try {
		const text = await object.text();
		const data = JSON.parse(text);
		return Number(data.bytes) || 0;
	} catch {
		return 0;
	}
}

const PROVIDERS = [
	{ name: "AWS S3 egress", listPrice: 0.09, enterprisePrice: 0.05 },
	{ name: "Azure Blob egress", listPrice: 0.087, enterprisePrice: 0.05 },
	{ name: "GCS multi-region", listPrice: 0.12, enterprisePrice: 0.08 },
	{ name: "Cloudflare R2", listPrice: 0.0, enterprisePrice: 0.0 },
];

const SCENARIOS = [
	{ label: "10 TB/month", savings: 1800, description: "small hospital web presence" },
	{ label: "50 TB/month", savings: 9000, description: "mid-size system" },
	{ label: "100 TB/month", savings: 18000, description: "large multi-facility" },
	{ label: "500 TB/month", savings: 90000, description: "regional health network" },
];

function renderMeter(bytes: number, demoSeed = 0): Response {
	const totalBytes = bytes + demoSeed * 1e9;
	const totalGB = totalBytes / 1e9;

	const rows = PROVIDERS.map((p) => {
		const listCost = totalGB * p.listPrice;
		const entCost = totalGB * p.enterprisePrice;
		return `<tr class="${p.name.includes("R2") ? "highlight" : ""}">
      <td>${p.name}</td>
      <td>$${p.listPrice.toFixed(2)}/GB</td>
      <td>$${p.enterprisePrice.toFixed(2)}/GB</td>
      <td>${formatDollars(Math.round(listCost * 100))}</td>
      <td>${formatDollars(Math.round(entCost * 100))}</td>
    </tr>`;
	}).join("");

	const scenarioRows = SCENARIOS.map((s) => {
		return `<tr>
      <td>${s.label}</td>
      <td>${formatDollars(s.savings * 100)}</td>
      <td>${s.description}</td>
    </tr>`;
	}).join("");

	const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Origin Egress Meter</title>
  <meta http-equiv="refresh" content="10">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8f9fa;
      color: #333;
      line-height: 1.4;
      padding: 1rem 1.5rem;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 { color: #1a3a5c; margin: 0 0 0.75rem; font-size: 1.4rem; }
    h2 { color: #1a3a5c; margin: 1rem 0 0.5rem; font-size: 1.05rem; }
    .hero {
      text-align: center;
      padding: 1.25rem 1.5rem;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      margin-bottom: 1rem;
    }
    .hero .amount {
      font-size: 64pt;
      font-weight: 800;
      color: #F38020;
      line-height: 1;
    }
    .hero .sub {
      font-size: 1rem;
      color: #666;
      margin-top: 0.4rem;
    }
    .hero .bytes {
      font-size: 0.85rem;
      color: #888;
      margin-top: 0.2rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    th, td { padding: 0.4rem 0.75rem; text-align: left; }
    th { background: #1a3a5c; color: white; font-weight: 600; font-size: 0.8rem; }
    td { font-size: 0.9rem; }
    tr:nth-child(even) { background: #f8f9fa; }
    tr.highlight { background: #fff3e6; font-weight: 600; }
    tr.highlight td { color: #F38020; }
    .footnote {
      font-size: 0.75rem;
      color: #666;
      margin-top: 0.5rem;
      padding: 0.6rem 0.85rem;
      background: white;
      border-radius: 6px;
      line-height: 1.4;
    }
    .empty {
      text-align: center;
      padding: 1rem;
      color: #888;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
  </style>
</head>
<body>
  <h1>Origin Egress Meter</h1>
  <div class="hero">
    <div class="amount">$0.00</div>
    <div class="sub">Origin egress charges, this hour, real traffic</div>
    <div class="bytes">Bytes served from R2: ${formatGB(totalBytes)} GB</div>
  </div>
  <h2>What this same traffic would cost on traditional clouds</h2>
  ${
		totalBytes === 0
			? '<div class="empty">Run some traffic to see comparisons</div>'
			: `
  <table>
    <thead><tr><th>Provider</th><th>List price</th><th>Enterprise blended</th><th>This hour (list)</th><th>This hour (enterprise)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
	}
  <h2>Scale this to a hospital system's real volume</h2>
  <table>
    <thead><tr><th>If your system serves...</th><th>Annual egress savings (30% miss rate, $0.05/GB blended)</th><th>&nbsp;</th></tr></thead>
    <tbody>${scenarioRows}</tbody>
  </table>
  <div class="footnote">
    Assumes 30% origin cache miss rate (typical for multi-CDN). Higher miss rates increase savings proportionally; list-price savings run ~1.8x the blended numbers above. Methodology counts bytes pulled from R2 origin only (cf-cache-status MISS/EXPIRED/BYPASS); CloudFront pool traffic is opaque to Cloudflare so the meter slightly understates.
  </div>
</body>
</html>`;

	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

export async function handleMeter(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const demoSeed = Number.parseFloat(url.searchParams.get("demo_seed") || "0");
	const bytes = await getBytesServed(env);
	return renderMeter(bytes, demoSeed);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return handleMeter(request, env);
	},
} satisfies ExportedHandler<Env>;
