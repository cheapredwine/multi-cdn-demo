/**
 * Audit Worker.
 *
 * Serves the live audit-log viewer. The API base URL is injected from the
 * runtime `DOMAIN` variable so the same code deploys to any zone without edits.
 */

import type { Env } from "../../types";

function renderAudit(domain: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit Log — Live</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @keyframes flash {
      from { background-color: #fef3c7; }
      to { background-color: transparent; }
    }
    .flash-new { animation: flash 1s ease-out; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen p-4">
  <div class="max-w-5xl mx-auto">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 bg-blue-900 rounded-lg flex items-center justify-center text-white font-bold text-sm">DH</div>
      <h1 class="text-xl font-bold text-blue-900">Audit Log — Live</h1>
      <span class="ml-auto flex items-center gap-2 text-sm text-green-600">
        <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
        Polling every 2s
      </span>
    </div>

    <div class="bg-white rounded-xl shadow-lg overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-blue-900 text-white">
          <tr>
            <th class="text-left px-4 py-3 font-semibold">Timestamp</th>
            <th class="text-left px-4 py-3 font-semibold">Subject</th>
            <th class="text-left px-4 py-3 font-semibold">Path</th>
            <th class="text-left px-4 py-3 font-semibold">IP</th>
            <th class="text-left px-4 py-3 font-semibold">Decision</th>
            <th class="text-left px-4 py-3 font-semibold">Reason</th>
          </tr>
        </thead>
        <tbody id="auditBody" class="divide-y divide-gray-100">
          <tr id="emptyRow">
            <td colspan="6" class="px-4 py-8 text-center text-gray-400">Waiting for audit events...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    const API_BASE = 'https://secure.${domain}';
    const seen = new Set();

    function entryKey(entry) {
      return entry.jti || \`\${entry.ts}|\${entry.path}|\${entry.decision}|\${entry.reason || ''}\`;
    }

    function formatTs(ts) {
      const d = new Date(ts);
      const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const time = d.toLocaleTimeString(undefined, { hour12: false });
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return \`\${date} \${time}.\${ms}\`;
    }

    function decisionColor(decision) {
      return decision === 'allow'
        ? 'bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-medium'
        : 'bg-red-100 text-red-800 px-2 py-0.5 rounded-full text-xs font-medium';
    }

    function buildRow(entry) {
      const tr = document.createElement('tr');
      tr.className = 'flash-new';
      tr.innerHTML = \`
        <td class="px-4 py-2 text-gray-600 font-mono text-xs">\${formatTs(entry.ts)}</td>
        <td class="px-4 py-2 text-gray-800">\${entry.sub || '-'}</td>
        <td class="px-4 py-2 text-gray-600 font-mono text-xs">\${entry.path || '-'}</td>
        <td class="px-4 py-2 text-gray-600 font-mono text-xs">\${entry.ip || '-'}</td>
        <td class="px-4 py-2"><span class="\${decisionColor(entry.decision)}">\${entry.decision}</span></td>
        <td class="px-4 py-2 text-gray-500 text-xs">\${entry.reason || ''}</td>
      \`;
      return tr;
    }

    async function poll() {
      try {
        const resp = await fetch(\`\${API_BASE}/audit/recent\`);
        const entries = await resp.json();
        if (entries.length === 0) return;

        const tbody = document.getElementById('auditBody');
        const emptyRow = document.getElementById('emptyRow');
        if (emptyRow) emptyRow.remove();

        const fresh = [];
        for (const entry of entries) {
          const key = entryKey(entry);
          if (!seen.has(key)) {
            seen.add(key);
            fresh.push(entry);
          }
        }

        for (const entry of [...fresh].reverse()) {
          tbody.insertBefore(buildRow(entry), tbody.firstChild);
        }

        while (tbody.children.length > 100) {
          tbody.removeChild(tbody.lastChild);
        }
      } catch (e) {
        console.error('Poll failed:', e);
      }
    }

    poll();
    setInterval(poll, 2000);
  </script>
</body>
</html>`;
}

export function handleAudit(_request: Request, env: Env): Response {
	const domain = env.DOMAIN || "demo.jsherron.com";
	const html = renderAudit(domain);
	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return handleAudit(request, env);
	},
} satisfies ExportedHandler<Env>;
