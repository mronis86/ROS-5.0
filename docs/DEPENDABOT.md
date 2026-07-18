# Dependabot — keep dependency updates manageable

GitHub Dependabot opens pull requests when npm packages have updates. Nothing deploys until you merge.

## What’s in this repo

`.github/dependabot.yml`:

- **Root** `package.json` only (main app + API)
- **Weekly** (Mondays)
- **Max 5 open PRs** so the queue can’t explode
- Ignores **major** bumps of `react-scripts` (those are noisy / high-churn for little show-day benefit)

Companion / offline package folders are **not** included yet — add later if you want.

## Turn on in GitHub (one-time)

Repo → **Settings** → **Code security and analysis** (or **Advanced Security**):

1. **Dependabot alerts** — on  
2. **Dependabot security updates** — on (PRs for known vulns; most useful)  
3. Version updates use the YAML above automatically once the file is on the default branch  

## How to treat alerts / PRs

| Prefer to review | Usually backlog |
|------------------|-----------------|
| Runtime: `express`, `socket.io`, `pg`, `helmet`, auth libs | Transitive CRA/webpack/eslint “moderate” piles |
| Anything labeled security | Pure major bumps of tooling you aren’t upgrading yet |

You do **not** need zero alerts. Aim for: security PRs reviewed reasonably soon; routine version bumps when convenient.

## Related

- [UPTIME-MONITORING.md](./UPTIME-MONITORING.md) — external API health emails  
- Admin → Services — live `/health` check from the browser  
