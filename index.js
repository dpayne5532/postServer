const express = require('express');
const axios = require('axios');
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const PORT = 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const ORGANIZATION_URN = 'urn:li:organization:30474';

const SCOPES = [
  'r_organization_social',
  'rw_organization_admin'
].join('%20');

const AUTH_URL = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}`;

// SQL config
const sqlConfig = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  database: process.env.AZURE_SQL_DATABASE,
  server: process.env.AZURE_SQL_SERVER,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  options: { encrypt: true, trustServerCertificate: false }
};

// Start OAuth flow
app.get('/', (req, res) => {
  res.redirect(AUTH_URL);
});

// Callback to get token and fetch + save posts
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code param');

  try {
    // Exchange code for access token
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

    // Fetch posts from REST Post API (NOT /v2/shares)
    const postRes = await axios.get('https://api.linkedin.com/rest/posts', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': '202507'
      },
      params: {
        q: 'author',
        author: ORGANIZATION_URN,
        start: 0,
        count: 10
      }
    });

    // Normalize fields safely from /rest/posts response
    const posts = (postRes.data?.elements || []).map(p => {
      const postId =
        p.id || p.entityUrn || p.urn || p.postUrn || ''; // keep full URN/string
      const activity =
        p?.socialDetail?.urn || p?.activity || p?.trackingUrn || null; // may be null if not present
      const text =
        p?.commentary?.text || p?.text?.text || p?.content?.commentary?.text || '';
      const createdAt =
        p?.createdAt
          ? new Date(p.createdAt)
          : p?.created?.time
          ? new Date(p.created.time)
          : null;

      return { postId, activity, text, createdAt };
    });

    // Connect to SQL and upsert posts (no duplicates by postId)
    const pool = await sql.connect(sqlConfig);
    for (const post of posts) {
      await pool.request()
        .input('postId', sql.VarChar, post.postId)
        .input('activity', sql.VarChar, post.activity)
        .input('text', sql.NVarChar(sql.MAX), post.text)
        .input('createdAt', sql.DateTimeOffset, post.createdAt)
        .query(`
          MERGE LinkedInPosts AS target
          USING (SELECT @postId AS postId, @activity AS activity, @text AS text, @createdAt AS createdAt) AS source
          ON target.postId = source.postId
          WHEN MATCHED THEN 
            UPDATE SET activity = source.activity, text = source.text, createdAt = source.createdAt
          WHEN NOT MATCHED THEN
            INSERT (postId, activity, text, createdAt)
            VALUES (source.postId, source.activity, source.text, source.createdAt);
        `);
    }

    res.send(`✅ Upserted ${posts.length} posts into Azure SQL from /rest/posts.`);
  } catch (err) {
    console.error('❌ ERROR:', err.response?.data || err.message);
    res.status(500).send('Failed to fetch or upsert LinkedIn data');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
});
