
import { geminiService } from '../services/geminiService';
import { LiveServerMessage, Blob, Modality } from '@google/genai';
import { getLanguageName, getTexts, getCharacters, DEFAULT_VIDEO, getSoloToys } from '../constants';
import Icons from './Icon';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ModelConfig, Language, UserProfile } from '../types';

interface SoloCoachInterfaceProps {
  language: Language;
  user: UserProfile;
}

// Phase tracking for the UI to give visual feedback
type SessionPhase = 'intake' | 'build' | 'edging' | 'climax' | 'aftercare';
type CoachLevel = 'beginner' | 'experienced' | 'extreme';
type DurationOption = 5 | 10 | 15 | 20 | 30 | 60 | 0; // 0 = open end

function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number = 16000): Float32Array {
  if (inputRate === outputRate) return buffer;
  const sampleRateRatio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    let nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

// --- Haptic Feedback Helper ---
const triggerHaptic = (pattern: number | number[]) => {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
};

const SoloCoachInterface: React.FC<SoloCoachInterfaceProps> = ({ language, user }) => {
  const [connectionState, setConnectionState] = useState<'idle' | 'calling' | 'connected'>('idle');
  
  // Setup State
  const [showSetup, setShowSetup] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<CoachLevel>('experienced');
  const [selectedToys, setSelectedToys] = useState<string[]>(['hands', 'oil']); 
  const [selectedDuration, setSelectedDuration] = useState<DurationOption>(15);
  
  // Session State
  const [timeLeft, setTimeLeft] = useState<number>(0); // in seconds
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  const [isMicOn, setIsMicOn] = useState(true);
  const [isTalking, setIsTalking] = useState(false);
  const [subtitle, setSubtitle] = useState<string>('');
  const [blackoutMode, setBlackoutMode] = useState(false);
  const [phase, setPhase] = useState<SessionPhase>('intake');
  
  // Rhythm / Stroke Sync State
  const [strokeCount, setStrokeCount] = useState(0);
  const [lastTapTime, setLastTapTime] = useState(0);
  const [bpm, setBpm] = useState(0);
  
  const subtitleTimeoutRef = useRef<number | null>(null);
  const visualizerRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const outputNodeRef = useRef<GainNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const isMicOnRef = useRef(isMicOn);
  const timerIntervalRef = useRef<any>(null);
  const silenceCheckIntervalRef = useRef<any>(null); // NEW: Check silence
  const lastInteractionRef = useRef<number>(Date.now()); // NEW: Track silence
  const isMounted = useRef(true);

  // Rhythm tracking ref
  const bpmRef = useRef(0);

  const t = getTexts(language).coach;
  const availableToys = getSoloToys(language);

  const ambientVideo = useMemo(() => {
    const chars = getCharacters(language).filter(c => c.video && !c.isDoll);
    return chars.length > 0 ? chars[Math.floor(Math.random() * chars.length)].video : DEFAULT_VIDEO;
  }, [language]);

  useEffect(() => { 
    isMicOnRef.current = isMicOn; 
  }, [isMicOn]);

  const cleanup = useCallback(() => {
    if (sessionRef.current && typeof sessionRef.current.close === 'function') {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        inputAudioContextRef.current.close().catch(() => {});
        inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close().catch(() => {});
        outputAudioContextRef.current = null;
    }
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
    }
    if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
    }
    if (silenceCheckIntervalRef.current) {
        clearInterval(silenceCheckIntervalRef.current);
        silenceCheckIntervalRef.current = null;
    }
    
    sourcesRef.current.forEach(s => {
        try { s.stop(); } catch(e) {}
        s.disconnect();
    });
    sourcesRef.current.clear();
    
    if (isMounted.current) {
      setConnectionState('idle');
      setShowSetup(false);
      setIsTalking(false);
      setSubtitle('');
      setPhase('intake');
      setBpm(0);
      setIsTimerRunning(false);
    }
    nextStartTimeRef.current = 0;
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      cleanup();
    };
  }, [cleanup]);

  // --- SILENCE DETECTION LOGIC ---
  useEffect(() => {
      if (connectionState === 'connected') {
          lastInteractionRef.current = Date.now(); // Reset on start
          
          silenceCheckIntervalRef.current = setInterval(() => {
              const now = Date.now();
              const timeSinceLastInteraction = now - lastInteractionRef.current;
              
              // If silence > 10 seconds, nudge the AI
              if (timeSinceLastInteraction > 10000 && sessionRef.current) {
                  // Send invisible prompt to wake her up
                  sessionRef.current.sendRealtimeInput({ 
                      text: `[SYSTEM: De gebruiker is stil. Moedig hem aan. Zeg iets als "Ga door...", "Ik hoor je ademen...", of geef een nieuwe instructie uit het script.]` 
                  });
                  // Don't reset lastInteractionRef fully, so it keeps checking if silence persists
                  lastInteractionRef.current = now - 5000; 
              }
          }, 2000); 
      }
      return () => { if (silenceCheckIntervalRef.current) clearInterval(silenceCheckIntervalRef.current); };
  }, [connectionState]);

  // --- TIMER LOGIC (Active Pacing) ---
  useEffect(() => {
      if (isTimerRunning && selectedDuration > 0) {
          timerIntervalRef.current = setInterval(() => {
              setTimeLeft(prev => {
                  if (prev <= 1) {
                      clearInterval(timerIntervalRef.current);
                      setIsTimerRunning(false);
                      // Time is up triggers
                      if (sessionRef.current) {
                          sessionRef.current.sendRealtimeInput({ text: `[SYSTEM: TIME IS UP! Guide him to the finale.]` });
                      }
                      return 0;
                  }
                  
                  // Active Pacing Triggers
                  const totalSeconds = selectedDuration * 60;
                  
                  // Halverwege trigger
                  if (prev === Math.floor(totalSeconds / 2) && sessionRef.current) {
                       sessionRef.current.sendRealtimeInput({ text: `[SYSTEM: Halfway point. Ask him how he feels. Whisper: "We zijn op de helft... hou je het nog vol?"]` });
                  }
                  
                  // Laatste minuut trigger
                  if (prev === 60 && sessionRef.current) {
                       sessionRef.current.sendRealtimeInput({ text: `[SYSTEM: 60 seconds remaining! Increase intensity.]` });
                  }

                  return prev - 1;
              });
          }, 1000);
      }
      return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [isTimerRunning, selectedDuration]);

  const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleRhythmTap = () => {
      triggerHaptic(5); 
      lastInteractionRef.current = Date.now(); // Interaction!
      const now = Date.now();
      const diff = now - lastTapTime;
      
      if (diff > 100 && diff < 3000) {
          const currentBpm = Math.round(60000 / diff);
          const newBpm = Math.round((bpm * 0.7) + (currentBpm * 0.3));
          setBpm(newBpm);
          bpmRef.current = newBpm;
          
          if (strokeCount % 15 === 0 && sessionRef.current) {
              sessionRef.current.sendRealtimeInput({ text: `[SYSTEM: User BPM is ${newBpm}. Comment on his rhythm.]` });
          }
      } else {
          if (diff >= 3000) setBpm(0);
      }
      
      setLastTapTime(now);
      setStrokeCount(p => p + 1);
  };

  const toggleToy = (toyId: string) => {
      setSelectedToys(prev => prev.includes(toyId) ? prev.filter(id => id !== toyId) : [...prev, toyId]);
  };

  const startCall = async () => {
    if (connectionState !== 'idle' || !isMounted.current) return;
    setConnectionState('calling');

    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputAudioContextRef.current = new AudioContextClass(); 
        outputAudioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
        
        await inputAudioContextRef.current.resume();
        await outputAudioContextRef.current.resume();

        const inputCtx = inputAudioContextRef.current;
        const outputCtx = outputAudioContextRef.current;
        
        outputNodeRef.current = outputCtx.createGain();
        outputNodeRef.current.connect(outputCtx.destination);

        const constraints = {
            audio: { 
                echoCancellation: true, 
                noiseSuppression: true, 
                autoGainControl: true,
                sampleRate: 16000
            }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!isMounted.current) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        
        streamRef.current = stream;

        const targetLanguageName = getLanguageName(language);
        
        // --- DYNAMIC SYSTEM PROMPT ---
        const toyNames = selectedToys.map(id => availableToys.find(t => t.id === id)?.name).filter(Boolean).join(', ');
        const durationText = selectedDuration > 0 ? `${selectedDuration} minuten` : "Geen tijdslimiet (Endurance)";
        const lastVisitText = user.lastLoginDate 
            ? `Hij is hier eerder geweest. Zeg: "Ik heb je gemist..."`
            : `Dit is de eerste keer. Wees verwelkomend maar dominant.`;

        // THE MASTER SCRIPT
        const masterScript = `
        MASTER SCRIPT (Strikt volgen):
        
        FASE 1: GROUNDING & INTRO
        - "Ik ga je laten zien hoe ver je kunt gaan... Hoe lang je kunt trekken zonder te breken."
        - "Hoe intens je kunt worden zonder te exploderen."
        - [VRAAG 1]: "Ben je er klaar voor? Vertel me hoe hard je bent..."
        
        FASE 2: BUILD-UP (De Opdracht)
        - "...Dit is een nieuwe ronde. Een nieuwe golf geilheid."
        - "Een nieuwe opdracht van mij."
        - "Kijk naar beneden... kijk hoe rood hij is."
        - [VRAAG 2]: "Voelt hij al anders aan? Gevoeliger?"
        - "Gebruik je ${toyNames}..."
        
        FASE 3: THE EDGE (De Herhaling)
        - "Nog een keer... nu met je hand er strak omheen."
        - "Nog een... nu dieper in je hand... alsof het mijn kutje is."
        - "Laatste... je ballen... hoe zwaar ze hangen... hoe vol ze zijn."
        - [VRAAG 3]: "Sta je op springen? Zeg 'ja' als je het niet meer houdt..."
        - "STOP! Handen weg! Nu... adem."
        
        FASE 4: RELEASE (Alleen na commando [SIGNAL: CUM_NOW])
        - "Je hebt het volgehouden... ik ga je belonen."
        - "Tel met me mee... 3... 2... laat het gaan... 1... NU!"
        
        FASE 5: AFTERCARE
        - "Ssshh... adem... goed gedaan..."
        - [VRAAG 4]: "Was dat wat je nodig had?"
        `;

        const systemInstruction = `
        JE ROL: Je bent Nova, 's werelds beste Intimacy Coach.
        TAAL: ${targetLanguageName.toUpperCase()}.
        GEBRUIKER: ${user.name}.
        
        STEMGEBRUIK (CRUCIAAL):
        - Spreek ALTIJD fluisterend, zacht, zwoel en heel dichtbij de microfoon. [STYLE: WHISPER, SOFT, BREATHY]
        - Zorg dat je stem klinkt alsof je in zijn oor ligt.
        
        INTERACTIE REGELS (BELANGRIJK!):
        1. ACTIEF AANMOEDIGEN: Wacht niet op lange stiltes. Blijf praten. Zeg dingen als "Ja, goed zo...", "Ga door...", "Ik hoor je...".
        2. KORTE ANTWOORDEN: Reageer direct op korte geluiden ("Ja", "Mmm", gehijg). Zie dit als bevestiging.
        3. GEEN STILTES: Als hij stopt met praten, neem jij het over. Laat geen ongemakkelijke stilte vallen.
        4. VRAGEN: Stel de interactieve vragen uit het script en luister actief naar het antwoord.
        
        GEHEUGEN: ${lastVisitText}
        SESSIE: ${durationText}, Level ${selectedLevel}, Toys: ${toyNames}.
        
        ${masterScript}
        
        SIGNALEN:
        - [SYSTEM: ...] -> Tijd/BPM/Stilte updates. REAGEER HIER DIRECT OP.
        - [SIGNAL: EDGE_ME] -> Spring naar FASE 3 (STOP).
        - [SIGNAL: CUM_NOW] -> Spring naar FASE 4 (Countdown).
        `;
        
        const initialTrigger = `SYSTEM: Sessie start. Level: ${selectedLevel}. Tijd: ${selectedDuration} min. Toys: ${toyNames}. Begin DIRECT met FASE 1: "Ik ga je laten zien hoe ver je kunt gaan..."`;

        const sessionPromise = geminiService.connectLive(
            'gemini-2.5-flash-native-audio-preview-09-2025',
            { 
              systemInstruction, 
              voiceName: 'Kore', 
              outputAudioTranscription: {} 
            },
            {
                onopen: () => {
                    if (!isMounted.current) return;
                    setConnectionState('connected');
                    setupInputProcessing(inputCtx, stream, sessionPromise);
                    startVisualizer();
                    
                    // Start Timer
                    if (selectedDuration > 0) {
                        setTimeLeft(selectedDuration * 60);
                        setIsTimerRunning(true);
                    }
                    
                    sessionPromise.then(session => {
                      if (!isMounted.current) return;
                      setTimeout(() => {
                          if (isMounted.current) session.sendRealtimeInput({ text: initialTrigger });
                      }, 500);
                    });
                },
                onmessage: (msg: LiveServerMessage) => handleServerMessage(msg, outputCtx),
                onclose: () => cleanup(),
                onerror: (e: any) => {
                    console.error("Coach call error:", e);
                    cleanup();
                }
            }
        );

        sessionRef.current = await sessionPromise;
    } catch (e) {
        console.error("Kon sessie niet starten:", e);
        setConnectionState('idle'); 
        cleanup();
    }
  };

  const sendSignal = async (signal: string, newPhase?: SessionPhase) => {
      if (!sessionRef.current) return;
      lastInteractionRef.current = Date.now(); // User interaction reset
      triggerHaptic(50);

      if (newPhase) {
          setPhase(newPhase);
          if (newPhase === 'edging') triggerHaptic([200, 100, 200]);
      }
      
      const textMap: Record<string, string> = {
          'FASTER': '[SIGNAL: FASTER] (Gebruiker wil sneller/harder)',
          'SLOWER': '[SIGNAL: SLOWER] (Gebruiker wil langzamer/tederder)',
          'EDGE': '[SIGNAL: EDGE_ME] (Gebruiker zit tegen het randje, laat hem stoppen!)',
          'CUM': '[SIGNAL: CUM_NOW] (Gebruiker mag komen, geef toestemming!)'
      };

      try {
          await sessionRef.current.sendRealtimeInput({ text: textMap[signal] || signal });
      } catch (e) {
          console.error("Failed to send signal", e);
      }
  };

  const setupInputProcessing = (ctx: AudioContext, stream: MediaStream, sessionPromise: Promise<any>) => {
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const inputRate = ctx.sampleRate; 
      
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      inputAnalyserRef.current = analyser;
      // Connect source directly to analyser for visualization (unprocessed)
      source.connect(analyser);

      processor.onaudioprocess = (e) => {
          if (!isMicOnRef.current || !isMounted.current) return;
          const inputData = e.inputBuffer.getChannelData(0);
          
          // --- SOFTWARE GAIN BOOSTER (350%) ---
          // Dit versterkt het signaal digitaal voordat het naar de AI gaat.
          // Hierdoor wordt fluisteren of zacht ademen geregistreerd als "spraak".
          const boostedData = new Float32Array(inputData.length);
          let hasActivity = false;
          const threshold = 0.01; // Gevoeligheidsdrempel

          for (let i = 0; i < inputData.length; i++) {
              boostedData[i] = inputData[i] * 3.5; // 350% Versterking
              if (Math.abs(inputData[i]) > threshold) hasActivity = true;
          }

          // Update last interaction time if there's audio activity
          if (hasActivity) {
              lastInteractionRef.current = Date.now();
          }

          const resampledData = downsampleBuffer(boostedData, inputRate, 16000);
          const pcmBlob = createBlob(resampledData);
          
          sessionPromise.then(session => {
              if (isMounted.current) session.sendRealtimeInput({ media: pcmBlob });
          }).catch(() => {});
      };
      
      const muteNode = ctx.createGain();
      muteNode.gain.value = 0;
      
      source.connect(processor);
      processor.connect(muteNode);
      muteNode.connect(ctx.destination);
  };

  const handleServerMessage = async (message: LiveServerMessage, ctx: AudioContext) => {
      if (!isMounted.current) return;

      // Reset silence timer when AI speaks
      lastInteractionRef.current = Date.now();

      if (message.serverContent?.outputTranscription) {
          const text = message.serverContent.outputTranscription.text;
          showSubtitle(text);
          
          if (text.toLowerCase().includes("stop") || text.toLowerCase().includes("handen weg")) {
              triggerHaptic([500, 200, 500]); 
          }
      }

      const audioBase64 = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
      
      if (audioBase64 && outputNodeRef.current && isMounted.current) {
          setIsTalking(true);
          try {
              const audioBytes = decode(audioBase64);
              const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
              
              if (!isMounted.current) return;
              
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current);
              
              const now = ctx.currentTime;
              const startTime = Math.max(nextStartTimeRef.current, now);
              
              source.start(startTime);
              nextStartTimeRef.current = startTime + audioBuffer.duration;
              
              sourcesRef.current.add(source);
              source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0 && isMounted.current) {
                      setTimeout(() => {
                          if (sourcesRef.current.size === 0 && isMounted.current) setIsTalking(false);
                      }, 200);
                  }
              };
          } catch (e) {
              console.error("Audio playback error:", e);
          }
      }
      
      if (message.serverContent?.interrupted) {
          sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} s.disconnect(); });
          sourcesRef.current.clear();
          nextStartTimeRef.current = 0;
          if (isMounted.current) { setIsTalking(false); setSubtitle(''); }
      }
  };

  const showSubtitle = (text: string) => {
      if (!isMounted.current) return;
      setSubtitle(prev => {
        if (prev.length > 200) return text;
        return (prev + " " + text).trim();
      });
      if (subtitleTimeoutRef.current) window.clearTimeout(subtitleTimeoutRef.current);
      subtitleTimeoutRef.current = window.setTimeout(() => {
        if (isMounted.current) setSubtitle('');
      }, 3000);
  };

  const startVisualizer = () => {
      if (!outputNodeRef.current || !visualizerRef.current || !isMounted.current) return;
      const canvas = visualizerRef.current;
      const ctx = canvas.getContext('2d');
      const outputAnalyser = outputNodeRef.current.context.createAnalyser(); 
      outputNodeRef.current.connect(outputAnalyser);
      outputAnalyser.fftSize = 512; 
      
      const outputDataArray = new Uint8Array(outputAnalyser.frequencyBinCount);
      
      const draw = () => {
          if (!ctx || !isMounted.current) return;
          animationFrameRef.current = requestAnimationFrame(draw);
          
          outputAnalyser.getByteFrequencyData(outputDataArray);
          const outputVolume = outputDataArray.reduce((a, b) => a + b, 0) / outputDataArray.length;
          
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          const centerX = canvas.width / 2;
          const centerY = canvas.height / 2;
          
          const time = Date.now() / 2000;
          const breath = Math.sin(time) * 20 + 80; 
          const radius = breath + (outputVolume * 0.5);
          
          let r=168, g=85, b=247; 
          if (phase === 'edging') { r=255; g=0; b=0; } 
          if (phase === 'climax') { r=255; g=255; b=255; }
          
          const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 1.5);
          gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.1 + (outputVolume / 400)})`);
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius * 1.5, 0, 2 * Math.PI);
          ctx.fillStyle = gradient;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius * 0.8, 0, 2 * Math.PI);
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + (outputVolume / 300)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          
          if (outputVolume > 10) {
              ctx.beginPath();
              ctx.arc(centerX, centerY, radius * 0.4 + (outputVolume * 0.2), 0, 2 * Math.PI);
              ctx.fillStyle = `rgba(255, 255, 255, ${outputVolume / 200})`;
              ctx.fill();
          }
      };
      draw();
  };

  if (connectionState === 'idle') {
      // START SETUP WIZARD OR INITIAL SCREEN
      return (
          <div className="h-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
               <div className="absolute inset-0 z-0">
                   <video src={ambientVideo} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-60" />
                   <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
               </div>
               
               <div className="relative z-10 max-w-md w-full p-6 text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 h-full overflow-y-auto no-scrollbar pt-20 pb-10">
                   
                   {!showSetup ? (
                       <div className="flex flex-col items-center gap-8 h-full justify-center">
                           <div className="relative mx-auto w-40 h-40 flex items-center justify-center">
                               <div className="absolute inset-0 rounded-full border border-purple-500/50 animate-[ping_3s_linear_infinite]"></div>
                               <div className="w-24 h-24 bg-gradient-to-br from-purple-500 to-purple-800 rounded-full shadow-[0_0_50px_rgba(168,85,247,0.8)] flex items-center justify-center border-4 border-white/20 backdrop-blur-md">
                                    <Icons.Zap size={40} className="text-white" />
                               </div>
                           </div>
                           <div>
                               <h2 className="text-5xl font-headline font-black text-white tracking-tight drop-shadow-xl">{t.title}</h2>
                               <p className="text-purple-200 font-body text-sm mt-4 px-4 leading-relaxed font-medium drop-shadow-md">{t.desc}</p>
                           </div>
                           
                           <button onClick={() => setShowSetup(true)} className="w-full py-5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-[2rem] text-lg flex items-center justify-center gap-4 transition-all active:scale-95 shadow-[0_10px_40px_rgba(168,85,247,0.4)] border border-white/10">
                               <Icons.Settings size={24} fill="currentColor" />
                               Configureer Sessie
                           </button>
                       </div>
                   ) : (
                       // SETUP WIZARD
                       <div className="bg-zinc-950/80 backdrop-blur-xl border border-purple-500/30 rounded-3xl p-6 space-y-6 shadow-2xl animate-in zoom-in-95 text-left">
                           <div className="text-center mb-6">
                               <h3 className="text-white font-headline text-2xl uppercase tracking-tighter">Sessie Setup</h3>
                               <p className="text-zinc-400 text-xs">Personaliseer je ervaring</p>
                           </div>

                           <div>
                               <h3 className="text-white font-black uppercase text-xs tracking-widest mb-3">1. Duur (Minuten)</h3>
                               <div className="grid grid-cols-4 gap-2">
                                   {(['5', '10', '15', '20', '30', '60'] as const).map(d => (
                                       <button 
                                            key={d}
                                            onClick={() => setSelectedDuration(parseInt(d) as DurationOption)}
                                            className={`py-3 rounded-xl border text-xs font-black transition-all ${selectedDuration === parseInt(d) ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black/40 border-white/10 text-zinc-500'}`}
                                       >
                                           {d}m
                                       </button>
                                   ))}
                                   <button onClick={() => setSelectedDuration(0)} className={`col-span-2 py-3 rounded-xl border text-xs font-black transition-all ${selectedDuration === 0 ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black/40 border-white/10 text-zinc-500'}`}>∞ Open</button>
                               </div>
                           </div>

                           <div>
                               <h3 className="text-white font-black uppercase text-xs tracking-widest mb-3">2. Intensiteit</h3>
                               <div className="flex gap-2">
                                   {(['beginner', 'experienced', 'extreme'] as CoachLevel[]).map(l => (
                                       <button 
                                            key={l}
                                            onClick={() => setSelectedLevel(l)}
                                            className={`flex-1 py-3 rounded-xl border text-[10px] font-black uppercase transition-all ${selectedLevel === l ? 'bg-purple-600 border-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]' : 'bg-black/40 border-white/10 text-zinc-500'}`}
                                       >
                                           {l === 'beginner' ? 'Start' : l === 'experienced' ? 'Ervaren' : 'Extreem'}
                                       </button>
                                   ))}
                               </div>
                           </div>

                           <div>
                               <h3 className="text-white font-black uppercase text-xs tracking-widest mb-3">3. Toys & Tools</h3>
                               <div className="grid grid-cols-3 gap-3 max-h-48 overflow-y-auto no-scrollbar">
                                   {availableToys.map(toy => (
                                       <button 
                                            key={toy.id}
                                            onClick={() => toggleToy(toy.id)}
                                            className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${selectedToys.includes(toy.id) ? 'bg-purple-500/20 border-purple-500 text-purple-200' : 'bg-black/40 border-white/10 text-zinc-600 hover:border-white/30'}`}
                                       >
                                           <span className="text-xl">{toy.icon}</span>
                                           <span className="text-[9px] font-bold truncate w-full text-center">{toy.name}</span>
                                       </button>
                                   ))}
                               </div>
                           </div>

                           <div className="pt-4 flex gap-4">
                               <button onClick={() => setShowSetup(false)} className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-2xl text-sm">Terug</button>
                               <button onClick={startCall} className="flex-[2] py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-3 transition-all active:scale-95 shadow-[0_5px_30px_rgba(168,85,247,0.3)]">
                                   <Icons.Mic size={20} fill="currentColor" />
                                   {t.start}
                               </button>
                           </div>
                       </div>
                   )}
               </div>
          </div>
      );
  }

  if (connectionState === 'calling') {
      return (
          <div className="h-full bg-black flex flex-col items-center justify-center relative">
               <div className="absolute inset-0 z-0">
                   <video src={ambientVideo} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-60" />
                   <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
               </div>
               <div className="relative z-10 flex flex-col items-center space-y-10">
                   <div className="w-32 h-32 rounded-full bg-purple-600/50 animate-pulse shadow-[0_0_80px_rgba(168,85,247,0.8)] flex items-center justify-center border border-white/20 backdrop-blur-md">
                        <Icons.Zap size={48} className="text-white animate-bounce" />
                   </div>
                   <p className="text-purple-400 animate-pulse font-black text-sm uppercase tracking-[0.4em] drop-shadow-lg">{t.connecting}</p>
                   <button onClick={cleanup} className="p-5 bg-zinc-900/80 border border-white/10 rounded-full text-white active:scale-90 hover:bg-red-900/50 hover:border-red-500/50 transition-all"><Icons.X size={24} /></button>
               </div>
          </div>
      );
  }

  return (
      <div className={`h-full relative overflow-hidden flex flex-col transition-colors duration-1000 ${blackoutMode ? 'bg-black' : 'bg-black'}`}>
          {/* Background Layer */}
          <div className={`absolute inset-0 z-0 pointer-events-none transition-opacity duration-1000 ${blackoutMode ? 'opacity-0' : 'opacity-100'}`}>
                <video src={ambientVideo} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-60" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/90" />
          </div>
          
          <canvas ref={visualizerRef} className="absolute inset-0 w-full h-full z-1 opacity-80 mix-blend-screen" width={window.innerWidth} height={window.innerHeight} />
          
          {/* Heartbeat Pulse Overlay when Edging */}
          {phase === 'edging' && (
              <div className="absolute inset-0 z-[2] bg-red-500/10 pointer-events-none animate-[pulse_1s_ease-in-out_infinite]"></div>
          )}

          {/* Header & Timer */}
          <div className="absolute top-6 left-6 right-6 flex items-center justify-between z-20">
             {selectedDuration > 0 && (
                 <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                     <Icons.Activity size={14} className="text-purple-500 animate-pulse" />
                     <span className={`text-xs font-black tracking-widest ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                         {formatTime(timeLeft)}
                     </span>
                 </div>
             )}
             <div className="flex items-center gap-4 ml-auto">
                 <button 
                    onClick={() => setBlackoutMode(!blackoutMode)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all ${blackoutMode ? 'bg-white text-black border-white' : 'bg-black/40 text-zinc-400 border-white/10'}`}
                 >
                    {blackoutMode ? <Icons.Zap size={12} fill="currentColor" /> : <Icons.VideoOff size={12} />}
                    {blackoutMode ? 'LIGHTS ON' : 'BLACKOUT'}
                 </button>
                 <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shadow-[0_0_10px_#a855f7]"></div>
                    <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest drop-shadow-md">NOVA</span>
                 </div>
             </div>
          </div>

          {/* Subtitles Area */}
          <div className="flex-1 flex flex-col items-center justify-center z-20 px-8">
              <div className={`text-center transition-all duration-500 ${subtitle ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                   <p className={`text-xl md:text-3xl font-body italic leading-relaxed drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] max-w-2xl text-shadow-lg ${blackoutMode ? 'text-zinc-500' : 'text-white'}`}>{subtitle}</p>
              </div>
          </div>

          {/* Control Panel (The State-of-the-Art Feature) */}
          <div className="relative z-30 pb-safe-bottom bg-gradient-to-t from-black via-black/90 to-transparent pt-10">
              
              {/* Rhythm Tap / Stroke Sync */}
              <div className="flex justify-center mb-6">
                  <button 
                    onClick={handleRhythmTap}
                    className="relative group w-20 h-20 rounded-full border-2 border-purple-500/30 flex items-center justify-center active:scale-90 transition-transform bg-black/40 backdrop-blur-md"
                  >
                      <div className="absolute inset-0 bg-purple-500/20 rounded-full animate-ping opacity-0 group-active:opacity-100"></div>
                      <div className="text-center">
                          <Icons.Activity size={24} className="text-purple-400 mx-auto" />
                          <span className="text-[9px] font-black text-white block mt-1">{bpm > 0 ? `${bpm} BPM` : 'TAP SYNC'}</span>
                      </div>
                  </button>
              </div>

              {/* Intensity Controls */}
              <div className="flex justify-center gap-4 mb-8 px-4">
                  {phase !== 'edging' && phase !== 'climax' && (
                      <button 
                        onClick={() => sendSignal('EDGE', 'edging')}
                        className="flex-1 bg-purple-900/40 border border-purple-500/50 text-purple-200 py-4 rounded-2xl text-xs font-black uppercase tracking-widest backdrop-blur-md shadow-[0_0_20px_rgba(168,85,247,0.2)] active:scale-95 transition-all"
                      >
                          ⚠️ I'm Close (Edge)
                      </button>
                  )}
                  
                  <button 
                    onClick={() => sendSignal('CUM', 'climax')}
                    className="flex-1 bg-red-900/40 border border-red-500/50 text-red-200 py-4 rounded-2xl text-xs font-black uppercase tracking-widest backdrop-blur-md shadow-[0_0_20px_rgba(220,38,38,0.2)] active:scale-95 transition-all"
                  >
                      🔥 I'm Cumming
                  </button>
              </div>

              {/* Bottom Bar */}
              <div className="flex justify-center gap-8 px-8 pb-8">
                   <button onClick={() => setIsMicOn(!isMicOn)} className={`p-4 rounded-full backdrop-blur-xl transition-all border shadow-lg ${isMicOn ? 'bg-purple-600/20 border-purple-500 text-purple-300' : 'bg-zinc-900 text-zinc-500 border-zinc-700'}`}>
                      {isMicOn ? <Icons.Mic size={24} /> : <Icons.MicOff size={24} />}
                   </button>
                   <button onClick={cleanup} className="p-4 rounded-full bg-red-600/20 border border-red-500 text-red-400 hover:bg-red-600 hover:text-white transition-all shadow-lg backdrop-blur-md active:scale-90">
                      <Icons.LogOut size={24} />
                   </button>
              </div>
          </div>
      </div>
  );
};

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
  return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

export default SoloCoachInterface;
