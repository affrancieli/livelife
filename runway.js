const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { path, method, body, apiKey } = JSON.parse(event.body);

    const result = await new Promise((resolve, reject) => {
      const postData = (body && method === 'POST') ? JSON.stringify(body) : null;

      const options = {
        hostname: 'api.dev.runwayml.com',
        path: `/v1${path}`,
        method: method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-Runway-Version': '2024-11-06',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, body: parsed });
          } catch(e) {
            resolve({ status: res.statusCode, body: { error: 'Parse error', raw: data.substring(0, 200) } });
          }
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });

    return {
      statusCode: result.status,
      headers,
      body: JSON.stringify(result.body),
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
