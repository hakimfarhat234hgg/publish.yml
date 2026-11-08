// publish.js — auto-publish AI-written articles to Blogger (inqelio.net)
// Requires Node 20+ (global fetch). No npm dependencies.

const pick = (k, d) => process.env[k] || d;
const must = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing environment variable: ${k}`);
  return v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE = pick('SITE', 'www.inqelio.net');
const LANGUAGE = pick('LANGUAGE', 'Arabic');
const IS_DRAFT = pick('IS_DRAFT', 'true') !== 'false'; // safe default: draft
const MODEL = pick('GEMINI_MODEL', 'gemini-2.5-flash');
const CATEGORIES = pick('CATEGORIES', 'Technology,Artificial Intelligence,Tips and Tutorials,Reviews,News')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function gemini(prompt, { json = false, temperature = 0.9 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': must('GEMINI_API_KEY') },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: json ? 1024 : 16000,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    if (res.ok) {
      const d = await res.json();
      const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (text) return text;
      throw new Error('Gemini returned an empty response: ' + JSON.stringify(d).slice(0, 300));
    }
    if ([429, 500, 502, 503, 504].includes(res.status) && i < 3) {
      await sleep(3000 * 2 ** i);
      continue;
    }
    throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: must('GOOGLE_CLIENT_ID'),
      client_secret: must('GOOGLE_CLIENT_SECRET'),
      refresh_token: must('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

async function recentTitles(token, blogId) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?maxResults=30&fetchBodies=false&status=live&status=draft&fields=items(title)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    return ((await res.json()).items || []).map((p) => p.title).filter(Boolean);
  } catch {
    return [];
  }
}

const stripFences = (s) => s.replace(/^```(?:json|html)?\s*/i, '').replace(/```\s*$/, '').trim();

async function chooseTopic(recent) {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const year = new Date().getFullYear();
  const prompt = `You are an expert SEO blog writer for "Inqelio" (${SITE}). Write everything in ${LANGUAGE}.

The category for this article is: ${category}

Do NOT choose a topic similar to these recent posts:
${recent.length ? recent.map((t) => '- ' + t).join('\n') : '(none)'}

Create:
- title: unique, engaging, not robotic, no colon ":" characters. Mild clickbait is fine if not exaggerated. Include the year ${year} only if it fits naturally.
- slug: lowercase latin letters, hyphen-separated
- focus_phrase: maximum 2 words, the main idea
- meta_description: up to 160 characters

Return ONLY a JSON object with the keys: title, slug, focus_phrase, meta_description. No extra text.`;
  const raw = await gemini(prompt, { json: true });
  const t = JSON.parse(stripFences(raw));
  if (!t.title || !t.focus_phrase) throw new Error('Topic JSON is missing title or focus_phrase: ' + raw);
  return { category, ...t };
}

async function writeArticle(topic) {
  const prompt = `You are an elite SEO blog writer for Inqelio (${SITE}). Write the entire article in ${LANGUAGE}.

Write an SEO blog article of 1,500 to 2,500 words.
Title: ${topic.title}
Category: ${topic.category}
Focus phrase: ${topic.focus_phrase}

Rules:
- Use the title as given, but do NOT repeat it in the body. Start immediately with the first <h2>. No title, no byline.
- Opening (100-150 words): start with an engaging hook, include the focus phrase within the first 2-3 sentences, and do not label it "Introduction". Put it under the first <h2> or as <p> paragraphs before it only if needed.
- Use 4 to 6 <h2> headings, with optional <h3> subsections. Use the focus phrase in at least one <h2> or <h3>, and naturally 4-16 times in total.
- Add bullet lists (<ul><li>), practical examples, and actionable advice. Only state facts, statistics or quotes you are confident are real; never invent studies, numbers or quotes.
- If the topic involves products, tools, apps or gadgets, add an <h3> and an HTML <table> (<thead>, <tbody>, <tr>, <th>, <td>) comparing at least 3 items with columns: Product, Price, Pros, Cons, Best For (translate the column names into ${LANGUAGE}). Only include products you are confident really exist, present prices as approximate, and tell readers to check current prices.
- Style: friendly yet authoritative, short paragraphs (2-4 sentences), smooth transitions, no heavy jargon.
- Final section: do not label it "Conclusion". Summarize the key takeaways and end with a call to action, including: "For more insights or collaboration opportunities, visit ${SITE}." (translated naturally into ${LANGUAGE}).
- Then add an FAQ section (<h3> for each question, <p> for each answer), then a "References and Further Reading" section (translated) using <ul><li> with <a href> links only to well-known official websites you are sure exist. Do not guess deep links.
- Output clean WordPress/Blogger-ready HTML only: <h2>, <h3>, <p>, <ul>, <li>, <table>. No Markdown, no code fences, no commentary.`;
  let html = stripFences(await gemini(prompt, { temperature: 0.8 }));
  const i = html.indexOf('<h2');
  if (i > 0) html = html.slice(i);
  if (html.length < 4000) throw new Error(`Article looks too short (${html.length} chars); aborting without publishing.`);
  return html;
}

async function publish(token, blogId, topic, html) {
  const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?isDraft=${IS_DRAFT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'blogger#post', title: topic.title, content: html, labels: [topic.category] }),
  });
  if (!res.ok) throw new Error(`Blogger error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

(async () => {
  const blogId = must('BLOGGER_BLOG_ID');
  const token = await getAccessToken();
  const recent = await recentTitles(token, blogId);
  const topic = await chooseTopic(recent);
  console.log(`Topic: [${topic.category}] ${topic.title}`);
  const html = await writeArticle(topic);
  console.log(`Article length: ${html.length} chars`);
  const post = await publish(token, blogId, topic, html);
  console.log(`${IS_DRAFT ? 'Saved as DRAFT' : 'PUBLISHED'}: ${post.url || post.id}`);
  console.log(`Meta description (add manually in Blogger if you want it): ${topic.meta_description}`);
  console.log(`Suggested custom permalink: ${topic.slug}`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
