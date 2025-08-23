const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const PORT = 3000;

// LinkedIn Config
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const ORGANIZATION_URN = 'urn:li:organization:30474';

// OAuth Scopes Required
const SCOPES = [
  'r_organization_social',
  'rw_organization_admin'
].join('%20');

// LinkedIn OAuth URL
const AUTH_URL = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}`;

// Step 1: Start auth flow
app.get('/', (req, res) => {
  res.redirect(AUTH_URL);
});

// Step 2: Handle callback and get token
app.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) return res.status(400).send('Missing code param');

  try {
    // Exchange auth code for access token
    const tokenRes = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      null,
      {
        params: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const accessToken = tokenRes.data.access_token;

    // Step 3: Fetch company posts
    const postRes = await axios.get('https://api.linkedin.com/v2/shares', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': '202307' // optional, but may prevent some errors
      },
      params: {
        q: 'owners',
        owners: ORGANIZATION_URN,
        sharesPerOwner: 10
      }
    });

    res.json(postRes.data);
  } catch (err) {
    console.error('ERROR:', err.response?.data || err.message);
    res.status(500).send('Failed to fetch LinkedIn data');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
});
