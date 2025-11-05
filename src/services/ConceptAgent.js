module.exports = async function ConceptAgent(input) {
    const LLM = (await import("@themaximalist/llm.js")).default;

    let input_prompt = "";
    if (typeof input === "string") {
        input_prompt = `\nHere's the INPUT: ${input}`;
    } else if (Array.isArray(input)) {
        input_prompt = `
- Remix multiple INPUTS into a single concept
- Figure out which core concepts are most important and keep those
- Figure out which fringe concepts are least important and remove those
- Add new styles and keywords to match the newly generated concept

Here are the various INPUTs the user has provided: ${input.map(i => `\n- ${i}`)}
        `;
    }

    const prompt = `
I am a Concept Agent.
I transform user INPUT into a JSON format using the RULES provided below:

# FORMAT
{
    "style": "digital-art" // "3d-model", "analog-film", "anime", "cinematic", "comic-book", "digital-art", "enhance", "fantasy-art", "isometric", "line-art", "low-poly", "modeling-compound", "neon-punk", "origami", "photographic", "pixel-art", "tile-texture"
    "prompt": "keywords, go, here"
}

# RULES
- Expand the text prompt into complex and artistic concepts. Be creative!
- Artistic concepts should consist of verbose and dense keywords, separated by commas (CSV format).
- Always use varied and unique keywords.
- Keywords should include (but not limited to)
 - Artist names
 - Styles
 - Eras
 - Lighting
 - Composition
 - Colors
 - Textures
 - Mediums
 - Techniques
 - Subject matter
 - Mood or emotion
 - Perspective
 - Movement
 - Cultural influences
 - Scale
 - Materials
 - Framing
 - Geometric shapes
 - Line quality
 - Symbolism
 - Space
 - Time period
 - Level of detail
 - Artistic influences
 - Artistic intent
 - Presentation
 - And other artistic concepts—be imaginative!
- Generate only one text_prompt concept.
- Select an appropriate style from the list above, based on the keywords.
- Use only the styles listed above.
- Output JSON that can be handled by JSON.parse().
${input_prompt}

Please now output only the JSON:
`.trim();

    try {
        const concept = await LLM(prompt, {
            json: true,
            service: process.env.AI_SERVICE,
            model: process.env.AI_MODEL,
        });
        // console.log("CONCEPT", concept);
        if (!concept.style) throw new Error('No style found');
        if (!concept.prompt) throw new Error('No prompt found');

        // console.log("CONCEPT", concept);
        return {
            style: concept.style,
            prompt: concept.prompt
        };
    } catch (e) {
        console.error(e);
        return null;
    }
}