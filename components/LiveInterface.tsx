
import { geminiService } from '../services/geminiService';
import { LiveServerMessage, Blob, Modality } from '@google/genai';
import { getCharacters, getLanguageName, getTexts } from '../constants';
import Icons from './Icon';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ModelConfig, Language, UserProfile } from '../types';

interface LiveInterfaceProps {
  config: ModelConfig;
  isActive: boolean;
  language: Language;
  onConsumeCredit: (amount: number) => boolean; // Added onConsumeCredit
  user: UserProfile; // Added user
}

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

const LiveInterface: React.FC<LiveInterfaceProps> = ({ config, isActive, language, onConsumeCredit, user }) => {
  const characters = getCharacters(language).filter(c => !c.isDoll);
  const [connectionState, setConnectionState] = useState<'idle' | 'calling' | 'connected'>('idle');
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(characters[0]);
  const [isTalking, setIsTalking] = useState(false);
  const [subtitle, setSubtitle] = useState<string>('');
  const subtitleTimeoutRef = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerRef = useRef<HTMLCanvasElement>(null);
  const bgVisualizerRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const outputNodeRef = useRef<GainNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const isMicOnRef = useRef(isMicOn);
  const isMounted = useRef(true);
  
  // Credit deduction interval
  const creditIntervalRef = useRef<any>(null);

  const t = getTexts(language).live;

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
    if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
    }
    
    // Clear Credit Interval
    if (creditIntervalRef.current) {
        clearInterval(creditIntervalRef.current);
        creditIntervalRef.current = null;
    }
    
    sourcesRef.current.forEach(s => {
        try { s.stop(); } catch(e) {}
        s.disconnect();
    });
    sourcesRef.current.clear();
    
    if (isMounted.current) {
      setConnectionState('idle');
      setIsTalking(false);
      setSubtitle('');
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

  // Credit Deduction Logic
  useEffect(() => {
      if (connectionState === 'connected' && !user.isPremium) {
          console.log("Starting credit deduction timer for live call");
          creditIntervalRef.current = setInterval(() => {
              // Deduct 20 credits every minute
              console.log("Deducting 20 credits for live minute...");
              const success = onConsumeCredit(20);
              if (!success) {
                  console.log("Insufficient credits, ending call.");
                  cleanup(); // End call if credits run out
                  // The parent onConsumeCredit will trigger the paywall modal
              }
          }, 60000); // 60 seconds
      } else {
          if (creditIntervalRef.current) {
              clearInterval(creditIntervalRef.current);
              creditIntervalRef.current = null;
          }
      }
      return () => {
          if (creditIntervalRef.current) clearInterval(creditIntervalRef.current);
      };
  }, [connectionState, user.isPremium, onConsumeCredit, cleanup]);


  const startCall = async () => {
    if (connectionState !== 'idle' || !isMounted.current) return;
    
    // Initial Credit Check for Non-VIP
    if (!user.isPremium) {
        if (!onConsumeCredit(20)) return; // Upfront cost for first minute
    }

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
            },
            video: isCameraOn ? { width: { ideal: 480 }, height: { ideal: 640 }, facingMode: 'user' } : false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!isMounted.current) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        
        streamRef.current = stream;

        if (videoRef.current && isCameraOn) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(console.error);
        }

        const targetLanguageName = getLanguageName(language);
        const charName = selectedCharacter.name;
        
        const systemInstruction = `
        JE ROL: Je bent ${charName}. Een echte vrouw in een privé videogesprek.
        CONTEXT: Je zit in een live videogesprek met een man. Je kunt hem horen en (soms) zien.
        TAAL: Spreek ALLEEN in het ${targetLanguageName.toUpperCase()}. Gebruik spreektaal, wees natuurlijk.
        STEM: ${selectedCharacter.voiceStyle || 'verleidelijk'}.
        
        HET DOEL: EEN ECHT GESPREK VOEREN MET OPBOUW.
        Dit is GEEN monoloog. Dit is een ping-pong interactie.
        
        INSTRUCTIES VOOR INTERACTIE (CRUCIAAL):
        1. HOU HET KORT: Geef antwoorden van 1 tot maximaal 3 zinnen.
        2. STEL VRAGEN: Eindig je beurt vaak met een vraag om hem te laten praten. ("Ben je daar?", "Wat heb je aan?", "Vind je dat lekker?")
        3. LUISTER: Reageer direct op wat hij zegt. 
        
        DE OPBOUW (FASE-STRUCTUUR):
        - FASE 1 (START): Wees warm, flirterig en nieuwsgierig. Begroet hem met "Hey...", "Daar ben je eindelijk...".
        - FASE 2 (SPANNING): Als het gesprek loopt, word plagerig. Geef complimentjes.
        - FASE 3 (ACTIE): Pas als de spanning hoog is, word je explicieter.
        
        KARAKTER INFO:
        ${selectedCharacter.desc}
        ${selectedCharacter.personality}
        `;
        
        const initialTrigger = `SYSTEM: De verbinding is open. Zeg kort "Hey..." of "Hallo..." op een zwoele manier en wacht op antwoord.`;

        const sessionPromise = geminiService.connectLive(
            'gemini-2.5-flash-native-audio-preview-09-2025',
            { 
              ...config, 
              systemInstruction, 
              voiceName: selectedCharacter.voice || 'Kore',
              outputAudioTranscription: {} 
            },
            {
                onopen: () => {
                    if (!isMounted.current) return;
                    setConnectionState('connected');
                    setupInputProcessing(inputCtx, stream, sessionPromise);
                    if (isCameraOn) startVideoStreaming(sessionPromise);
                    startVisualizers();
                    
                    // Stuur de initiële trigger
                    sessionPromise.then(session => {
                      if (!isMounted.current) return;
                      // Korte vertraging om zeker te zijn dat audio stream loopt
                      setTimeout(() => {
                          if (isMounted.current) session.sendRealtimeInput({ text: initialTrigger });
                      }, 500);
                    });
                },
                onmessage: (msg: LiveServerMessage) => handleServerMessage(msg, outputCtx),
                onclose: () => cleanup(),
                onerror: (e: any) => {
                    console.error("Live call error:", e);
                    cleanup();
                }
            }
        );

        sessionRef.current = await sessionPromise;
    } catch (e) {
        console.error("Kon gesprek niet starten:", e);
        setConnectionState('idle'); 
        cleanup();
    }
  };

  const setupInputProcessing = (ctx: AudioContext, stream: MediaStream, sessionPromise: Promise<any>) => {
      const source = ctx.createMediaStreamSource(stream);
      // Gebruik buffer size 4096 voor goede balans latency/performance
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const inputRate = ctx.sampleRate; 
      
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      inputAnalyserRef.current = analyser;
      source.connect(analyser);

      processor.onaudioprocess = (e) => {
          if (!isMicOnRef.current || !isMounted.current) return;
          
          const inputData = e.inputBuffer.getChannelData(0);
          
          // CRUCIAAL: GEEN lokale stilte-detectie (RMS check) meer.
          // We sturen ALTIJD audio zodat de server-side VAD (Voice Activity Detection)
          // correct kan bepalen wanneer de gebruiker stopt met praten.
          // Het onderbreken van de stream zorgt ervoor dat de AI "denkt" dat de verbinding weg is of wacht.
          
          const resampledData = downsampleBuffer(inputData, inputRate, 16000);
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

  const startVideoStreaming = (sessionPromise: Promise<any>) => {
      frameIntervalRef.current = window.setInterval(() => {
          if (!canvasRef.current || !videoRef.current || !isMounted.current) return;
          const ctx = canvasRef.current.getContext('2d');
          if (!ctx) return;
          canvasRef.current.width = videoRef.current.videoWidth / 5;
          canvasRef.current.height = videoRef.current.videoHeight / 5;
          ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
          const base64 = canvasRef.current.toDataURL('image/jpeg', 0.4).split(',')[1];
          sessionPromise.then(s => {
            if (isMounted.current) s.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 }});
          }).catch(() => {});
      }, 1000);
  };

  const handleServerMessage = async (message: LiveServerMessage, ctx: AudioContext) => {
      if (!isMounted.current) return;

      if (message.serverContent?.outputTranscription) {
          showSubtitle(message.serverContent.outputTranscription.text);
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
          sourcesRef.current.forEach(s => {
              try { s.stop(); } catch(e) {}
              s.disconnect();
          });
          sourcesRef.current.clear();
          nextStartTimeRef.current = 0;
          if (isMounted.current) {
            setIsTalking(false);
            setSubtitle('');
          }
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

  const startVisualizers = () => {
      if (!outputNodeRef.current || !visualizerRef.current || !bgVisualizerRef.current || !isMounted.current) return;
      
      const canvas = visualizerRef.current;
      const ctx = canvas.getContext('2d');
      const bgCanvas = bgVisualizerRef.current;
      const bgCtx = bgCanvas.getContext('2d');
      
      const outputAnalyser = outputNodeRef.current.context.createAnalyser(); 
      outputNodeRef.current.connect(outputAnalyser);
      outputAnalyser.fftSize = 256; 
      
      const outputDataArray = new Uint8Array(outputAnalyser.frequencyBinCount);
      const inputDataArray = new Uint8Array(inputAnalyserRef.current ? inputAnalyserRef.current.frequencyBinCount : 0);
      
      let particles: any[] = [];
      const createParticles = () => {
          particles = [];
          for(let i = 0; i < 35; i++) {
              particles.push({
                  x: Math.random() * bgCanvas.width,
                  y: Math.random() * bgCanvas.height,
                  size: Math.random() * 2 + 1,
                  speedX: Math.random() * 0.4 - 0.2,
                  speedY: Math.random() * 0.4 - 0.2,
                  opacity: Math.random() * 0.4 + 0.1
              });
          }
      };
      
      const draw = () => {
          if (!ctx || !bgCtx || !isActive || !isMounted.current) return;
          animationFrameRef.current = requestAnimationFrame(draw);
          
          outputAnalyser.getByteFrequencyData(outputDataArray);
          if (inputAnalyserRef.current) inputAnalyserRef.current.getByteFrequencyData(inputDataArray);
          
          const outputVolume = outputDataArray.reduce((a, b) => a + b, 0) / outputDataArray.length;
          const inputVolume = inputDataArray.reduce((a, b) => a + b, 0) / inputDataArray.length;
          const totalVolume = Math.max(outputVolume, inputVolume);
          
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const barWidth = (canvas.width / outputDataArray.length) * 2;
          let x = 0;
          for(let i = 0; i < outputDataArray.length; i++) {
              const barHeight = outputDataArray[i] / 5;
              ctx.fillStyle = `rgba(255, 215, 0, ${barHeight / 100})`;
              ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
              x += barWidth + 1;
          }

          bgCanvas.width = window.innerWidth;
          bgCanvas.height = window.innerHeight;
          if (particles.length === 0) createParticles();
          
          bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
          
          const centerX = bgCanvas.width / 2;
          const centerY = bgCanvas.height / 2;
          const baseRadius = Math.min(bgCanvas.width, bgCanvas.height) * 0.25;
          const pulseRadius = baseRadius + (totalVolume * 1.5);
          
          const gradient = bgCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, pulseRadius);
          gradient.addColorStop(0, `rgba(255, 215, 0, ${totalVolume / 255 * 0.12})`);
          gradient.addColorStop(0.6, `rgba(181, 154, 91, ${totalVolume / 255 * 0.04})`);
          gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
          
          bgCtx.fillStyle = gradient;
          bgCtx.beginPath();
          bgCtx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
          bgCtx.fill();

          particles.forEach(p => {
              p.x += p.speedX + (totalVolume / 60 * (Math.random() - 0.5));
              p.y += p.speedY + (totalVolume / 60 * (Math.random() - 0.5));
              
              if (p.x < 0) p.x = bgCanvas.width;
              if (p.x > bgCanvas.width) p.x = 0;
              if (p.y < 0) p.y = bgCanvas.height;
              if (p.y > bgCanvas.height) p.y = 0;
              
              const pSize = p.size + (totalVolume / 50);
              bgCtx.fillStyle = `rgba(255, 215, 0, ${p.opacity + (totalVolume / 350)})`;
              bgCtx.beginPath();
              bgCtx.arc(p.x, p.y, pSize, 0, Math.PI * 2);
              bgCtx.fill();
          });
      };
      draw();
  };

  if (connectionState === 'idle') {
      return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center relative overflow-hidden">
               <div className="absolute inset-0 bg-black opacity-20 blur-xl scale-110"></div>
               <div className="relative z-10 max-w-md w-full p-6 text-center space-y-8 animate-in fade-in slide-in-from-bottom-8">
                   <div className="relative mx-auto w-44 h-44">
                       <div className="absolute inset-0 rounded-full border-2 border-dashed border-gold-500/30 animate-[spin_12s_linear_infinite]"></div>
                       <div className="w-full h-full rounded-full overflow-hidden border-4 border-gold-500 shadow-[0_0_50px_rgba(255,215,0,0.4)]">
                           <img src={selectedCharacter.avatar} alt={selectedCharacter.name} className="w-full h-full object-cover" />
                       </div>
                   </div>
                   <div>
                       <h2 className="text-4xl font-headline font-bold text-white tracking-tight">{selectedCharacter.name}</h2>
                       <p className="text-gold-500 uppercase tracking-[0.3em] text-[10px] mt-3 font-black">{t.vip_label}</p>
                   </div>
                   <div className="flex justify-center gap-2.5 py-4 flex-wrap max-w-xs mx-auto overflow-y-auto max-h-40 no-scrollbar">
                       {characters.map(char => (
                           <button key={char.id} onClick={() => setSelectedCharacter(char)} className={`w-11 h-11 rounded-full overflow-hidden border-2 transition-all ${selectedCharacter.id === char.id ? 'border-gold-500 scale-115 shadow-[0_0_15px_rgba(255,215,0,0.5)]' : 'border-white/10 opacity-40 hover:opacity-100'}`}>
                               <img src={char.avatar} className="w-full h-full object-cover" />
                           </button>
                       ))}
                   </div>
                   <button onClick={startCall} className="w-full py-5 btn-premium rounded-[2rem] text-lg flex items-center justify-center gap-4 transition-all active:scale-95 shadow-[0_10px_40px_rgba(255,215,0,0.3)]">
                       <div className="flex flex-col items-center">
                           <div className="flex items-center gap-2">
                               <Icons.Video size={24} fill="currentColor" />
                               <span>{t.start_call}</span>
                           </div>
                           {!user.isPremium && <span className="text-[9px] mt-1 font-bold opacity-80">(20 Credits / min)</span>}
                       </div>
                   </button>
                   <div className="flex justify-center gap-6 text-zinc-500">
                       <button onClick={() => setIsCameraOn(!isCameraOn)} className={`p-4 rounded-full border transition-all ${isCameraOn ? 'bg-white/10 border-gold-500 text-gold-500' : 'border-zinc-800 hover:border-zinc-600'}`}>{isCameraOn ? <Icons.Video size={20} /> : <Icons.VideoOff size={20} />}</button>
                       <button onClick={() => setIsMicOn(!isMicOn)} className={`p-4 rounded-full border transition-all ${isMicOn ? 'bg-white/10 border-gold-500 text-gold-500' : 'border-zinc-800 hover:border-zinc-600'}`}>{isMicOn ? <Icons.Mic size={20} /> : <Icons.MicOff size={20} />}</button>
                   </div>
               </div>
          </div>
      );
  }

  if (connectionState === 'calling') {
      return (
          <div className="h-full bg-black flex flex-col items-center justify-center relative">
               <div className="relative z-10 flex flex-col items-center space-y-10">
                   <div className="relative">
                       <div className="absolute inset-0 bg-gold-500 rounded-full animate-pulse opacity-20"></div>
                       <div className="w-40 h-40 rounded-full overflow-hidden border-4 border-gold-500 shadow-2xl relative z-10">
                           <img src={selectedCharacter.avatar} className="w-full h-full object-cover" />
                       </div>
                   </div>
                   <div className="text-center">
                       <h3 className="text-3xl font-headline font-bold text-white uppercase tracking-widest">{selectedCharacter.name}</h3>
                       <p className="text-gold-500/70 animate-pulse mt-4 font-black text-xs uppercase tracking-[0.4em]">{t.connecting}</p>
                   </div>
                   <button onClick={cleanup} className="p-5 bg-red-600 rounded-full text-white active:scale-90 shadow-xl"><Icons.PhoneOff size={36} fill="currentColor" /></button>
               </div>
          </div>
      );
  }

  return (
      <div className="h-full bg-black relative overflow-hidden">
          <canvas ref={bgVisualizerRef} className="absolute inset-0 z-0 pointer-events-none w-full h-full" />
          <div className="absolute inset-0 z-[1] pointer-events-none">
               {selectedCharacter.video && <video src={selectedCharacter.video} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-80 scale-105 mix-blend-screen" />}
               {!selectedCharacter.video && <img src={selectedCharacter.avatar} className="w-full h-full object-cover opacity-50 blur-sm scale-110" />}
               <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/95" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          {isCameraOn && <div className="absolute top-12 right-6 w-32 md:w-56 aspect-[3/4] bg-black rounded-3xl overflow-hidden border border-white/20 shadow-2xl z-20"><video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" /></div>}
          <div className="absolute bottom-48 left-0 right-0 px-8 text-center z-10 pointer-events-none pb-safe-bottom">
              <div className={`inline-block bg-black/70 backdrop-blur-2xl px-8 py-5 rounded-[2.5rem] text-lg md:text-2xl font-body italic text-gold-50 border border-gold-500/10 transition-all duration-500 shadow-2xl ${subtitle ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>{subtitle}</div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-8 z-20 bg-gradient-to-t from-black via-black/90 to-transparent pb-safe-bottom">
              <div className="max-w-4xl mx-auto flex items-center justify-between">
                  <div className="hidden md:block w-40 h-14 opacity-60"><canvas ref={visualizerRef} width={160} height={56} className="w-full h-full" /></div>
                  <div className="flex items-center gap-6 mx-auto md:mx-0">
                      <button onClick={() => setIsMicOn(!isMicOn)} className={`p-5 rounded-full backdrop-blur-xl transition-all border ${isMicOn ? 'bg-white/10 border-white/10 text-white' : 'bg-white text-black'}`}>{isMicOn ? <Icons.Mic size={28} /> : <Icons.MicOff size={28} />}</button>
                      <button onClick={cleanup} className="p-7 rounded-full bg-red-600 text-white shadow-[0_0_40px_rgba(220,38,38,0.4)] transform active:scale-90 transition-all"><Icons.PhoneOff size={40} fill="currentColor" /></button>
                      <button onClick={() => setIsCameraOn(!isCameraOn)} className={`p-4 rounded-full backdrop-blur-xl transition-all border ${isCameraOn ? 'bg-white/10 border-white/10 text-white' : 'bg-white text-black'}`}>{isCameraOn ? <Icons.Video size={28} /> : <Icons.VideoOff size={28} />}</button>
                  </div>
                  <div className="hidden md:flex flex-col items-end">
                      <div className="flex items-center gap-2 mb-1"><div className="w-2 h-2 rounded-full bg-gold-500 shadow-[0_0_10px_#FFD700] animate-pulse-gold"></div><span className="text-[10px] font-black text-gold-500 uppercase tracking-widest">LIVE</span></div>
                      <span className="text-zinc-500 font-bold text-[9px] uppercase tracking-tighter">{t.hd_conn}</span>
                  </div>
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

export default LiveInterface;
