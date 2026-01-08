# Agent Contact Form Worker

Cloudflare Worker that handles contact form submissions for the Agent Dashboard at https://agent.hyperflash.uk

**Features:**
- Validates form submissions (name, email, message)
- Rate limiting to prevent spam
- Email delivery via Resend
- CORS headers for dashboard integration
- KV storage for submission history

**Deployment:**
See `DEPLOY.md` for instructions

**Required Environment Variables:**
- `RESEND_API_KEY` - Resend API key
- `FROM_EMAIL` - Sender email address
- `FROM_NAME` - Sender name
- `NOTIFY_EMAIL` - Destination email for notifications
- `CONTACT_SUBMISSIONS` - KV namespace for submissions

**Related Repos:**
- [agent-dashboard](https://github.com/bilawalriaz/agent-dashboard) - Frontend dashboard
- [vps-config](https://github.com/bilawalriaz/vps-config) - Backend infrastructure
