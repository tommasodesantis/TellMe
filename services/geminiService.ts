import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { DocumentAnalysis, ImageResolution, VisualPrompts } from "../types";

// Helper to ensure API key is present
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found. Please select a key.");
  }
  return new GoogleGenAI({ apiKey });
};

// 1. Analyze Document (The "Director")
export const analyzeDocument = async (pages: {base64: string, mimeType: string}[], language: string): Promise<DocumentAnalysis> => {
  const ai = getClient();
  
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      actor: { type: Type.STRING, description: "Who sent the document (e.g., 'The Bank', 'The Doctor')." },
      topic: { type: Type.STRING, description: "The main subject (e.g., 'Unpaid Bill', 'Appointment')." },
      action: { type: Type.STRING, description: "What the user must do (e.g., 'Pay $50', 'Go to Hospital')." },
      isUrgent: { type: Type.BOOLEAN, description: "True if bad news, deadline, or action required. False if informational only." },
      narrative: { type: Type.STRING, description: `A simple, empathetic explanation spoken to an illiterate adult in ${language}. Keep it under 30 words.` },
      detailedSummary: { type: Type.STRING, description: "A highly detailed, comprehensive summary of the document content. Include all specific dates, times, amounts, addresses, names, reference numbers, and fine print details found. Do not simplify this field; capture the raw data." },
      prompts: {
        type: Type.OBJECT,
        properties: {
          sourcePanel: { type: Type.STRING, description: "Visual prompt for Panel 1: Who sent it. Cartoon style, high contrast, NO TEXT." },
          subjectPanel: { type: Type.STRING, description: "Visual prompt for Panel 2: The topic. Cartoon style, high contrast, NO TEXT." },
          actionPanel: { type: Type.STRING, description: "Visual prompt for Panel 3: The action. Cartoon style, high contrast, NO TEXT." },
        },
        required: ["sourcePanel", "subjectPanel", "actionPanel"]
      }
    },
    required: ["actor", "topic", "action", "isUrgent", "narrative", "detailedSummary", "prompts"]
  };

  // Create parts for all pages
  const imageParts = pages.map(p => ({
    inlineData: { mimeType: p.mimeType, data: p.base64 }
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: {
      parts: [
        ...imageParts,
        { text: `Analyze this document (which may consist of multiple pages). 1) Create a simplified explanation for a user with low literacy. 2) Create a highly detailed summary for an AI assistant's context (combining info from all pages). 3) Design visual prompts.` }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      systemInstruction: `You are a helpful assistant for adults with low literacy. Simplify complex bureaucratic language into extremely simple concepts for the narrative, but capture FULL DETAIL for the detailedSummary.`
    }
  });

  const text = response.text;
  if (!text) throw new Error("No analysis returned");
  return JSON.parse(text) as DocumentAnalysis;
};

// 2. Generate Comic Strip (The "Artist")
export const generateComicStrip = async (prompts: VisualPrompts, resolution: ImageResolution = '1K'): Promise<string> => {
  const ai = getClient();
  
  // Construct a single prompt for a 3-panel strip with STRICT No-Text constraints
  const styledPrompt = `
    A horizontal comic strip divided into 3 distinct equal panels.
    Panel 1 (Left): ${prompts.sourcePanel}.
    Panel 2 (Center): ${prompts.subjectPanel}.
    Panel 3 (Right): ${prompts.actionPanel}.
    
    STYLE GUIDELINES:
    - Vector art style, thick lines, high contrast, flat colors.
    - Clear visual narrative using simple informative icons.
    - CRITICAL: ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO SPEECH BUBBLES. 
    - Use only symbols (like $, !, ?, checkmarks) if necessary, but avoid alphabetic characters completely.
    - The story must be understood purely through visuals.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: [{ text: styledPrompt }]
    },
    config: {
      imageConfig: {
        imageSize: resolution,
        aspectRatio: "16:9" // Closest standard aspect ratio to 3:2 for landscape strips
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image generated");
};

// 3. Generate Speech (The "Narrator")
export const generateNarration = async (text: string): Promise<string> => {
  const ai = getClient();
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: {
      parts: [{ text }]
    },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Puck" } // A friendly voice
        }
      }
    }
  });

  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) throw new Error("No audio generated");
  return audioData;
};

// 4. Conversational Deep Dive
export const answerVisualQuestion = async (
  originalDocBase64: string, 
  originalMimeType: string,
  question: string,
  resolution: ImageResolution = '1K'
): Promise<{ text: string, imageBase64: string }> => {
  const ai = getClient();

  // We need both a verbal answer and a visual answer
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview", // Using the image model to be able to generate visual response
    contents: {
      parts: [
        { inlineData: { mimeType: originalMimeType, data: originalDocBase64 } },
        { text: `The user asks: "${question}". Answer simply in text, and generate an image that visually explains the answer (e.g., if asking 'where to sign', show a zoomed in view of the signature line with a finger pointing). NO TEXT IN IMAGE.` }
      ]
    },
    config: {
        imageConfig: {
            imageSize: resolution,
            aspectRatio: "1:1"
        },
    }
  });

  let imageBase64 = "";
  let textAnswer = "";

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      imageBase64 = `data:image/png;base64,${part.inlineData.data}`;
    } else if (part.text) {
      textAnswer += part.text;
    }
  }

  return { text: textAnswer, imageBase64 };
};