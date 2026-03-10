import { json } from '@sveltejs/kit';
import { Maps_API_KEY } from '$env/static/private';

const GEMINI_API_KEY = Maps_API_KEY; // Using existing key if possible
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    try {
        const { hazards } = await request.json();

        if (!hazards || hazards.length === 0) {
            return json({ results: [] });
        }

        const prompt = `
あなたは日本の交通安全と原付（50ccスクーター）の走行ルールに精通した専門家です。
以下の右折ポイントのリストについて、それぞれの場所が「片側3車線以上の多車線道路である可能性（二段階右折が必要な可能性）」を0〜100%で判定してください。

また、以下の情報を日本語で提供してください：
1. score: 二段階右折が必要な確率（0-100の数値）
2. reason: なぜその判定になったか（例：「国道26号線は主要幹線道路で、ほぼ全ての交差点が多車線です」など）
3. voiceText: 100m手前でライダーに伝えるべき、自然で親切な日本語のアドバイス。

必ず以下のJSONフォーマットで回答してください。JSON以外のテキストは含めないでください：
{
  "results": [
    { "id": "ポイントのID", "score": 85, "reason": "...", "voiceText": "..." }
  ]
}

リスト:
${JSON.stringify(hazards, null, 2)}
`;

        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('Gemini API Error:', err);
            return json({ error: 'Gemini API call failed' }, { status: 500 });
        }

        const data = await response.json();
        const aiResponse = JSON.parse(data.candidates[0].content.parts[0].text);

        return json(aiResponse);
    } catch (e) {
        console.error('AI Assessment Route Error:', e);
        return json({ error: e.message }, { status: 500 });
    }
}
