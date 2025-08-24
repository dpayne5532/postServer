// index.js
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

const SCOPES = ['r_organization_social', 'rw_organization_admin'].join('%20');
const AUTH_URL = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}`;

const sqlConfig = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  database: process.env.AZURE_SQL_DATABASE,
  server: process.env.AZURE_SQL_SERVER,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  options: { encrypt: true, trustServerCertificate: false }
};

app.get('/', (_, res) => res.redirect(AUTH_URL));

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code param');

  try {
    // 1) token
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

    // 2) fetch posts
    const postsRes = await axios.get('https://api.linkedin.com/rest/posts', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': '202507'
      },
      params: { q: 'author', author: ORGANIZATION_URN, start: 0, count: 10 }
    });

    const elements = Array.isArray(postsRes.data?.elements) ? postsRes.data.elements : [];

    // 3) normalize
    const normalize = (p) => {
      const urn = p?.id || null;                                // e.g., urn:li:share:..., urn:li:ugcPost:...
      const postId = urn ? urn.split(':').pop() : null;         // numeric tail
      const postType = urn ? urn.split(':')[2] : null;          // share | ugcPost | linkedInArticle
      const text = (p?.commentary || '').trim();

      return {
        postId,
        postUrn: urn,
        postType,
        activity: p?.socialDetail?.urn || p?.activity || null,
        text,
        author: p?.author || null,
        visibility: p?.visibility || null,
        lifecycleState: p?.lifecycleState || null,
        isEditedByAuthor: p?.lifecycleStateInfo?.isEditedByAuthor ?? null,
        isReshareDisabledByAuthor: p?.isReshareDisabledByAuthor ?? null,
        feedDistribution: p?.distribution?.feedDistribution || null,
        reshareParent: p?.reshareContext?.parent || null,
        reshareRoot: p?.reshareContext?.root || null,
        mediaId: p?.content?.media?.id || p?.content?.reference?.id || null,
        mediaAltText: p?.content?.media?.altText || null,
        pollQuestion: p?.content?.poll?.question || null,
        createdAt: p?.createdAt ? new Date(p.createdAt) : null,
        lastModifiedAt: p?.lastModifiedAt ? new Date(p.lastModifiedAt) : null,
        publishedAt: p?.publishedAt ? new Date(p.publishedAt) : null
      };
    };

    const posts = elements.map(normalize).filter(p => p.postId);

    // 4) upsert
    const pool = await sql.connect(sqlConfig);
    for (const p of posts) {
      await pool.request()
        .input('postId', sql.VarChar, p.postId)
        .input('postUrn', sql.VarChar, p.postUrn)
        .input('postType', sql.VarChar, p.postType)
        .input('activity', sql.VarChar, p.activity)
        .input('text', sql.NVarChar(sql.MAX), p.text)
        .input('author', sql.VarChar, p.author)
        .input('visibility', sql.VarChar, p.visibility)
        .input('lifecycleState', sql.VarChar, p.lifecycleState)
        .input('isEditedByAuthor', sql.Bit, p.isEditedByAuthor)
        .input('isReshareDisabledByAuthor', sql.Bit, p.isReshareDisabledByAuthor)
        .input('feedDistribution', sql.VarChar, p.feedDistribution)
        .input('reshareParent', sql.VarChar, p.reshareParent)
        .input('reshareRoot', sql.VarChar, p.reshareRoot)
        .input('mediaId', sql.VarChar, p.mediaId)
        .input('mediaAltText', sql.NVarChar(sql.MAX), p.mediaAltText)
        .input('pollQuestion', sql.NVarChar(sql.MAX), p.pollQuestion)
        .input('createdAt', sql.DateTimeOffset, p.createdAt)
        .input('lastModifiedAt', sql.DateTimeOffset, p.lastModifiedAt)
        .input('publishedAt', sql.DateTimeOffset, p.publishedAt)
        .query(`
          MERGE dbo.LinkedInPosts AS target
          USING (SELECT
                  @postId AS postId,
                  @postUrn AS postUrn,
                  @postType AS postType,
                  @activity AS activity,
                  @text AS text,
                  @author AS author,
                  @visibility AS visibility,
                  @lifecycleState AS lifecycleState,
                  @isEditedByAuthor AS isEditedByAuthor,
                  @isReshareDisabledByAuthor AS isReshareDisabledByAuthor,
                  @feedDistribution AS feedDistribution,
                  @reshareParent AS reshareParent,
                  @reshareRoot AS reshareRoot,
                  @mediaId AS mediaId,
                  @mediaAltText AS mediaAltText,
                  @pollQuestion AS pollQuestion,
                  @createdAt AS createdAt,
                  @lastModifiedAt AS lastModifiedAt,
                  @publishedAt AS publishedAt
                ) AS source
          ON target.postId = source.postId
          WHEN MATCHED THEN UPDATE SET
              postUrn = source.postUrn,
              postType = source.postType,
              activity = source.activity,
              text = source.text,
              author = source.author,
              visibility = source.visibility,
              lifecycleState = source.lifecycleState,
              isEditedByAuthor = source.isEditedByAuthor,
              isReshareDisabledByAuthor = source.isReshareDisabledByAuthor,
              feedDistribution = source.feedDistribution,
              reshareParent = source.reshareParent,
              reshareRoot = source.reshareRoot,
              mediaId = source.mediaId,
              mediaAltText = source.mediaAltText,
              pollQuestion = source.pollQuestion,
              createdAt = source.createdAt,
              lastModifiedAt = source.lastModifiedAt,
              publishedAt = source.publishedAt
          WHEN NOT MATCHED THEN INSERT (
              postId, postUrn, postType, activity, text, author, visibility, lifecycleState,
              isEditedByAuthor, isReshareDisabledByAuthor, feedDistribution, reshareParent, reshareRoot,
              mediaId, mediaAltText, pollQuestion, createdAt, lastModifiedAt, publishedAt
          ) VALUES (
              source.postId, source.postUrn, source.postType, source.activity, source.text, source.author,
              source.visibility, source.lifecycleState, source.isEditedByAuthor, source.isReshareDisabledByAuthor,
              source.feedDistribution, source.reshareParent, source.reshareRoot, source.mediaId,
              source.mediaAltText, source.pollQuestion, source.createdAt, source.lastModifiedAt, source.publishedAt
          );
        `);
    }

    res.send(`✅ Upserted ${posts.length} posts into Azure SQL (uniform schema).`);
  } catch (err) {
    console.error('❌ ERROR:', err.response?.data || err.message);
    res.status(500).send('Failed to fetch or upsert LinkedIn data');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
});
