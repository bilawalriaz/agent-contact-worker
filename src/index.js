/**
 * Agent Dashboard Contact Form API
 * Cloudflare Worker with KV storage and Resend email delivery
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request, env);
    }

    const url = new URL(request.url);

    // Route handling
    if (url.pathname === '/contact' && request.method === 'POST') {
      return handleContactForm(request, env);
    }

    if (url.pathname === '/submissions' && request.method === 'GET') {
      return handleGetSubmissions(request, env);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
    });
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim());

  // Check if origin is in allowed list
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] || '*');

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function handleCORS(request, env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env)
  });
}

async function handleContactForm(request, env) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
      });
    }

    // Validate required fields
    const { name, email, message } = body;
    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name, email, message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
      });
    }

    // Basic email validation
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
      });
    }

    // Sanitize inputs
    const sanitizedData = {
      name: sanitize(name).substring(0, 100),
      email: sanitize(email).substring(0, 254),
      message: sanitize(message).substring(0, 5000),
      timestamp: new Date().toISOString(),
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      country: request.headers.get('CF-IPCountry') || 'unknown',
      userAgent: (request.headers.get('User-Agent') || 'unknown').substring(0, 200)
    };

    // Generate unique ID
    const submissionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Store in KV
    await env.CONTACT_SUBMISSIONS.put(
      `submission:${submissionId}`,
      JSON.stringify(sanitizedData),
      { expirationTtl: 60 * 60 * 24 * 90 } // 90 days
    );

    // Also maintain a list of submission IDs for easy retrieval
    const listKey = 'submissions:list';
    const existingList = await env.CONTACT_SUBMISSIONS.get(listKey);
    const submissionIds = existingList ? JSON.parse(existingList) : [];
    submissionIds.unshift(submissionId);
    // Keep only last 1000 submissions in list
    if (submissionIds.length > 1000) submissionIds.pop();
    await env.CONTACT_SUBMISSIONS.put(listKey, JSON.stringify(submissionIds));

    // Send email notification via Resend
    const emailSent = await sendEmail(env, sanitizedData, submissionId);

    return new Response(JSON.stringify({
      success: true,
      message: 'Contact form submitted successfully',
      id: submissionId,
      emailSent
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
    });

  } catch (error) {
    console.error('Contact form error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
    });
  }
}

async function handleGetSubmissions(request, env) {
  // Simple auth check via query param (you can make this more secure)
  const url = new URL(request.url);
  const authKey = url.searchParams.get('key');

  // You should set this as a secret in wrangler.toml or via dashboard
  // For now, we'll use a simple check
  if (!authKey || authKey.length < 16) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
    });
  }

  try {
    const listKey = 'submissions:list';
    const existingList = await env.CONTACT_SUBMISSIONS.get(listKey);
    const submissionIds = existingList ? JSON.parse(existingList) : [];

    // Get limit from query params (default 50)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

    const submissions = [];
    for (const id of submissionIds.slice(0, limit)) {
      const data = await env.CONTACT_SUBMISSIONS.get(`submission:${id}`);
      if (data) {
        submissions.push({ id, ...JSON.parse(data) });
      }
    }

    return new Response(JSON.stringify({
      count: submissions.length,
      total: submissionIds.length,
      submissions
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
    });

  } catch (error) {
    console.error('Get submissions error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
    });
  }
}

async function sendEmail(env, data, submissionId) {
  const provider = (env.EMAIL_PROVIDER || 'resend').toLowerCase();

  switch (provider) {
    case 'zeptomail':
      return sendEmailViaZeptoMail(env, data, submissionId);
    case 'resend':
    default:
      return sendEmailViaResend(env, data, submissionId);
  }
}

async function sendEmailViaResend(env, data, submissionId) {
  try {
    const textContent = [
      'New contact form submission from Agent Dashboard',
      '',
      '---',
      'Name: ' + data.name,
      'Email: ' + data.email,
      '---',
      '',
      'Message:',
      data.message,
      '',
      '---',
      'Metadata:',
      '- Submission ID: ' + submissionId,
      '- Timestamp: ' + data.timestamp,
      '- IP: ' + data.ip,
      '- Country: ' + data.country,
      '',
      '---',
      'This email was sent from agent.hyperflash.uk'
    ].join('\n');

    const htmlContent = `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;color:#1a1a1a}.container{max-width:600px;margin:0 auto;padding:20px}.header{background:linear-gradient(135deg,#f97316,#ea580c);color:white;padding:24px;border-radius:12px 12px 0 0}.header h1{margin:0;font-size:20px}.content{background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none}.field{margin-bottom:16px}.field-label{font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px}.field-value{font-size:16px;color:#1a1a1a}.message-box{background:#f9fafb;padding:16px;border-radius:8px;margin:16px 0;white-space:pre-wrap}.metadata{background:#f3f4f6;padding:16px;border-radius:0 0 12px 12px;font-size:12px;color:#6b7280}.metadata-item{margin-bottom:4px}a{color:#f97316}</style></head><body><div class="container"><div class="header"><h1>New Contact Form Submission</h1></div><div class="content"><div class="field"><div class="field-label">From</div><div class="field-value">${escapeHtml(data.name)}</div></div><div class="field"><div class="field-label">Email</div><div class="field-value"><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></div></div><div class="field"><div class="field-label">Message</div><div class="message-box">${escapeHtml(data.message)}</div></div></div><div class="metadata"><div class="metadata-item"><strong>ID:</strong> ${submissionId}</div><div class="metadata-item"><strong>Time:</strong> ${data.timestamp}</div><div class="metadata-item"><strong>Location:</strong> ${data.country}</div><div class="metadata-item"><strong>IP:</strong> ${data.ip}</div></div></div></body></html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: env.FROM_NAME + ' <' + env.FROM_EMAIL + '>',
        to: [env.NOTIFY_EMAIL],
        subject: '[Agent] New contact from ' + data.name,
        text: textContent,
        html: htmlContent,
      }),
    });

    if (response.ok) {
      return true;
    } else {
      const errorText = await response.text();
      console.error('Resend error:', response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error('Resend email send error:', error);
    return false;
  }
}

async function sendEmailViaZeptoMail(env, data, submissionId) {
  try {
    const textContent = [
      'New contact form submission from Agent Dashboard',
      '',
      '---',
      'Name: ' + data.name,
      'Email: ' + data.email,
      '---',
      '',
      'Message:',
      data.message,
      '',
      '---',
      'Metadata:',
      '- Submission ID: ' + submissionId,
      '- Timestamp: ' + data.timestamp,
      '- IP: ' + data.ip,
      '- Country: ' + data.country,
      '',
      '---',
      'This email was sent from agent.hyperflash.uk'
    ].join('\n');

    const htmlContent = `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;color:#1a1a1a}.container{max-width:600px;margin:0 auto;padding:20px}.header{background:linear-gradient(135deg,#f97316,#ea580c);color:white;padding:24px;border-radius:12px 12px 0 0}.header h1{margin:0;font-size:20px}.content{background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none}.field{margin-bottom:16px}.field-label{font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px}.field-value{font-size:16px;color:#1a1a1a}.message-box{background:#f9fafb;padding:16px;border-radius:8px;margin:16px 0;white-space:pre-wrap}.metadata{background:#f3f4f6;padding:16px;border-radius:0 0 12px 12px;font-size:12px;color:#6b7280}.metadata-item{margin-bottom:4px}a{color:#f97316}</style></head><body><div class="container"><div class="header"><h1>New Contact Form Submission</h1></div><div class="content"><div class="field"><div class="field-label">From</div><div class="field-value">${escapeHtml(data.name)}</div></div><div class="field"><div class="field-label">Email</div><div class="field-value"><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></div></div><div class="field"><div class="field-label">Message</div><div class="message-box">${escapeHtml(data.message)}</div></div></div><div class="metadata"><div class="metadata-item"><strong>ID:</strong> ${submissionId}</div><div class="metadata-item"><strong>Time:</strong> ${data.timestamp}</div><div class="metadata-item"><strong>Location:</strong> ${data.country}</div><div class="metadata-item"><strong>IP:</strong> ${data.ip}</div></div></div></body></html>`;

    const response = await fetch('https://api.zeptomail.com/v1.1/email/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Zoho-enczapikey ' + env.ZEPTOMAIL_API_KEY,
      },
      body: JSON.stringify({
        from: {
          address: env.FROM_EMAIL,
          name: env.FROM_NAME
        },
        to: [{
          email_address: {
            address: env.NOTIFY_EMAIL,
            name: 'Notification'
          }
        }],
        subject: '[Agent] New contact from ' + data.name,
        textbody: textContent,
        htmlbody: htmlContent,
      }),
    });

    if (response.ok) {
      return true;
    } else {
      const errorText = await response.text();
      console.error('ZeptoMail error:', response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error('ZeptoMail email send error:', error);
    return false;
  }
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/[<>]/g, '');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '')
    .replace(/\\/g, '&#92;');
}
