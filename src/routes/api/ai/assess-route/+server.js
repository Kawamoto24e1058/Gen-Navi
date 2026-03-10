import { json } from '@sveltejs/kit';
import { Maps_API_KEY } from '$env/static/private';

const GEMINI_API_KEY = Maps_API_KEY; 
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    try {
        const { hazards, routeSteps } = await request.json();

        // 0. Filter hazards to only essential data for AI (Lightweight)
        const simplifiedHazards = hazards.map(h => ({
            id: h.id,
            lat: h.lat,
            lon: h.lon,
            description: h.detail || h.message
        }));

        const prompt = `
あなたは日本の交通ルールと道路構造に精通した専門家で、かつ「ずんだもん」というキャラクターとして、原付一種（50cc）ライダーに安全なルートガイドを提供します。
常に親しみやすく、かつ「〜なのだ」「〜なのだ！」という語尾を自然に使って話してください。

1. バイパス（自動車専用道路）の徹底チェック（Stepsリスト）:
   提供された道路名のリストに、原付一種が通行禁止の道路が含まれていないか厳密にチェックしてください。
   - prohibited: 禁止区間が見つかれば、その名称、具体的理由（ずんだもん風）、および厳格度を返してください。
     voiceTextには必ず次のセリフを含めてください：「大変なのだ！ここは原付は通れないのだ！別の道を探すのだ！」

2. 車線数の推論と二段階右折判定（Hazardsリスト）:
   各右折ポイントの道路名と交差点名から、現地の車線構成を推論してください。
   - type: "TWO_STEP_REQUIRED" または "TWO_STEP_RECOMMENDED"
   - score: 確信度（0-100%）
   - voiceText: 必ず次のセリフを含めてください：「ここは車線が多いのだ！二段階右折をするのだ！左端の車線に、寄るのだ！」

必ず以下の純粋なJSON形式のみで回答してください：
{
  "hazards": [
    { "id": "ハザードID", "type": "TWO_STEP_REQUIRED", "score": 95, "reason": "...", "voiceText": "ここは車線が多いのだ！二段階右折をするのだ！左端の車線に、寄るのだ！" }
  ],
  "prohibited": [
    { "name": "道路名", "reason": "...", "strictness": "STRICT", "voiceText": "大変なのだ！ここは原付は通れないのだ！別の道を探すのだ！" }
  ]
}

データ:
Hazards (右折地点): ${JSON.stringify(simplifiedHazards)}
Steps (全道路名): ${JSON.stringify(routeSteps.map(s => s.name).filter(n => n))}
`;

        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { 
                    response_mime_type: "application/json",
                    temperature: 0.1
                }
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            if (response.status === 403) {
                return json({ hazards: [], prohibitedSections: [], warning: 'Gemini API is disabled.' });
            }
            throw new Error(`Gemini API HTTP ${response.status}: ${errBody}`);
        }

        const data = await response.json();
        const aiResult = JSON.parse(data.candidates[0].content.parts[0].text);

        // 3. Map AI 'prohibited' results to coordinates from OSRM steps
        const prohibitedSections = [];
        if (aiResult.prohibited) {
            aiResult.prohibited.forEach(alert => {
                // Find all steps that match the prohibited road name
                const matchingSteps = routeSteps.filter(s => 
                    s.name && (s.name.includes(alert.name) || alert.name.includes(s.name))
                );
                
                matchingSteps.forEach(step => {
                    prohibitedSections.push({
                        name: alert.name,
                        reason: alert.reason,
                        strictness: alert.strictness || 'STRICT',
                        start: [step.maneuver.location[1], step.maneuver.location[0]],
                        end: [step.maneuver.location[1], step.maneuver.location[0]], // Simplification: point-based alerts usually map better to whole steps
                        geometry: step.geometry // Pass geometry if available for better rendering
                    });
                });
            });
        }

        return json({
            hazards: aiResult.hazards || [],
            prohibitedSections
        });
    } catch (e) {
        console.error('AI Route Assessment Logic Error:', e);
        return json({ hazards: [], prohibitedSections: [], error: e.message }, { status: 200 });
    }
}
