import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { GoogleGenerativeAI } from "@google/generative-ai";

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    let apiKey = env.GEMINI_API_KEY;
    if (!apiKey && typeof process !== 'undefined') {
        apiKey = process.env.GEMINI_API_KEY;
    }

    if (!apiKey) {
        console.error('GEMINI_API_KEY is not defined in environment variables.');
        return json({ error: 'API Key missing' }, { status: 500 });
    }

    // Clean the key (trim whitespace and remove accidental quotes)
    apiKey = apiKey.trim().replace(/^["']|["']$/g, '');
    
    console.log(`[DEBUG hazards] Using API Key (length: ${apiKey.length}, starts with: ${apiKey.substring(0, 5)}...)`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: { 
            responseMimeType: "application/json"
        }
    });

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

        const result = await model.generateContent(prompt);
        const aiResponseText = result.response.text();
        const aiResponse = JSON.parse(aiResponseText);

        return json(aiResponse);
    } catch (e) {
        console.error('AI Assessment Route Error:', e);
        return json({ error: e.message }, { status: 500 });
    }
}
