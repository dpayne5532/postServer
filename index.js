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
  'rw_organization_admin',
  'r_organization_social_feed' // Needed for reactions/comments
].join('%20');

const AUTH_URL = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}`;

// Step 1: Start OAuth flow
app.get('/', (req, res) => {
  res.redirect(AUTH_URL);
});

// Step 2: Handle callback
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code param');

  try {
    // Get access token
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const accessToken = tokenRes.data.access_token;

    // Step 3: Fetch last 10 posts
    const postsRes = await axios.get('https://api.linkedin.com/v2/shares', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': '202307'
      },
      params: {
        q: 'owners',
        owners: ORGANIZATION_URN,
        sharesPerOwner: 10
      }
    });

    const posts = postsRes.data.elements;

    // Step 4: For each post, fetch reactions and extract URNs
    const postsWithReactions = await Promise.all(
      posts.map(async (post) => {
        const activityUrn = post.activity;

        try {
          const reactionsRes = await axios.get(
            `https://api.linkedin.com/v2/reactions/(entity:${activityUrn})`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'LinkedIn-Version': '202307'
              }
            }
          );

          const reactions = reactionsRes.data.elements || [];

          const reactorUrns = reactions.map((reaction) => reaction.actor);

          return {
            postId: post.id,
            activity: activityUrn,
            text: post.text?.text || '',
            reactorUrns
          };
        } catch (error) {
          console.warn(`❌ Failed to get reactions for ${activityUrn}`);
          return {
            postId: post.id,
            activity: activityUrn,
            text: post.text?.text || '',
            reactorUrns: [],
            error: error.response?.data || error.message
          };
        }
      })
    );

    res.json(postsWithReactions);
  } catch (err) {
    console.error('ERROR:', err.response?.data || err.message);
    res.status(500).send('Failed to fetch LinkedIn data');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
});
