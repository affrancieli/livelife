const https = require('https');

function runwayRequest(path, method, body, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
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
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: { error: data.substring(0,300) } }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

    // Polling task - just proxy
    if (method === 'GET') {
      const result = await runwayRequest(path, 'GET', null, apiKey);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    // Video generation: step 1 - generate image first
    if (path === '/image_to_video' && body && !body.promptImage) {
      const promptText = body.promptText;

      // Step 1: text to image
      const imgResult = await runwayRequest('/text_to_image', 'POST', {
        model: 'gen4_image',
        promptText: promptText,
        ratio: '1280:720'
      }, apiKey);

      if (!imgResult.body.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Image task failed: ' + JSON.stringify(imgResult.body) }) };
      }

      // Poll image task
      let imageUrl = null;
      for (let i = 0; i < 30; i++) {
        await sleep(3000);
        const poll = await runwayRequest(`/tasks/${imgResult.body.id}`, 'GET', null, apiKey);
        if (poll.body.status === 'SUCCEEDED' && poll.body.output) {
          imageUrl = poll.body.output[0];
          break;
        }
        if (poll.body.status === 'FAILED') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Image generation failed' }) };
        }
      }

      if (!imageUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Image generation timed out' }) };
      }

      // Step 2: image to video
      const videoResult = await runwayRequest('/image_to_video', 'POST', {
        model: 'gen4_turbo',
        promptImage: imageUrl,
        promptText: promptText,
        ratio: '1280:720',
        duration: body.duration || 5
      }, apiKey);

      return { statusCode: videoResult.status, headers, body: JSON.stringify(videoResult.body) };
    }

    // Default proxy
    const result = await runwayRequest(path, method, body, apiKey);
    return { statusCode: result.status, headers, body: JSON.stringify(result.body) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
