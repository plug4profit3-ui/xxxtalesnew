
import React from 'react';
import Icons from './Icon';
import { getTexts } from '../constants';
import { Language } from '../types';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchase: (amount: number, isSub: boolean) => void;
  reason: string;
  language?: Language;
}

const PaywallModal: React.FC<PaywallModalProps> = ({ isOpen, onClose, onPurchase, reason, language = 'nl' }) => {
  // We use hardcoded texts mostly to match the specific design provided, 
  // but we can fall back to translations for generic parts if needed in future.
  const t = getTexts(language as string).paywall; 

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-black/95 backdrop-blur-xl" onClick={onClose} />
      
      <div className="relative w-full max-w-5xl bg-[#0b0b0c] border border-zinc-800 rounded-[1.5rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)] flex flex-col md:flex-row max-h-[90vh] md:h-auto overflow-y-auto no-scrollbar pb-safe">
        
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-4 right-4 z-50 p-2 text-zinc-500 hover:text-white transition-colors bg-black/50 rounded-full touch-manipulation">
            <Icons.X size={20} />
        </button>

        {/* LEFT SIDE: Context & VIP */}
        <div className="w-full md:w-[45%] bg-[#151518] p-8 md:p-10 flex flex-col border-b md:border-b-0 md:border-r border-zinc-800 relative overflow-hidden shrink-0">
           <div className="absolute inset-0 z-0 opacity-20">
               <img src="https://storage.googleapis.com/foto1982/claudia.jpg" className="w-full h-full object-cover grayscale" />
               <div className="absolute inset-0 bg-gradient-to-t from-[#151518] via-[#151518]/80 to-transparent" />
           </div>

           <div className="relative z-10">
               <div className="inline-block px-3 py-1 rounded-full bg-gold-500 text-black text-[10px] font-black uppercase tracking-widest mb-6">Premium Toegang</div>
               <h1 className="text-3xl md:text-4xl font-headline font-black text-white mb-4 leading-[1.1]">Ga dieper in je <span className="text-gold-500 text-shine">fantasie</span></h1>
               <p className="text-zinc-400 text-sm leading-relaxed mb-8">
                 "{reason || "Toegang tot exclusieve interactie, roleplay en digitale beleving. Discreet en veilig."}"
               </p>

               <ul className="space-y-3 mb-8">
                  <li className="flex items-center gap-3 text-sm text-zinc-300"><Icons.Check className="text-gold-500 shrink-0" size={16} /> <span className="font-medium">Onbeperkt chatten & roleplay</span></li>
                  <li className="flex items-center gap-3 text-sm text-zinc-300"><Icons.Check className="text-gold-500 shrink-0" size={16} /> <span className="font-medium">Exclusieve premium interacties</span></li>
                  <li className="flex items-center gap-3 text-sm text-zinc-300"><Icons.Check className="text-gold-500 shrink-0" size={16} /> <span className="font-medium">Real-time Live Video Calls</span></li>
                  <li className="flex items-center gap-3 text-sm text-zinc-300"><Icons.Check className="text-gold-500 shrink-0" size={16} /> <span className="font-medium">Elk moment opzegbaar</span></li>
               </ul>

               {/* VIP CARD */}
               <div className="mt-auto bg-black/40 border-2 border-gold-500 rounded-2xl p-6 relative overflow-hidden group hover:bg-black/60 transition-colors">
                   <div className="absolute top-0 right-0 bg-gold-500 text-black text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest">Meest Gekozen</div>
                   <h2 className="text-xl font-bold text-white mb-1">VIP Membership</h2>
                   <div className="flex items-baseline gap-2 mb-2">
                       <span className="text-3xl font-black text-white">€17,99</span>
                       <span className="text-sm text-zinc-500">/ maand</span>
                   </div>
                   <p className="text-xs text-zinc-400 mb-4">Volledige toegang · Onbeperkte chats · 400 credits p/m</p>
                   <button onClick={() => onPurchase(400, true)} className="relative z-20 w-full py-4 bg-gold-500 hover:bg-gold-400 text-black font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95 shadow-[0_0_20px_rgba(255,215,0,0.3)] touch-manipulation">
                       Start Gratis Trial (3 Dagen)
                   </button>
                   <p className="text-[9px] text-zinc-600 text-center mt-3 uppercase font-bold tracking-wider">Geen verplichtingen · Discreet</p>
               </div>
           </div>
        </div>

        {/* RIGHT SIDE: Credits */}
        <div className="flex-1 p-8 md:p-10 bg-[#0b0b0c] flex flex-col">
            <div className="mb-8">
                <h2 className="text-xl font-bold text-white mb-2">Meer intensiteit, meer controle</h2>
                <p className="text-zinc-500 text-sm">Credits gebruik je voor premium interacties, image generation en exclusieve content.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Starter */}
                <button onClick={() => onPurchase(80, false)} className="bg-[#151518] border border-zinc-800 hover:border-zinc-600 rounded-2xl p-5 text-left transition-all active:scale-95 group touch-manipulation">
                    <h3 className="text-white font-bold mb-1 group-hover:text-gold-500 transition-colors">Starter</h3>
                    <div className="text-2xl font-black text-white mb-1">80 <span className="text-sm font-normal text-zinc-500">credits</span></div>
                    <p className="text-xs text-zinc-500 mb-4">€4,99 · Perfect om te beginnen</p>
                    <div className="w-full py-2 bg-zinc-800 text-white text-[10px] font-bold uppercase tracking-widest text-center rounded-lg group-hover:bg-zinc-700">Kies Starter</div>
                </button>

                {/* Popular */}
                <button onClick={() => onPurchase(250, false)} className="bg-[#151518] border border-gold-500/50 rounded-2xl p-5 text-left relative transition-all active:scale-95 shadow-[0_0_30px_rgba(0,0,0,0.5)] group touch-manipulation">
                    <div className="absolute top-0 right-0 bg-gold-500/20 text-gold-500 text-[8px] font-black px-2 py-1 rounded-bl-lg uppercase tracking-widest">Populair</div>
                    <h3 className="text-white font-bold mb-1 group-hover:text-gold-500 transition-colors">Popular</h3>
                    <div className="text-2xl font-black text-white mb-1">250 <span className="text-sm font-normal text-zinc-500">credits</span></div>
                    <p className="text-xs text-zinc-500 mb-4">€9,99 · Beste balans</p>
                    <div className="w-full py-2 bg-gold-500 text-black text-[10px] font-black uppercase tracking-widest text-center rounded-lg hover:bg-gold-400">Meest Gekozen</div>
                </button>

                {/* Intense */}
                <button onClick={() => onPurchase(600, false)} className="bg-[#151518] border border-zinc-800 hover:border-zinc-600 rounded-2xl p-5 text-left transition-all active:scale-95 group touch-manipulation">
                    <h3 className="text-white font-bold mb-1 group-hover:text-gold-500 transition-colors">Intense</h3>
                    <div className="text-2xl font-black text-white mb-1">600 <span className="text-sm font-normal text-zinc-500">credits</span></div>
                    <p className="text-xs text-zinc-500 mb-4">€19,99 · Voor langere sessies</p>
                    <div className="w-full py-2 bg-zinc-800 text-white text-[10px] font-bold uppercase tracking-widest text-center rounded-lg group-hover:bg-zinc-700">Ga Dieper</div>
                </button>

                {/* Elite */}
                <button onClick={() => onPurchase(1500, false)} className="bg-[#151518] border border-zinc-800 hover:border-zinc-600 rounded-2xl p-5 text-left transition-all active:scale-95 group touch-manipulation">
                    <h3 className="text-white font-bold mb-1 group-hover:text-gold-500 transition-colors">Elite</h3>
                    <div className="text-2xl font-black text-white mb-1">1.500 <span className="text-sm font-normal text-zinc-500">credits</span></div>
                    <p className="text-xs text-zinc-500 mb-4">€39,99 · Maximale vrijheid</p>
                    <div className="w-full py-2 bg-zinc-800 text-white text-[10px] font-bold uppercase tracking-widest text-center rounded-lg group-hover:bg-zinc-700">Unlock Elite</div>
                </button>
            </div>

            <div className="mt-auto pt-8 text-center">
                <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">
                    Discreet gefactureerd · Digitale service · 18+ Only<br/>
                    <span className="opacity-50 font-normal normal-case">Door verder te gaan ga je akkoord met onze voorwaarden.</span>
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default PaywallModal;
