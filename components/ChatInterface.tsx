
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Character, Message, ChatSession, UserProfile, Language, VoiceStyle, IntensityLevel, UserMood } from '../types';
import { getGifts, DEFAULT_VIDEO, getTexts, getVoiceStyles, getDiceActions } from '../constants';
import { geminiService } from '../services/geminiService';
import Icons from './Icon';

interface ChatInterfaceProps {
  initialSession: ChatSession;
  onSaveSession: (session: ChatSession) => void;
  user: UserProfile;
  onUpdateUser: (updates: Partial<UserProfile>) => void; // Kept for interface compat, but not used for global memory anymore
  onConsumeCredit: (cost: number) => boolean;
  onConsumeDailyMessage: () => boolean;
  onShowPaywall: (reason: string) => void;
  language: Language;
  characters: Character[];
  onShowToast?: (title: string, message: string, icon?: string, characterId?: string) => void;
}

const XP_PER_LEVEL = 100;

const getMoodIcon = (mood?: UserMood) => {
    switch (mood) {
        case 'horny': return '🔥';
        case 'lonely': return '🧸';
        case 'stressed': return '💆';
        case 'happy': return '✨';
        case 'angry': return '💢';
        case 'curious': return '🤔';
        default: return '😐';
    }
};

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
    return buffer;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  initialSession,
  onSaveSession,
  user,
  onUpdateUser,
  onConsumeCredit,
  onConsumeDailyMessage,
  onShowPaywall,
  language,
  characters,
  onShowToast
}) => {
  const [session, setSession] = useState<ChatSession>(initialSession);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showGifts, setShowGifts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [diceResult, setDiceResult] = useState<string | null>(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  // State for voice modulation - initialized from session
  const [speechSpeed, setSpeechSpeed] = useState(initialSession.speechSpeed || 1.0);
  const [speechPitch, setSpeechPitch] = useState(initialSession.speechPitch || 0);

  const [nextSpeakerId, setNextSpeakerId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isMounted = useRef(true);

  const [intensity, setIntensity] = useState<IntensityLevel>(initialSession.intensity || 'normal');
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>(
      initialSession.voiceStyle || 
      characters.find(c => c.id === initialSession.characterId)?.voiceStyle || 
      'seductive'
  );

  const texts = getTexts(language);
  const t = texts.chat;
  const tIntensity = texts.intensity;
  const gifts = getGifts(language);
  const diceActions = getDiceActions(language);
  const voiceStyles = getVoiceStyles(language);

  const activeCharacters = useMemo(() => {
    const ids = session.characterIds && session.characterIds.length > 0 
        ? session.characterIds 
        : [session.characterId];
    return ids.map(id => characters.find(c => c.id === id)).filter(Boolean) as Character[];
  }, [characters, session.characterId, session.characterIds]);

  const primaryCharacter = activeCharacters[0] || characters[0];
  const isGroupChat = activeCharacters.length > 1;

  const backgroundVideo = useMemo(() => {
      if (primaryCharacter.video) return primaryCharacter.video;
      const charWithVideo = activeCharacters.find(c => c.video);
      if (charWithVideo) return charWithVideo.video;
      return DEFAULT_VIDEO;
  }, [primaryCharacter, activeCharacters]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
        isMounted.current = false;
        if (currentSourceRef.current) {
            try { currentSourceRef.current.stop(); } catch(e) {}
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
        }
    };
  }, []);

  useEffect(() => {
    setSession(initialSession);
    if (initialSession.intensity) setIntensity(initialSession.intensity);
    if (initialSession.voiceStyle) {
        setVoiceStyle(initialSession.voiceStyle);
    } else {
        const firstChar = characters.find(c => c.id === initialSession.characterId);
        if (firstChar && firstChar.voiceStyle) setVoiceStyle(firstChar.voiceStyle);
    }
    // Also update speech params if session changes (e.g. loading different chat)
    setSpeechSpeed(initialSession.speechSpeed || 1.0);
    setSpeechPitch(initialSession.speechPitch || 0);
  }, [initialSession, characters]);

  const updateSettings = (updates: { voiceStyle?: VoiceStyle; intensity?: IntensityLevel; speechSpeed?: number; speechPitch?: number }) => {
      if (updates.voiceStyle) setVoiceStyle(updates.voiceStyle);
      if (updates.intensity) setIntensity(updates.intensity);
      if (updates.speechSpeed !== undefined) setSpeechSpeed(updates.speechSpeed);
      if (updates.speechPitch !== undefined) setSpeechPitch(updates.speechPitch);
      
      const updatedSession = { 
          ...session, 
          ...updates 
      };
      setSession(updatedSession);
      onSaveSession(updatedSession);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session.messages, isTyping]);

  const initAudio = useCallback(async () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playSpeech = useCallback(async (text: string, speakerId?: string) => {
    if (!isMounted.current || isMuted || !text) return;

    try {
        const ctx = await initAudio();
        setIsSpeaking(true);

        const speaker = activeCharacters.find(c => c.id === speakerId) || primaryCharacter;
        const voiceName = speaker.voice || 'Kore';

        const audioData = await geminiService.generateSpeech(text, voiceName, voiceStyle);
        
        if (!audioData || !isMounted.current) {
            setIsSpeaking(false);
            return;
        }

        const binaryString = atob(audioData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        
        const audioBuffer = await decodeAudioData(bytes, ctx, 24000, 1);
        
        if (!isMounted.current) return;

        if (currentSourceRef.current) {
            try { currentSourceRef.current.stop(); } catch(e) {}
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        
        source.playbackRate.value = speechSpeed;
        
        // Pitch shifting is complex in WebAudio without libraries, 
        // detune is the closest standard property but affects speed too. 
        // For pure pitch without speed change, we'd need a phase vocoder.
        // For now, we use detune which is standard.
        source.detune.value = speechPitch * 100; // 100 cents per semitone
        
        source.connect(ctx.destination);
        
        source.onended = () => {
            if (isMounted.current) setIsSpeaking(false);
        };
        
        currentSourceRef.current = source;
        source.start(0);

    } catch (e) {
        console.error("Audio playback failed", e);
        if (isMounted.current) setIsSpeaking(false);
    }
  }, [activeCharacters, primaryCharacter, voiceStyle, isMuted, initAudio, speechSpeed, speechPitch]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = language; 
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText(prev => (prev ? prev + ' ' + transcript : transcript));
    };

    recognition.start();
  }, [isListening, language]);

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    // --- COST LOGIC ---
    // Cost depends on intensity level
    let messageCost = 1;
    if (intensity === 'high') messageCost = 5;
    if (intensity === 'extreme') messageCost = 10;

    let isPaidAction = false;
    if (!user.isPremium) {
        // Only consume daily messages if intensity is NORMAL
        if (intensity === 'normal' && user.dailyMessagesLeft > 0) {
            // Free message, managed by onConsumeDailyMessage
            if (!onConsumeDailyMessage()) return;
        } else {
            // Intensity is HIGH/EXTREME OR daily limit reached -> consume credits
            if (!onConsumeCredit(messageCost)) return; // Paywall shown by onConsumeCredit
            isPaidAction = true;
        }
    }
    // ------------------
    
    await initAudio();

    const newMessage: Message = { id: Date.now().toString(), role: 'user', text: inputText, timestamp: Date.now() };
    const updatedSession = { ...session, messages: [...session.messages, newMessage], lastUpdated: Date.now(), voiceStyle, intensity, speechSpeed, speechPitch };

    setSession(updatedSession);
    onSaveSession(updatedSession);
    setInputText('');
    setIsTyping(true);

    const requestedSpeakerId = nextSpeakerId;
    setNextSpeakerId(null);

    try {
      const response = await geminiService.sendRoleplayMessage(
        newMessage.text, 
        activeCharacters, 
        updatedSession, 
        user, 
        intensity, 
        voiceStyle, 
        undefined, 
        session.messagesSinceLastImage, 
        requestedSpeakerId || undefined, 
        language,
        isPaidAction, // Signal that we paid for this message if necessary
        speechSpeed, // Pass speech speed
        speechPitch  // Pass speech pitch
      );

      // MEMORY & AFFECTION UPDATE LOGICA
      const currentMemories = session.memories || [];
      const newResponseMemories = response.new_memories || [];
      // Voeg alleen unieke, nieuwe herinneringen toe
      const updatedMemories = Array.from(new Set([...currentMemories, ...newResponseMemories]));

      const currentAffection = session.affection || 0;
      const affectionDelta = response.affection_change || 0;
      const newAffection = Math.min(100, Math.max(0, currentAffection + affectionDelta));

      const newMood = response.moodDetected || session.currentMood;

      const modelMessage: Message = { id: (Date.now() + 1).toString(), role: 'model', text: response.text, timestamp: Date.now(), imageUrl: response.imageUrl, characterId: response.characterId };
      let newXp = (session.experience || 0) + (response.xpGained || 10);
      let newLevel = session.level;
      if (newXp >= newLevel * XP_PER_LEVEL) { newLevel++; newXp = newXp - (newLevel - 1) * XP_PER_LEVEL; }

      const finalSession: ChatSession = {
        ...updatedSession, 
        messages: [...updatedSession.messages, modelMessage], 
        arousal: Math.min(100, (session.arousal || 0) + (response.arousal || 5)), 
        affection: newAffection,
        experience: newXp, 
        level: newLevel, 
        messagesSinceLastImage: modelMessage.imageUrl ? 0 : (session.messagesSinceLastImage || 0) + 1, 
        intensity: intensity,
        voiceStyle: voiceStyle,
        speechSpeed: speechSpeed,
        speechPitch: speechPitch,
        memories: updatedMemories,
        currentMood: newMood
      };

      if (affectionDelta > 4 && onShowToast) {
         const speaker = activeCharacters.find(c => c.id === response.characterId) || primaryCharacter;
         onShowToast("Affectie Gestegen", `${speaker.name} voelt zich meer verbonden met je!`, "💖", speaker.id);
      }

      setSession(finalSession);
      onSaveSession(finalSession);
      if (!isMuted) playSpeech(modelMessage.text, modelMessage.characterId);
    } catch (error) { console.error(error); } finally { setIsTyping(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!onConsumeCredit(2)) return; // Image upload cost logic preserved
    
    initAudio();
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      const mimeType = file.type;
      const newMessage: Message = { id: Date.now().toString(), role: 'user', text: "...", timestamp: Date.now(), imageUrl: base64String };
      const updatedSession = { ...session, messages: [...session.messages, newMessage], lastUpdated: Date.now(), voiceStyle, intensity, speechSpeed, speechPitch };
      setSession(updatedSession);
      onSaveSession(updatedSession);
      setIsTyping(true);
      setNextSpeakerId(null);
       try {
        // Image message always considered "Paid" interaction contextually because user paid 2 credits to upload
        const response = await geminiService.sendRoleplayMessage(
            newMessage.text, 
            activeCharacters, 
            updatedSession, 
            user, 
            intensity, 
            voiceStyle, 
            { data: base64String.split(',')[1], mimeType }, 
            session.messagesSinceLastImage, 
            undefined, 
            language,
            true,
            speechSpeed,
            speechPitch
        );
        
        // Consistent Memory & Affection Logic
        const currentMemories = session.memories || [];
        const newResponseMemories = response.new_memories || [];
        const updatedMemories = Array.from(new Set([...currentMemories, ...newResponseMemories]));

        const currentAffection = session.affection || 0;
        const affectionDelta = response.affection_change || 0;
        const newAffection = Math.min(100, Math.max(0, currentAffection + affectionDelta));

        const newMood = response.moodDetected || session.currentMood;

        const modelMessage: Message = { id: (Date.now() + 1).toString(), role: 'model', text: response.text, timestamp: Date.now(), imageUrl: response.imageUrl, characterId: response.characterId };
        const finalSession: ChatSession = { 
            ...updatedSession, 
            messages: [...updatedSession.messages, modelMessage], 
            arousal: Math.min(100, (session.arousal || 0) + (response.arousal || 15)), 
            affection: newAffection,
            messagesSinceLastImage: modelMessage.imageUrl ? 0 : (session.messagesSinceLastImage || 0) + 1,
            memories: updatedMemories,
            currentMood: newMood,
            intensity: intensity,
            voiceStyle: voiceStyle,
            speechSpeed: speechSpeed,
            speechPitch: speechPitch
        };
        
        setSession(finalSession);
        onSaveSession(finalSession);
        if (!isMuted) playSpeech(modelMessage.text, modelMessage.characterId);
       } catch (e) { console.error(e); } finally { setIsTyping(false); }
    };
    reader.readAsDataURL(file);
  };

  const handleSendGift = (gift: any) => {
      if (!onConsumeCredit(gift.cost)) return;
      initAudio();
      const newMessage: Message = { id: Date.now().toString(), role: 'user', text: `*Geeft ${gift.name}* ${gift.icon}`, timestamp: Date.now(), isGift: true };
      const updatedSession = { ...session, messages: [...session.messages, newMessage], affection: (session.affection || 0) + gift.affectionBoost, voiceStyle, intensity, speechSpeed, speechPitch };
      setSession(updatedSession);
      onSaveSession(updatedSession);
      setShowGifts(false);
      setIsTyping(true);
      setNextSpeakerId(null);
      // Gift message also implies premium context
      geminiService.sendRoleplayMessage(`[ACTION: User gave gift: ${gift.name}]`, activeCharacters, updatedSession, user, intensity, voiceStyle, undefined, 0, undefined, language, true, speechSpeed, speechPitch).then(response => {
          const modelMessage: Message = { id: (Date.now() + 1).toString(), role: 'model', text: response.text, timestamp: Date.now(), characterId: response.characterId };
          const finalSession = { 
              ...updatedSession, 
              messages: [...updatedSession.messages, modelMessage], 
              arousal: Math.min(100, (session.arousal || 0) + 5), 
              affection: (updatedSession.affection || 0) + (response.affection_change || 0), // Add dynamic affection on top of gift boost
              voiceStyle, 
              intensity,
              speechSpeed,
              speechPitch 
          };
          setSession(finalSession);
          onSaveSession(finalSession);
          setIsTyping(false);
          if(!isMuted) playSpeech(modelMessage.text, modelMessage.characterId);
      });
  };

  const rollDice = () => {
      if (!onConsumeCredit(1)) return;
      const action = diceActions[Math.floor(Math.random() * diceActions.length)];
      setDiceResult(action);
      setInputText(prev => (prev ? prev + " " + action : action));
      setTimeout(() => setDiceResult(null), 4000);
  };

  return (
    <div className="flex flex-col h-full bg-black relative">
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <video src={backgroundVideo} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-100" />
          <div className="absolute inset-0 bg-black/10" />
      </div>

      <div className="relative z-10 p-4 border-b border-white/5 bg-black/20 backdrop-blur-md flex items-center justify-between safe-pt">
          <div className="flex items-center gap-3">
              <div className="flex -space-x-3">
                  {activeCharacters.map((char, index) => (
                      <button key={char.id} className={`relative z-0 transition-transform active:scale-95 ${nextSpeakerId === char.id ? 'z-20 scale-110' : ''}`} style={{ zIndex: nextSpeakerId === char.id ? 20 : 10 - index }} onClick={() => isGroupChat && setNextSpeakerId(char.id === nextSpeakerId ? null : char.id)}>
                          <img src={char.avatar} className={`w-10 h-10 rounded-full object-cover border-2 transition-all ${nextSpeakerId === char.id ? 'border-gold-500 shadow-[0_0_15px_rgba(255,215,0,0.6)]' : 'border-gold-500/50'}`} />
                          {nextSpeakerId === char.id && <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-gold-500 rounded-full flex items-center justify-center border border-black shadow-lg"><Icons.MessageSquare size={8} className="text-black" /></div>}
                      </button>
                  ))}
              </div>
              <div>
                  <h3 className="text-white font-headline font-bold text-sm leading-none flex items-center gap-2 drop-shadow-md">
                      {isGroupChat ? `${activeCharacters.length} Partners` : primaryCharacter.name}
                      {isSpeaking && <span className="text-[9px] text-gold-500 font-black animate-pulse uppercase">Spreekt...</span>}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                       <div className="h-1 w-16 bg-black/50 rounded-full overflow-hidden"><div className="h-full bg-pink-500" style={{ width: `${session.arousal || 0}%` }} /></div>
                       <span className="text-[9px] text-pink-400 font-bold uppercase drop-shadow-md">{t.lust}</span>
                       {session.currentMood && <span className="text-lg animate-in zoom-in" title={`Mood: ${session.currentMood}`}>{getMoodIcon(session.currentMood)}</span>}
                  </div>
              </div>
          </div>
          <div className="flex items-center gap-2">
              <button onClick={() => setIsMuted(!isMuted)} className={`p-2 rounded-full border transition-all ${isMuted ? 'border-red-500 text-red-500 bg-red-500/10' : 'border-gold-500/20 text-gold-500 bg-black/30'}`}>{isMuted ? <Icons.VolumeX size={18} /> : <Icons.Volume2 size={18} />}</button>
              <button onClick={() => setShowDice(!showDice)} className="p-2 text-gold-500 bg-black/30 rounded-full hover:bg-black/50 transition-colors border border-transparent"><Icons.Dices size={20} /></button>
              <button onClick={() => setShowSettings(!showSettings)} className="p-2 text-zinc-300 hover:text-white transition-colors"><Icons.Settings size={20} /></button>
          </div>
      </div>

      {showSettings && (
          <div className="absolute top-16 right-4 z-50 w-80 md:w-96 bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 shadow-[0_0_40px_rgba(0,0,0,0.8)] animate-in fade-in slide-in-from-top-5">
              <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
                  <h3 className="text-gold-500 font-headline font-bold uppercase tracking-widest text-sm">
                      Chat Instellingen
                  </h3>
                  <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white transition-colors"><Icons.X size={16}/></button>
              </div>

              {/* EMOTIONELE TOON */}
              <div className="mb-6">
                  <label className="text-zinc-400 text-[10px] font-bold uppercase tracking-wider block mb-2">{t.settings.tone}</label>
                  <div className="grid grid-cols-2 gap-2">
                      {voiceStyles.slice(0, 6).map(s => (
                          <button
                              key={s.id}
                              onClick={() => updateSettings({ voiceStyle: s.id })}
                              className={`p-3 rounded-lg border text-xs font-bold transition-all ${voiceStyle === s.id ? 'border-gold-500 bg-gold-500/10 text-gold-500' : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}
                          >
                              {s.label}
                          </button>
                      ))}
                  </div>
              </div>

              {/* STEM MODIFICATIE */}
              <div className="mb-6">
                  <label className="text-zinc-400 text-[10px] font-bold uppercase tracking-wider block mb-2">{t.settings.voice_mod}</label>
                  <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                      <div className="flex justify-between text-[10px] text-zinc-400 mb-2 font-bold uppercase tracking-wider">
                          <span>{t.settings.speed}</span>
                          <span className="text-gold-500">{speechSpeed.toFixed(1)}x</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.5" 
                        max="2.0" 
                        step="0.1" 
                        value={speechSpeed} 
                        onChange={(e) => updateSettings({ speechSpeed: parseFloat(e.target.value) })} 
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-gold-500 mb-6" 
                      />

                      <div className="flex justify-between text-[10px] text-zinc-400 mb-2 font-bold uppercase tracking-wider">
                          <span>{t.settings.pitch}</span>
                          <span className="text-gold-500">{speechPitch > 0 ? '+' : ''}{speechPitch}</span>
                      </div>
                      <input 
                        type="range" 
                        min="-10" 
                        max="10" 
                        step="1" 
                        value={speechPitch} 
                        onChange={(e) => updateSettings({ speechPitch: parseInt(e.target.value) })} 
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-gold-500" 
                      />
                      <div className="flex justify-between text-[8px] text-zinc-600 mt-2 font-bold uppercase">
                          <span>{t.settings.deep}</span>
                          <span>{t.settings.high}</span>
                      </div>
                  </div>
              </div>

              {/* INTENSITEIT */}
              <div>
                   <label className="text-zinc-400 text-[10px] font-bold uppercase tracking-wider block mb-2">{t.settings.intensity}</label>
                   <div className="flex gap-2">
                      {(['normal', 'high', 'extreme'] as IntensityLevel[]).map(l => {
                          const isRed = l === 'high' || l === 'extreme';
                          const isActive = intensity === l;
                          
                          let activeClass = '';
                          if (isActive) {
                             activeClass = isRed 
                                ? 'border-red-500 bg-red-500/10 text-red-500 shadow-[0_0_15px_rgba(220,38,38,0.4)]' 
                                : 'border-gold-500 bg-gold-500/10 text-gold-500 shadow-[0_0_15px_rgba(255,215,0,0.4)]';
                          } else {
                             activeClass = 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800';
                          }

                          return (
                              <button
                                  key={l}
                                  onClick={() => updateSettings({ intensity: l })}
                                  className={`flex-1 p-3 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all ${activeClass}`}
                              >
                                  {tIntensity[l]}
                              </button>
                          );
                      })}
                   </div>
              </div>
          </div>
      )}

      {diceResult && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
              <div className="bg-gold-500 text-black px-6 py-3 rounded-full font-black text-sm uppercase tracking-widest shadow-[0_0_30px_rgba(255,215,0,0.6)] animate-in zoom-in duration-300">🎲 {diceResult}</div>
          </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-6 no-scrollbar relative z-10">
          {session.messages.map((msg) => {
              const speaker = msg.role === 'model' && msg.characterId ? activeCharacters.find(c => c.id === msg.characterId) || primaryCharacter : primaryCharacter;
              return (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                    {msg.role === 'model' && isGroupChat && <div className="mr-2 self-end mb-1"><img src={speaker.avatar} className="w-8 h-8 rounded-full object-cover border border-white/20" title={speaker.name} /></div>}
                    <div className={`relative max-w-[80%] md:max-w-[60%] ${msg.role === 'user' ? 'bg-gold-500/10 border border-gold-500/20 rounded-2xl rounded-tr-sm' : 'bg-zinc-950/70 border border-white/5 rounded-2xl rounded-tl-sm'} p-3 md:p-4 backdrop-blur-md group shadow-xl`}>
                        {msg.role === 'model' && isGroupChat && <div className="text-[10px] font-black text-gold-500/70 mb-1 uppercase tracking-widest">{speaker.name}</div>}
                        {msg.role === 'model' && <button onClick={() => playSpeech(msg.text, msg.characterId)} className="absolute -right-10 top-2 p-2 text-zinc-500 hover:text-gold-500 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"><Icons.Volume2 size={16} /></button>}
                        {msg.imageUrl && <div className="mb-3 rounded-xl overflow-hidden border border-white/10 relative"><img src={msg.imageUrl} className="w-full h-auto object-cover max-h-64" alt="Uploaded content" /></div>}
                        {msg.isGift && <div className="text-center mb-2"><div className="inline-block bg-gold-500/20 text-gold-400 text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider border border-gold-500/30">{t.gift_sent}</div></div>}
                        <p className="text-sm md:text-base leading-relaxed text-zinc-100 whitespace-pre-wrap font-body">{msg.text}</p>
                        <span className="text-[9px] text-zinc-500 mt-1 block text-right opacity-50">{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                </div>
              );
          })}
          {isTyping && <div className="flex justify-start animate-in fade-in"><div className="bg-zinc-900/60 border border-white/5 rounded-2xl rounded-tl-sm p-3 backdrop-blur-sm flex gap-1 ml-10"><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span></div></div>}
          <div ref={messagesEndRef} />
      </div>

      {showGifts && (
          <div className="bg-zinc-900 border-t border-white/10 p-4 animate-in slide-in-from-bottom-10 z-20">
              <div className="flex gap-4 overflow-x-auto no-scrollbar">
                  {gifts.map(gift => (
                      <button key={gift.id} onClick={() => handleSendGift(gift)} className="flex-shrink-0 w-24 bg-black border border-white/10 rounded-xl p-3 flex flex-col items-center gap-2 hover:border-gold-500 hover:bg-white/5 transition-all">
                          <span className="text-2xl">{gift.icon}</span><span className="text-[10px] font-bold text-white">{gift.name}</span><span className="text-[9px] text-gold-500">{gift.cost} CR</span>
                      </button>
                  ))}
              </div>
          </div>
      )}

      {showDice && <div className="absolute bottom-20 left-4 z-30 bg-black/90 border border-gold-500/20 rounded-xl p-3 backdrop-blur-md animate-in zoom-in-95 origin-bottom-left shadow-xl"><button onClick={rollDice} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gold-500 hover:text-white transition-colors"><Icons.Dices size={16} /><span>{t.dice}</span></button></div>}

      <div className="p-3 md:p-4 bg-black/40 border-t border-white/5 relative z-20 safe-pb backdrop-blur-md">
          {nextSpeakerId && isGroupChat && <div className="absolute -top-10 left-0 right-0 flex justify-center animate-in slide-in-from-bottom-2 fade-in"><div className="bg-gold-500 text-black px-4 py-1.5 rounded-full text-[10px] font-bold shadow-lg flex items-center gap-2"><Icons.MessageSquare size={12} /><span>Volgende: {activeCharacters.find(c => c.id === nextSpeakerId)?.name}</span><button onClick={() => setNextSpeakerId(null)} className="ml-2 hover:text-white"><Icons.X size={12} /></button></div></div>}
          <div className="max-w-4xl mx-auto flex items-end gap-2">
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
              <button onClick={() => fileInputRef.current?.click()} className="p-3 rounded-full bg-zinc-900/80 border border-white/10 text-zinc-400 hover:text-white hover:border-gold-500 transition-all active:scale-95"><Icons.Image size={20} /></button>
              <button onClick={() => setShowGifts(!showGifts)} className={`p-3 rounded-full bg-zinc-900/80 border transition-all active:scale-95 ${showGifts ? 'border-gold-500 text-gold-500' : 'border-white/10 text-zinc-400 hover:text-white'}`}><Icons.Sparkles size={20} /></button>
              <button onClick={toggleListening} className={`p-3 rounded-full bg-zinc-900/80 border transition-all active:scale-95 ${isListening ? 'border-red-500 text-red-500 animate-pulse' : 'border-white/10 text-zinc-400 hover:text-white'}`}>{isListening ? <Icons.MicOff size={20} /> : <Icons.Mic size={20} />}</button>
              <div className="flex-1 bg-zinc-900/80 border border-white/10 rounded-[1.5rem] flex items-center px-4 py-1.5 focus-within:border-gold-500/50 transition-colors">
                  <textarea value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={isListening ? t.listening : t.type_message} className="w-full bg-transparent border-none text-white text-sm max-h-24 py-2 resize-none focus:ring-0 placeholder-zinc-500 no-scrollbar leading-relaxed" rows={1} style={{minHeight: '44px'}} />
              </div>
              <button onClick={handleSendMessage} disabled={!inputText.trim()} className="p-3 rounded-full bg-gold-500 text-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white transition-all shadow-lg active:scale-90"><Icons.Send size={20} fill="currentColor" className="ml-0.5" /></button>
          </div>
      </div>
    </div>
  );
};

export default ChatInterface;
