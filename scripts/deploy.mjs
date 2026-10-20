// Deploys the Convex backend to production, builds the site against it, then publishes the site to Cloudflare.
// Run through `npm run deploy`, which loads .env (git-ignored) for CONVEX_PROD_DEPLOY_KEY and CLOUDFLARE_API_TOKEN.
import { spawnSync } from 'node:child_process';

const prodKey = process.env.CONVEX_PROD_DEPLOY_KEY;
// .env.local holds the dev deploy key, and `convex deploy` targets whatever key it finds, so a missing or non-production
// key here would quietly publish the dev backend. The production key is passed explicitly and checked.
if (!prodKey?.startsWith('prod:')) {
  console.error('Set CONVEX_PROD_DEPLOY_KEY in .env to a production deploy key (it starts with "prod:").');
  process.exit(1);
}
if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error('Set CLOUDFLARE_API_TOKEN in .env.');
  process.exit(1);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) {
    console.error(`${command} ${args[0]} failed; the site was not published.`);
    process.exit(result.status ?? 1);
  }
}

// `convex deploy --cmd` sets VITE_CONVEX_URL to the production deployment, runs the build, then pushes the backend,
// so the site that wrangler publishes always points at the backend that was just deployed.
run('npx', ['convex', 'deploy', '--yes', '--cmd', 'npm run build'], { ...process.env, CONVEX_DEPLOY_KEY: prodKey });
run('npx', ['wrangler', 'deploy']);
