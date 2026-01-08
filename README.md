# Agent Contact Form Worker

Cloudflare Worker that handles contact form submissions for the Agent Dashboard at https://agent.hyperflash.uk

**Features:**
- Validates form submissions (name, email, message)
- Rate limiting to prevent spam
- Email delivery via Mailgun
- CORS headers for dashboard integration

**Deployment:**
See `DEPLOY.md` for instructions

**Related Repos:**
- [agent-dashboard](https://github.com/bilawalriaz/agent-dashboard) - Frontend dashboard
- [vps-config](https://github.com/bilawalriaz/vps-config) - Backend infrastructure
