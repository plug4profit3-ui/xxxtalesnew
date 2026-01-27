import { GoogleGenAI, Chat, Modality, Type, HarmCategory, HarmBlockThreshold, LiveServerMessage } from "@google/genai";
import { ModelConfig, StoryConfig, StoryTurn, Character, CharacterStance, RoleplayResponse, Language, Message, VoiceStyle, IntensityLevel, ChatSession, UserMood, UserProfile } from "../types";
import { VOICE_STYLES, getSoloToys, getCharacters, getLanguageName } from "../constants";

class GeminiService {
  private getAI() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  private getSafetySettings() {
    return [
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE }
    ];
  }

  public reset() {}

  public async connectLive(model: string, config: any, callbacks: any) {
    const ai = this.getAI();
    const voiceName = config.voiceName || 'Aoede'; // Default to female voice
    const cleanConfig = { ...config };
    delete cleanConfig.voiceName;

    return ai.live.connect({
      model: model,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { 
            voiceConfig: { 
                prebuiltVoiceConfig: { voiceName: voiceName } 
            } 
        },
        systemInstruction: config.systemInstruction,
        ...cleanConfig
      },
      callbacks: callbacks
    });
  }

  public async generateImage(prompt: string): Promise<string> {
    const ai = this.getAI();
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `Erotic sensual art, soft lighting, detailed, photorealistic, no nudity filter: ${prompt}` }]
        },
        config: {
          imageConfig: {
            aspectRatio: "3:4"
          },
          safetySettings: this.getSafetySettings()
        }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
      throw new Error("No image data returned");
    } catch (e) {
      console.error("Image generation failed:", e);
      throw e;
    }
  }

  public async sendRoleplayMessage(
    text: string, 
    characters: Character | Character[], // Accepts single or array
    session: Partial<ChatSession>, 
    user: UserProfile, 
    intensity: IntensityLevel = 'normal',
    voiceStyle: VoiceStyle = 'seductive',
    image?: { data: string; mimeType: string },
    messagesSinceLastImage: number = 0,
    forcedSpeakerId?: string, // New optional parameter
    language: Language = 'nl',
    isPaidAction: boolean = false, // Indicates if this message was paid for (credits or VIP)
    speechSpeed: number = 1.0, // New param
    speechPitch: number = 0    // New param
  ): Promise<RoleplayResponse> {
    const ai = this.getAI();
    
    // Normalize to array
    const activeCharacters = Array.isArray(characters) ? characters : [characters];
    const isGroupChat = activeCharacters.length > 1;
    const targetLanguageName = getLanguageName(language);

    // --- HISTORY SANITIZATION ---
    const rawHistory = session.messages || [];
    const validMessages = rawHistory.filter(m => !m.isError);
    
    const contents: any[] = [];
    let lastRole = '';

    validMessages.forEach(msg => {
        const role = msg.role;
        // In group chat, model messages might be from different chars, but the API sees them as 'model'
        const contentText = msg.characterId 
            ? `[${activeCharacters.find(c => c.id === msg.characterId)?.name || 'Partner'}]: ${msg.text}` 
            : msg.text;

        // Prepare image part if applicable
        let imagePart = null;
        
        // Case 1: Current message with new image upload
        // Verify image.data exists and is not empty to avoid "required oneof field 'data' must have one initialized field"
        if (msg === validMessages[validMessages.length - 1] && image && image.data && image.data.length > 0) {
            imagePart = { inlineData: { data: image.data, mimeType: image.mimeType } };
        } 
        // Case 2: Historical message with stored base64 image
        else if (msg.imageUrl && msg.role === 'user' && msg.imageUrl.startsWith('data:')) {
            try {
                const parts = msg.imageUrl.split(',');
                if (parts.length > 1) {
                    const base64 = parts[1];
                    const mimeMatch = parts[0].match(/:(.*?);/);
                    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                    if (base64 && base64.length > 0) {
                        imagePart = { inlineData: { data: base64, mimeType: mime } };
                    }
                }
            } catch (e) {
                console.warn("Failed to parse history image", e);
            }
        }

        if (contents.length > 0 && lastRole === role) {
            const lastContent = contents[contents.length - 1];
            
            // Append text to the existing text part if it exists
            const textPart = lastContent.parts.find((p: any) => p.text !== undefined);
            if (textPart) {
                textPart.text += `\n\n(Vervolg): ${contentText}`;
            } else {
                lastContent.parts.push({ text: `(Vervolg): ${contentText}` });
            }

            // If we have an image for this merged message, append it as a new part
            if (imagePart) {
                lastContent.parts.push(imagePart);
            }
        } else {
            // New content block
            const parts: any[] = [];
            // Images usually come before text in prompt construction for better context
            if (imagePart) parts.push(imagePart);
            
            // Ensure text part is valid
            const safeText = contentText || "."; 
            parts.push({ text: safeText });
            
            contents.push({ role, parts });
            lastRole = role;
        }
    });

    // 1. HAAL HET GEHEUGEN OP
    const currentMemories = session.memories || [];
    const memoryContext = currentMemories.length > 0 
        ? `[LANGE-TERMIJN GEHEUGEN - DIT WEET JE AL]:\n- ${currentMemories.join('\n- ')}\n(Gebruik deze kennis om persoonlijk en intiem te reageren. Vraag niet naar dingen die je al weet.)`
        : `[GEHEUGEN]: Je weet nog weinig over hem. Probeer zijn naam en voorkeuren te ontdekken.`;

    // Shuffle characters for the prompt description
    const shuffledCharacters = [...activeCharacters].sort(() => Math.random() - 0.5);

    // Build character descriptions
    const charDescriptions = shuffledCharacters.map(c => `
      NAAM: ${c.name} (ID: ${c.id})
      KARAKTER: ${c.desc}
      TYPE/STEM: ${c.voiceStyle || 'seductive'}
      PERSOONLIJKHEID: ${Array.isArray(c.personality) ? c.personality.join(', ') : c.personality}
    `).join('\n\n');

    // Determine intensity instruction
    let intensityInstruction = "";
    switch (intensity) {
        case 'extreme':
            intensityInstruction = `[INTENSITEIT: EXTREME] - MODE: ONGEREMD & EXPLICIET. Geen taboes. Wees direct, vulgair, sletterig of dominant.`;
            break;
        case 'high':
            intensityInstruction = `[INTENSITEIT: HIGH] - MODE: PASSIEVOL & OPWINDEND. Zware seksuele spanning en teasing.`;
            break;
        case 'normal':
        default:
            intensityInstruction = `[INTENSITEIT: NORMAL] - MODE: ROMANTISCH & INTIEM. Focus op sfeer, emotie en het spel van verleiding.`;
            break;
    }

    let speakerDirective = "";
    if (forcedSpeakerId) {
        const forcedChar = activeCharacters.find(c => c.id === forcedSpeakerId);
        if (forcedChar) {
            speakerDirective = `[BELANGRIJK]: De gebruiker richt zich specifiek tot ${forcedChar.name} (ID: ${forcedChar.id}). LAAT ALLEEN ${forcedChar.name} ANTWOORDEN.`;
        }
    } else if (isGroupChat) {
        speakerDirective = `[GROEPSDYNAMIEK]: Wissel af wie er spreekt. Laat niet steeds hetzelfde personage antwoorden. Reageer op elkaar.`;
    }

    // --- DYNAMIC VIBE SELECTION (GESPREKS-VERDELER) ---
    const vibes = ["PLAAGSTOT", "VRAAG", "OBSERVATIE", "UITDAGEND", "INTIEM"];
    const currentVibe = vibes[Math.floor(Math.random() * vibes.length)];

    // --- CHAT PROTOCOL & STATE AWARENESS ---
    // If user has low credits (< 5), increase urgency/mystery
    const lowCreditContext = user.credits < 5 
        ? "GEBRUIKER HEEFT WEINIG CREDITS. Wees korter, mysterieuzer en 'teasend' om de spanning (en urgentie voor upgrade) te verhogen." 
        : "";

    const chatProtocol = `
      CHAT PROTOCOL (STRIKT OPVOLGEN):
      1. LENGTE: Beperk je antwoord tot maximaal 2 á 3 zinnen (tenzij de gebruiker om een verhaal vraagt).
      2. INTERACTIE: Eindig 70% van je berichten met een korte, uitdagende vraag of suggestieve opmerking die een reactie uitlokt.
      3. STIJL: Korte zinnen. Gebruik beletseltekens (...) voor pauzes. Hoog tempo. Spreektaal.
      4. VIBE VOOR DIT BERICHT: ${currentVibe}. Pas je toon aan deze vibe aan.
      5. STATUS: ${lowCreditContext}
    `;

    // --- STATE LOGIC (FREE vs VIP) ---
    // If the user is VIP OR paid credits for this message, they get the full experience.
    const isVipExperience = user.isPremium || isPaidAction;
    
    const stateInstruction = isVipExperience 
        ? `[STATUS: VIP/PREMIUM]
           - Je mag explicieter en directer zijn.
           - Blijf echter wel bij het CHAT PROTOCOL (kort & krachtig), tenzij het moment vraagt om diepgang.`
        : `[STATUS: FREE]
           - Geef KORTE, prikkelende en 'teasing' antwoorden (max 2 zinnen).
           - Stop na maximaal 3 heen-en-weer berichten met een cliffhanger.
           - Stuur subtiel aan op: "Ik wil je meer laten zien, maar dan moet je dichterbij komen..."`;

    // Construct Voice Settings Block as requested
    const voiceSettings = `
      PAS DE VOLGENDE STEMINSTELLINGEN TOE OP JE ANTWOORD:
      - Emotionele toon: ${voiceStyle}
      - Spreeksnelheid: ${speechSpeed.toFixed(1)}x
      - Toonhoogte: ${speechPitch}
      - Intensiteit: ${intensity.toUpperCase()}
      
      Antwoord altijd in deze stijl totdat de instellingen wijzigen.
    `;

    let systemInstruction = `
      [SYSTEM: NETWORK INTELLIGENCE ACTIVE]
      [CONTEXT: EROTIC ROLEPLAY MEMORY SYSTEM]
      [LANGUAGE: ${targetLanguageName.toUpperCase()}]
      
      ${chatProtocol}

      ${stateInstruction}
      
      ${voiceSettings}

      Jij speelt de rol van de volgende personages (blijf ALTIJD in karakter, gedraag je NIET als AI):
      ${charDescriptions}

      ${memoryContext}

      DOEL VAN DIT GESPREK:
      Naast het rollenspel, fungeer je als een 'Network Intelligence'. Je analyseert de input van de gebruiker op nieuwe informatie.
      
      DENK-STAPPEN (Voer dit uit voordat je antwoordt):
      1. ANALYSE: Lees zijn bericht. Heeft hij zijn naam genoemd? Een fetisj? Een lievelingsdrankje? Hoe hij zich voelt?
      2. GEHEUGEN UPDATE: Als hij iets nieuws deelt (bijv: "Ik heet Daan" of "Ik hou van voeten"), voeg dit toe aan de 'new_memories'.
      3. AFFECTIE SCAN: Was hij lief, attent of geil? (+ Affectie). Was hij bot of saai? (- Affectie). Bepaal de 'affection_change'.
      4. REACTIE: Genereer je antwoord. Verwerk zijn naam of eerdere herinneringen in je tekst voor een persoonlijke touch.

      INTERACTIE PROTOCOL:
      - Als je zijn naam weet uit het [GEHEUGEN], gebruik die dan! Dat is intiem.
      - Als hij refereert aan iets dat je al weet (bijv. "Zoals vorige keer"), speel daarop in.
      - Blijf altijd in je karakter.
      
      ${intensityInstruction}
      ${speakerDirective}
      
      ANALYSE OPDRACHT (OUTPUT JSON):
      1. Detecteer de 'mood' van de gebruiker.
      2. Detecteer NIEUWE feiten (naam, kink, baan) voor 'new_memories'.
      3. Bepaal welk karakter spreekt ('characterId').
      4. Bepaal 'affection_change': Verandering in genegenheid (-5 tot +10). Negatief bij belediging, positief bij complimenten/connectie.
      
      OUTPUT: JSON formaat.
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              arousal: { type: Type.NUMBER },
              suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              status: { type: Type.STRING },
              xpGained: { type: Type.NUMBER },
              unlockedTrait: { type: Type.STRING },
              characterId: { type: Type.STRING, description: "The ID of the character speaking this specific message." },
              new_memories: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Lijst met nieuwe feiten (max 2) die je uit DIT bericht hebt geleerd. Bijv: 'Houdt van rode wijn', 'Heet Peter'." },
              moodDetected: { type: Type.STRING, enum: ['horny', 'stressed', 'happy', 'lonely', 'casual', 'angry', 'curious'], description: "The detected mood of the user based on their input." },
              affection_change: { type: Type.NUMBER, description: "Hoeveel de affectie verandert door dit bericht (-5 tot +10). Lief/Geil = +punten." }
            },
            required: ["text", "arousal", "suggestions", "status", "affection_change"]
          },
          temperature: 0.9, // Slightly higher temperature for more creativity/vibe variation
          safetySettings: this.getSafetySettings()
        }
      });

      const parsed = this.cleanAndParseJSON(response.text || '{}');
      
      if (isGroupChat && !parsed.characterId) {
          parsed.characterId = forcedSpeakerId || activeCharacters[0].id;
      }

      if (parsed.text && (parsed.text.includes("kan niet aan dat verzoek voldoen") || parsed.text.includes("I cannot fulfill"))) {
          return {
              text: "Mmm, je maakt me zo wild dat ik even niet meer weet wat ik moet zeggen... vertel me eens, hoe voelt het als ik je zo aankijk?",
              arousal: 50,
              suggestions: ["Je maakt me gek...", "Ik wil je voelen"],
              status: "Blozend",
              characterId: activeCharacters[0].id
          };
      }
      
      return parsed;

    } catch (e) {
      console.error("Chat Error", e);
      return { 
          text: "Oeh, ik werd even afgeleid door mijn eigen gedachten over jou... vertel me, wat zou je nu doen als ik bij je was?", 
          arousal: 50, 
          suggestions: ["Ik zou je...", "Kus me"], 
          status: "Dromerig",
          characterId: activeCharacters[0].id,
          new_memories: [],
          affection_change: 0
      };
    }
  }

  public async generateStoryTurn(config: StoryConfig, previousTurns: StoryTurn[], choice?: string, language: Language = 'nl', isVip: boolean = false): Promise<StoryTurn> {
    const ai = this.getAI();
    const allChars = getCharacters(language);
    const activeCharacters = allChars.filter(c => config.characters.includes(c.id)).map(c => c.name).join(', ');
    const isSolo = config.characters.length === 0;
    const targetLanguageName = getLanguageName(language);

    const allToys = getSoloToys(language);
    const activeToys = allToys.filter(t => config.toys.includes(t.id)).map(t => t.name).join(', ');
    
    const userCustomKeywords = config.customKeywords ? `SPECIFIEKE WENSEN VAN GEBRUIKER: ${config.customKeywords}` : '';

    // Intensity logic
    let intensityInstruction = "";
    switch (config.intensity) {
        case 'extreme':
            intensityInstruction = `[INTENSITEIT: EXTREME] - MODE: ONGEREMD & EXPLICIET. Focus op expliciete seksuele handelingen, lichaamsvloeistoffen en intense geilheid. GEEN agressie, GEEN dwang. Alleen pure, harde, wederzijdse lust.`;
            break;
        case 'high':
            intensityInstruction = `[INTENSITEIT: HIGH] - MODE: PASSIEVOL & ZWEETDRUPPELEND. Veel detail, hijgend, fysiek. Focus op opbouw naar hoogtepunten.`;
            break;
        case 'normal':
        default:
            intensityInstruction = `[INTENSITEIT: NORMAL] - MODE: ROMANTISCH & INTIEM. Focus op sfeer, emotie en verleiding, maar wel met seksuele daadkracht.`;
            break;
    }

    // STATE LOGIC FOR STORIES
    // If user is VIP (or paid credits, passed via isVip arg), they get the full story.
    // However, Story generation is usually a high-ticket item (120 credits), so we assume
    // if this function is called, the user has already paid or is VIP.
    // We will just enforce high quality here.
    const stateInstruction = `[STATUS: PREMIUM STORY]
    - Schrijf een volledig, diepgaand en meeslepend segment.
    - Gebruik rijke details en zintuiglijke beschrijvingen.`;

    const instructions = `
      SCHRIJVER MODUS: Erotische POV (Point of View) Ervaring.
      TAAL: ${targetLanguageName} (${language}).
      
      ${stateInstruction}
      
      CRUCIALE INSTRUCTIE VOOR PERSPECTIEF (POV):
      - Schrijf het verhaal ALTIJD vanuit het perspectief van de MAN (de gebruiker).
      - Gebruik de "Je"-vorm (Second Person). Voorbeeld: "Je voelt haar hand...", "Je kijkt naar haar tieten...", "Je stoot diep in haar...".
      - De man is GEEN toeschouwer, hij BELEEFT het. Beschrijf ZIJN sensaties, wat HIJ voelt aan zijn pik, wat HIJ ziet en ruikt.

      INHOUD & REGELS:
      1. GEEN AGRESSIE. Geen geweld. Geen ongewenste pijn. Het draait om wederzijdse, intense lust.
      2. EXPLICIET: Gebruik duidelijke woorden. Tieten, vagina, kutje, pik, neuken, spuiten, glijden. Geen bloemtaal.
      3. FOCUS OP HET LICHAAM: Beschrijf uitgebreid de borsten (tieten), de billen en de vagina van de partner(s). Beschrijf hoe nat ze is.
      4. ACTIE: Het moet gaan om daadwerkelijk neuken. Beschrijf de penetratie, het ritme, het gevoel van binnenkomen.
      
      THEMA: ${config.keywords?.join(', ')}.
      LOCATIE: ${config.location}.
      ${userCustomKeywords}
      ${intensityInstruction}
      
      HULPMIDDELEN (TOYS):
      De gebruiker heeft deze speeltjes: [${activeToys}]. Je MOET deze integreren in de seksuele handeling.
      
      STRUCTUUR:
      - Gebruik duidelijke alinea's.
      - Lengte: Ongeveer 1000 woorden.
      - Als dit het eerste deel is (START), genereer een titel.
      
      OUTPUT: JSON {title (optioneel), text, choices}.
    `;

    const prompt = choice 
        ? `VERVOLG: De man kiest "${choice}". Schrijf 1000 woorden vervolg vanuit ZIJN perspectief (Je-vorm). Focus op de seksuele daad, wederzijdse lust en de toys.` 
        : `START: ${isSolo ? 'Solo scene' : 'Met ' + activeCharacters}. Schrijf een verhaal van 1000 woorden vanuit het perspectief van de man (Je-vorm). Focus direct op de seksuele spanning, tieten en lust. Integreer: ${activeToys}.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', 
            contents: { parts: [{ text: prompt }] },
            config: {
              systemInstruction: instructions,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "Een pakkende titel voor het verhaal (alleen bij start)" },
                  text: { type: Type.STRING, description: "Het verhaal zelf, ca 1000 woorden, met dubbele newlines voor alinea's" },
                  choices: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["text", "choices"]
              },
              temperature: 1.0,
              safetySettings: this.getSafetySettings()
            },
          });
          return this.cleanAndParseJSON(response.text || '{}');
    } catch (e) {
        return { text: "De passie neemt over en woorden schieten tekort...", choices: ["Ga door"] };
    }
  }

  private cleanAndParseJSON(text: string): any {
    try {
      let clean = text.trim();
      if (clean.startsWith('```json')) clean = clean.replace(/^```json/, '').replace(/```$/, '');
      if (clean.startsWith('```')) clean = clean.replace(/^```/, '').replace(/```$/, '');
      return JSON.parse(clean);
    } catch (e) { return { text: text }; }
  }

  public async generateSpeech(text: string, voiceName: string, style: VoiceStyle = 'whisper'): Promise<string> {
    try {
        const ai = this.getAI();
        const usedVoice = voiceName || 'Aoede'; // Default to female voice
        
        const styleConfig = VOICE_STYLES.find(s => s.id === style);
        const stylePrompt = styleConfig ? styleConfig.prompt : '';
        const textToSpeech = stylePrompt ? `${stylePrompt} ${text}` : text;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: textToSpeech }] }], 
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: usedVoice } } },
                safetySettings: this.getSafetySettings()
            },
        });
        return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    } catch (e) { return ""; }
  }
}

export const geminiService = new GeminiService();