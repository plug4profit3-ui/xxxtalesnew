
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Icons from './Icon';
import { AUDIO_STORY_TEMPLATES, DEFAULT_VIDEO, getCharacters } from '../constants';
import { geminiService } from '../services/geminiService';
// Fix: Added UserProfile to imports
import { VoiceStyle, UserProfile } from '../types';

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

// Fix: Added user prop to interface
interface AudioStoriesInterfaceProps {
  user: UserProfile;
}

const AudioStoriesInterface: React.FC<AudioStoriesInterfaceProps> = ({ user }) => {
  const [activeStory, setActiveStory] = useState<typeof AUDIO_STORY_TEMPLATES[0] | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isMounted = useRef(true);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      stopAudio();
    };
  }, []);

  // Determine global background video based on active story or random char
  const backgroundVideo = useMemo(() => {
      if (activeStory) {
          // Try to find a character that matches the voice to use their video
          const char = getCharacters('nl').find(c => c.voice === activeStory.voice || c.name.includes(activeStory.voice));
          if (char?.video) return char.video;
      }
      return DEFAULT_VIDEO;
  }, [activeStory]);

  const initAudio = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    return audioContextRef.current;
  }, []);

  const stopAudio = () => {
    stopRequestedRef.current = true;
    if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch(e) {}
        currentSourceRef.current = null;
    }
    setIsPlaying(false);
    setProgress(0);
  };

  const playChunk = async (text: string, voice: string, style: VoiceStyle) => {
    if (!isMounted.current || stopRequestedRef.current) return;
    try {
        const ctx = await initAudio();
        const audioData = await geminiService.generateSpeech(text, voice, style);
        if (!audioData || !isMounted.current || !ctx || stopRequestedRef.current) return;
        
        const binaryString = atob(audioData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        
        const audioBuffer = await decodeAudioData(bytes, ctx, 24000, 1);
        if (!isMounted.current || stopRequestedRef.current) return;
        
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        
        currentSourceRef.current = source;
        source.start(0);
        
        return new Promise<void>((resolve) => {
            source.onended = () => resolve();
        });
    } catch (e) {
        console.error("Audio Story chunk failed", e);
    }
  };

  const playStory = async (story: typeof AUDIO_STORY_TEMPLATES[0]) => {
    if (activeStory?.id === story.id && isPlaying) {
        stopAudio();
        return;
    }

    stopAudio();
    stopRequestedRef.current = false;
    setActiveStory(story);
    setIsLoading(true);

    try {
        const prompt = `Schrijf een zinderend, gedetailleerd en sfeervol erotisch verhaal over: ${story.desc}. Focus op alle zintuigen: geluid, geur, aanraking en de diepe emoties van passie. Maak het verhaal meeslepend en zorg voor een duidelijke opbouw naar een climax. Maximaal 800 woorden. Gebruik de stem van ${story.voice} in een ${story.style} stijl.`;
        // Fix: Added user argument as the 4th parameter
        const response = await geminiService.sendRoleplayMessage(prompt, { name: 'Verteller', desc: '', appearance: '', video: '', avatar: '', voice: story.voice } as any, { arousal: 0 } as any, user);
        
        if (!isMounted.current || stopRequestedRef.current) {
            setIsLoading(false);
            return;
        }

        setIsLoading(false);
        setIsPlaying(true);

        const text = response.text;
        const chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
        
        let processedChunks = 0;
        for (const chunk of chunks) {
            if (!isMounted.current || stopRequestedRef.current) break;
            
            const currentProgress = (processedChunks / chunks.length) * 100;
            setProgress(currentProgress);
            
            await playChunk(chunk.trim(), story.voice, story.style as VoiceStyle);
            processedChunks++;
        }
        
        if (isMounted.current && !stopRequestedRef.current) {
            setProgress(100);
            setTimeout(() => {
                if (isMounted.current) {
                    setIsPlaying(false);
                    setProgress(0);
                    setActiveStory(null);
                }
            }, 1000);
        }

    } catch (e) {
        console.error("Audio Story failed", e);
        if (isMounted.current) {
            setIsLoading(false);
            setIsPlaying(false);
        }
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-black p-4 md:p-10 no-scrollbar safe-pb h-full relative">
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <video src={backgroundVideo} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-100" />
            <div className="absolute inset-0 bg-black/30" />
        </div>

        <div className="max-w-4xl mx-auto space-y-10 pt-6 pb-24 relative z-10">
            <div className="text-center px-4 animate-in fade-in slide-in-from-top-4 duration-700">
                <h2 className="text-4xl md:text-6xl font-headline font-black text-shine uppercase tracking-tighter mb-1">Audio Verhalen</h2>
                <p className="text-gold-500 text-[11px] tracking-[0.5em] uppercase font-black drop-shadow-xl">Zinderende Passie Voor Je Oren</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 md:gap-8">
                {AUDIO_STORY_TEMPLATES.map(story => (
                    <div key={story.id} className={`group relative bg-zinc-900/60 rounded-[2.5rem] overflow-hidden border-2 transition-all duration-700 ${activeStory?.id === story.id ? 'border-gold-500 shadow-[0_0_50px_rgba(255,215,0,0.3)] scale-[1.02]' : 'border-white/5 hover:border-gold-500/20'}`}>
                        <div className="aspect-[16/10] relative overflow-hidden">
                            {/* Force video if image is static, or assume image is placeholder. Actually, let's keep the thumbnail but overlay play state. */}
                            {story.isVideo ? (
                                <video src={story.image} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-[2s]" />
                            ) : (
                                <img src={story.image} className="w-full h-full object-cover opacity-70 group-hover:scale-110 transition-transform duration-[2s]" alt={story.title} />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                            
                            <button 
                                onClick={() => playStory(story)}
                                className={`absolute inset-0 m-auto w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all duration-300 ${activeStory?.id === story.id && isPlaying ? 'bg-red-600 scale-110 shadow-[0_0_30px_rgba(220,38,38,0.5)]' : 'bg-gold-500 scale-100 shadow-[0_0_30px_rgba(255,215,0,0.4)]'} active:scale-90 z-20`}
                            >
                                {isLoading && activeStory?.id === story.id ? (
                                    <Icons.Loader2 className="text-black animate-spin" size={36} />
                                ) : activeStory?.id === story.id && isPlaying ? (
                                    <Icons.Pause className="text-white" size={36} fill="currentColor" />
                                ) : (
                                    <Icons.Play className="text-black ml-1" size={36} fill="currentColor" />
                                )}
                            </button>

                            <div className="absolute top-4 right-4 z-10">
                                <span className="bg-black/60 backdrop-blur-md text-gold-500 text-[9px] font-black px-3 py-1 rounded-full border border-gold-500/30 uppercase tracking-widest">{story.duration}</span>
                            </div>
                        </div>
                        
                        <div className="p-6 md:p-8">
                            <h3 className="text-white font-black uppercase text-base tracking-widest mb-3 group-hover:text-gold-500 transition-colors">{story.title}</h3>
                            <p className="text-zinc-400 text-xs leading-relaxed italic line-clamp-2 md:line-clamp-none mb-6">"{story.desc}"</p>
                            
                            {activeStory?.id === story.id && isPlaying && (
                                <div className="space-y-3 animate-in fade-in duration-500">
                                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden shadow-inner">
                                        <div className="h-full bg-gold-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,215,0,0.8)]" style={{ width: `${progress}%` }} />
                                    </div>
                                    <div className="flex justify-between items-center text-[8px] font-black text-gold-500 uppercase tracking-widest">
                                        <div className="flex items-center gap-2">
                                            <div className="flex gap-1 h-3 items-end">
                                                {[0, 1, 2, 3].map(i => (
                                                    <div key={i} className="w-1 bg-gold-500 animate-pulse" style={{ height: `${Math.random() * 8 + 4}px`, animationDelay: `${i * 150}ms` }} />
                                                ))}
                                            </div>
                                            <span>Verhaal wordt integraal voorgelezen...</span>
                                        </div>
                                        <span>{Math.round(progress)}%</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-12 p-8 glass-premium rounded-[3rem] border-gold-500/20 bg-zinc-950/40 text-center space-y-4 shadow-2xl relative overflow-hidden group animate-in slide-in-from-bottom-8 duration-700">
                <div className="absolute inset-0 bg-gradient-to-r from-gold-500/5 via-transparent to-transparent group-hover:translate-x-full transition-transform duration-1000" />
                <Icons.Mic size={44} className="mx-auto text-gold-500 opacity-50 group-hover:scale-110 transition-transform" />
                <h4 className="text-white font-headline text-2xl uppercase tracking-tighter">Fantasie Zonder Grenzen</h4>
                <p className="text-zinc-500 text-xs max-w-sm mx-auto leading-relaxed">Wist je dat elk verhaal in de <strong>Story</strong> sectie ook volledig voorgelezen kan worden? Creëer je eigen scenario en hoor het live tot leven komen met de stem van Belinda of anderen.</p>
            </div>
            
            <div className="h-24 md:hidden" />
        </div>
    </div>
  );
};

export default AudioStoriesInterface;
