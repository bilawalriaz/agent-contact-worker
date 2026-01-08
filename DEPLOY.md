# Agent API Worker Deployment

## Prerequisites
- Node.js installed
- Cloudflare account (you already have one)

## Step 1: Install Wrangler CLI (if not installed)
```bash
npm install -g wrangler
```

## Step 2: Login to Cloudflare
```bash
wrangler login
```

## Step 3: Create KV Namespace
```bash
cd /path/to/cf-worker
wrangler kv:namespace create "CONTACT_SUBMISSIONS"
```

This will output something like:
```
{ binding = "CONTACT_SUBMISSIONS", id = "abc123..." }
```

Copy the `id` value and update `wrangler.toml`:
```toml
kv_namespaces = [
  { binding = "CONTACT_SUBMISSIONS", id = "YOUR_ACTUAL_ID_HERE" }
]
```

## Step 4: Deploy the Worker
```bash
wrangler deploy
```

The worker will be deployed to: `agent-api.<your-subdomain>.workers.dev`

## Step 5: Add Custom Domain (Optional but recommended)

### Option A: Via Cloudflare Dashboard
1. Go to Workers & Pages in CF Dashboard
2. Click on your `agent-api` worker
3. Go to Settings > Triggers > Custom Domains
4. Add `agent-api.hyperflash.uk`

### Option B: Via DNS (add CNAME)
```bash
# Using your CF API token
curl -X POST "https://api.cloudflare.com/client/v4/zones/fa57cc61d2dfd0b954d795a766a70f1f/dns_records" \
  -H "Authorization: Bearer eUUZXJHaOzgY7pAtXrNOLwSl4d257V1krGrwLpoK" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CNAME",
    "name": "agent-api",
    "content": "agent-api.<your-subdomain>.workers.dev",
    "proxied": true,
    "ttl": 1
  }'
```

## Step 6: Set up MailChannels DNS (Required for email)

For MailChannels to send emails from your domain, add this TXT record:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/fa57cc61d2dfd0b954d795a766a70f1f/dns_records" \
  -H "Authorization: Bearer eUUZXJHaOzgY7pAtXrNOLwSl4d257V1krGrwLpoK" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TXT",
    "name": "_mailchannels",
    "content": "v=mc1 cfid=hyperflash.uk",
    "ttl": 1
  }'
```

Also add an SPF record (or update existing):
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/fa57cc61d2dfd0b954d795a766a70f1f/dns_records" \
  -H "Authorization: Bearer eUUZXJHaOzgY7pAtXrNOLwSl4d257V1krGrwLpoK" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TXT",
    "name": "hyperflash.uk",
    "content": "v=spf1 include:_spf.mx.cloudflare.net include:relay.mailchannels.net ~all",
    "ttl": 1
  }'
```

## Testing

### Test health endpoint:
```bash
curl https://agent-api.hyperflash.uk/health
```

### Test contact form:
```bash
curl -X POST https://agent-api.hyperflash.uk/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","message":"Hello from test!"}'
```

### View submissions (set your own key):
```bash
curl "https://agent-api.hyperflash.uk/submissions?key=your-secret-key-here&limit=10"
```

## Updating the Worker

After making changes:
```bash
wrangler deploy
```

## Monitoring

View real-time logs:
```bash
wrangler tail
```

## Environment Variables

These are set in `wrangler.toml` under `[vars]`:
- `NOTIFY_EMAIL` - Email to receive notifications (bilawalriaz@gmail.com)
- `FROM_EMAIL` - Sender email address (noreply@hyperflash.uk)
- `FROM_NAME` - Sender name (Agent Dashboard)
- `ALLOWED_ORIGIN` - CORS origin (https://agent.hyperflash.uk)
