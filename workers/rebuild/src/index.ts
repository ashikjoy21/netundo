/**
 * netundo-rebuild — Cloudflare Worker (cron only)
 *
 * Triggers a fresh Cloudflare Pages build + deploy on a schedule so the
 * statically-generated locality pages re-bake the latest speed-test aggregates
 * into their HTML. Pages must be connected to the Git repo (Pages → Settings →
 * Builds & deployments) and a Deploy Hook created; store its URL as a secret:
 *
 *   wrangler secret put DEPLOY_HOOK_URL
 *
 * The cron cadence is configured in wrangler.toml.
 */

interface Env {
  DEPLOY_HOOK_URL: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DEPLOY_HOOK_URL) {
      console.error('DEPLOY_HOOK_URL secret is not set; skipping rebuild trigger.');
      return;
    }
    ctx.waitUntil(triggerDeploy(env.DEPLOY_HOOK_URL));
  },

  // Manual trigger for testing: POST to the worker URL.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('netundo-rebuild: POST to trigger a deploy.', { status: 405 });
    }
    if (!env.DEPLOY_HOOK_URL) {
      return new Response('DEPLOY_HOOK_URL not configured', { status: 503 });
    }
    const ok = await triggerDeploy(env.DEPLOY_HOOK_URL);
    return new Response(ok ? 'Deploy triggered' : 'Deploy hook failed', { status: ok ? 202 : 502 });
  },
};

async function triggerDeploy(hookUrl: string): Promise<boolean> {
  try {
    const res = await fetch(hookUrl, { method: 'POST' });
    if (!res.ok) {
      console.error('Deploy hook returned', res.status, await res.text());
      return false;
    }
    console.log('Pages deploy triggered successfully.');
    return true;
  } catch (err) {
    console.error('Failed to call deploy hook', err);
    return false;
  }
}
