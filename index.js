const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = 3000;

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/v2/shares';

const ORGANIZATION_URN = 'urn:li:organization:30474';

app.get('/', (req, res) => {
  const authURL = `${LINKEDIN_AUTH_URL}?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=r_organization_social%20rw_organization_admin`;

  res.redirect(authURL);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;

  try {
    // Exchange auth code for access token
    const tokenResponse = await axios.post(
      LINKEDIN_TOKEN_URL,
      null,
      {
        params: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: process.env.REDIRECT_URI,
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Fetch 10 latest posts
    const postResponse = await axios.get(LINKEDIN_POSTS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        q: 'owners',
        owners: ORGANIZATION_URN,
        sharesPerOwner: 10,
      },
    });

    res.json(postResponse.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('Something went wrong');
  }
});

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
