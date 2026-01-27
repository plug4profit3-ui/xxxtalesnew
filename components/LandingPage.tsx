
import React from 'react';
import Icons from './Icon';

interface LandingPageProps {
  authScreen: 'login' | 'register' | 'verify';
  setAuthScreen: (screen: 'login' | 'register' | 'verify') => void;
  handleAuthSubmit: (e: React.FormEvent) => void;
  isAgeAccepted: boolean;
  setIsAgeAccepted: (val: boolean) => void;
  authName: string;
  setAuthName: (val: string) => void;
  authEmail: string;
  setAuthEmail: (val: string) => void;
  authPassword: string;
  setAuthPassword: (val: string) => void;
  verificationCode: string;
  setVerificationCode: (val: string) => void;
  handleVerifyCode: (e: React.FormEvent) => void;
  isVerifying: boolean;
  onOpenLegal: (tab: 'privacy' | 'terms') => void;
}

const LandingPage: React.FC<LandingPageProps> = ({
  authScreen,
  setAuthScreen,
  handleAuthSubmit,
  isAgeAccepted,
  setIsAgeAccepted,
  authName,
  setAuthName,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  verificationCode,
  setVerificationCode,
  handleVerifyCode,
  isVerifying,
  onOpenLegal
}) => {
  
  const scrollToForm = () => {
    if (authScreen === 'login') setAuthScreen('register');
    const formElement = document.getElementById('auth-form');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const scrollToFeatures = () => {
    const el = document.getElementById('features');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="h-full w-full bg-black overflow-y-auto no-scrollbar relative flex flex-col">
      {/* Background Video */}
      <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/80 to-black z-10" />
          <video 
            src="https://storage.googleapis.com/foto1982/claudia.mp4" 
            autoPlay loop muted playsInline 
            className="w-full h-full object-cover opacity-60" 
          />
      </div>

      {/* Navbar */}
      <nav className="relative z-50 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
            <img src="https://storage.googleapis.com/foto1982/logo.jpeg" className="w-10 h-10 rounded-lg border border-gold-500/30 object-cover shadow-lg" alt="Logo" />
            <span className="font-headline font-black text-xl text-shine tracking-tighter hidden md:block">XXX-Tales</span>
        </div>
        <div className="flex gap-4">
             {authScreen === 'register' ? (
                 <button onClick={() => setAuthScreen('login')} className="px-6 py-2 rounded-full border border-white/10 bg-black/40 text-xs font-bold text-white hover:text-gold-500 hover:border-gold-500/50 uppercase tracking-widest transition-all backdrop-blur-md">Inloggen</button>
             ) : (
                 <button onClick={scrollToForm} className="px-6 py-2 btn-premium rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">Aanmelden</button>
             )}
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-40 flex flex-col items-center justify-center px-4 pt-10 pb-20 w-full max-w-5xl mx-auto text-center mt-8 md:mt-16">
          
          <div className="space-y-8 mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700">
             <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-red-500/30 bg-red-950/30 backdrop-blur-md mb-2 shadow-[0_0_20px_rgba(220,38,38,0.2)]">
                 <Icons.Lock size={12} className="text-red-500" />
                 <span className="text-[10px] font-black text-red-200 uppercase tracking-[0.2em]">18+ Exclusief Platform</span>
             </div>
             
             <h1 className="text-5xl md:text-7xl lg:text-8xl font-headline font-black text-white leading-[0.9] tracking-tighter drop-shadow-2xl">
                Ontdek Jouw <br className="md:hidden" /> <span className="text-red-600 inline-block filter drop-shadow-[0_0_25px_rgba(220,38,38,0.6)]">Geheime</span> <br />
                <span className="text-red-600 filter drop-shadow-[0_0_25px_rgba(220,38,38,0.6)]">Verlangens</span>
             </h1>
             
             <p className="max-w-2xl mx-auto text-zinc-300 text-sm md:text-lg leading-relaxed font-body font-medium">
                Ongecensureerde AI-gestuurde erotische verhalen en intieme rollenspellen met 40+ verleidelijke karakters. Ervaar fantasieën die tot leven komen.
             </p>
             
             <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                <button onClick={scrollToForm} className="w-full sm:w-auto px-12 py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs md:text-sm uppercase tracking-widest shadow-[0_0_40px_rgba(220,38,38,0.4)] transition-all transform hover:scale-105 active:scale-95">
                    Start Gratis
                </button>
                <button onClick={scrollToFeatures} className="w-full sm:w-auto px-12 py-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/30 text-white rounded-2xl font-black text-xs md:text-sm uppercase tracking-widest backdrop-blur-md transition-all active:scale-95">
                    Ontdek Meer
                </button>
             </div>
          </div>

          {/* Auth Form */}
          <div id="auth-form" className="w-full max-w-md mx-auto glass-premium p-8 md:p-10 rounded-[2.5rem] border-gold-500/30 shadow-2xl animate-in zoom-in-95 duration-500 relative bg-black/40 backdrop-blur-xl">
             {authScreen === 'verify' ? (
                <div className="space-y-6">
                    <div className="w-20 h-20 bg-gold-500/10 rounded-full flex items-center justify-center mx-auto border border-gold-500/30 mb-2">
                        <Icons.ShieldCheck className="text-gold-500" size={40} />
                    </div>
                    <h3 className="text-2xl font-headline font-bold text-white uppercase tracking-wide">Verifieer Account</h3>
                    <p className="text-zinc-400 text-xs">Voer de code in die naar je e-mail is verzonden.</p>
                    <form onSubmit={handleVerifyCode} className="space-y-6 mt-4">
                        <input type="text" maxLength={6} value={verificationCode} onChange={e => setVerificationCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" className="w-full bg-black/60 border border-gold-500/30 rounded-2xl py-4 px-4 text-white text-3xl text-center font-headline tracking-[0.5em] outline-none focus:border-gold-500 focus:shadow-[0_0_30px_rgba(255,215,0,0.2)] transition-all placeholder-zinc-700" required />
                        <button type="submit" disabled={verificationCode.length < 4 || isVerifying} className="w-full py-4 btn-premium rounded-xl font-black text-[11px] uppercase tracking-widest">
                            {isVerifying ? 'CONTROLEREN...' : 'VERIFIEER CODE'}
                        </button>
                    </form>
                </div>
             ) : (
                <>
                   {/* Google Button */}
                   <div id="googleBtn" className="w-full h-12 mb-8 min-h-[48px] flex justify-center"></div>
                   
                   <div className="flex items-center gap-4 mb-8">
                        <div className="h-px bg-white/10 flex-1"></div>
                        <span className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">OF MET E-MAIL</span>
                        <div className="h-px bg-white/10 flex-1"></div>
                   </div>

                   <form onSubmit={handleAuthSubmit} className="space-y-4 text-left">
                        {authScreen === 'register' && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                                <div className="relative group">
                                    <Icons.User className="absolute left-4 top-3.5 text-zinc-500 group-focus-within:text-gold-500 transition-colors" size={18} />
                                    <input type="text" value={authName} onChange={e => setAuthName(e.target.value)} placeholder="Gebruikersnaam" className="w-full bg-black/60 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-white text-sm outline-none focus:border-gold-500/50 transition-colors placeholder-zinc-600" required />
                                </div>
                                
                                <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5 cursor-pointer hover:bg-white/10 transition-colors" onClick={() => setIsAgeAccepted(!isAgeAccepted)}>
                                    <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-all ${isAgeAccepted ? 'bg-gold-500 border-gold-500 text-black' : 'border-zinc-600 bg-black'}`}>
                                        {isAgeAccepted && <Icons.Check size={14} strokeWidth={4} />}
                                    </div>
                                    <span className="text-[11px] text-zinc-400 select-none leading-tight mt-0.5">Ik bevestig dat ik <span className="text-white font-bold">18 jaar of ouder</span> ben en akkoord ga met de voorwaarden.</span>
                                </div>
                            </div>
                        )}
                        
                        <div className="relative group">
                            <Icons.Mail className="absolute left-4 top-3.5 text-zinc-500 group-focus-within:text-gold-500 transition-colors" size={18} />
                            <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="E-mailadres" className="w-full bg-black/60 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-white text-sm outline-none focus:border-gold-500/50 transition-colors placeholder-zinc-600" required />
                        </div>

                        <div className="relative group">
                            <Icons.Lock className="absolute left-4 top-3.5 text-zinc-500 group-focus-within:text-gold-500 transition-colors" size={18} />
                            <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Wachtwoord" className="w-full bg-black/60 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-white text-sm outline-none focus:border-gold-500/50 transition-colors placeholder-zinc-600" required />
                        </div>

                        <button type="submit" className="w-full py-4 btn-premium rounded-xl font-black text-[11px] uppercase tracking-widest mt-4 shadow-xl">
                            {authScreen === 'register' ? 'Maak Gratis Account' : 'Inloggen'}
                        </button>
                   </form>
                   
                   <button onClick={() => setAuthScreen(authScreen === 'login' ? 'register' : 'login')} className="mt-8 text-[10px] text-zinc-500 uppercase font-black tracking-widest hover:text-gold-500 transition-colors w-full text-center">
                        {authScreen === 'login' ? 'Nieuw hier? Maak een account aan' : 'Heb je al een account? Log in'}
                   </button>
                   
                   <div className="flex justify-center gap-6 mt-8 pt-6 border-t border-white/10">
                       <button onClick={() => onOpenLegal('privacy')} className="text-[9px] text-zinc-600 hover:text-zinc-300 uppercase font-bold tracking-widest transition-colors">Privacybeleid</button>
                       <button onClick={() => onOpenLegal('terms')} className="text-[9px] text-zinc-600 hover:text-zinc-300 uppercase font-bold tracking-widest transition-colors">Voorwaarden</button>
                   </div>
                </>
             )}
          </div>
      </main>

      {/* Features Section */}
      <section id="features" className="relative z-40 bg-black py-24 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16 space-y-4">
                <h2 className="text-3xl md:text-5xl font-headline font-black text-white">Wat Maakt XXX-Tales <span className="text-gold-500">Uniek</span>?</h2>
                <p className="text-zinc-500 text-xs uppercase tracking-[0.2em] font-bold">Premium AI-technologie voor jouw meest persoonlijke fantasieën</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Feature 1 */}
                <div className="bg-zinc-900/40 border border-white/10 rounded-[2rem] p-8 hover:border-red-500/50 transition-all group hover:bg-zinc-900/60">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500/10 to-red-900/10 border border-red-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-[0_0_30px_rgba(220,38,38,0.1)]">
                        <Icons.Flame className="text-red-500" size={32} />
                    </div>
                    <h3 className="text-xl font-headline font-bold text-white mb-4">40+ Karakters</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">Kies uit een diverse collectie van verleidelijke persoonlijkheden, elk met unieke fantasieën en verlangens die wachten om ontdekt te worden.</p>
                </div>

                {/* Feature 2 */}
                <div className="bg-zinc-900/40 border border-white/10 rounded-[2rem] p-8 hover:border-gold-500/50 transition-all group hover:bg-zinc-900/60">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gold-500/10 to-gold-900/10 border border-gold-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-[0_0_30px_rgba(255,215,0,0.1)]">
                        <Icons.Sparkles className="text-gold-500" size={32} />
                    </div>
                    <h3 className="text-xl font-headline font-bold text-white mb-4">AI Rollenspel</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">Intieme real-time gesprekken waar karakters intelligent reageren op jouw diepste verlangens, zonder censuur of oordeel.</p>
                </div>

                {/* Feature 3 */}
                <div className="bg-zinc-900/40 border border-white/10 rounded-[2rem] p-8 hover:border-pink-500/50 transition-all group hover:bg-zinc-900/60">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500/10 to-pink-900/10 border border-pink-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-[0_0_30px_rgba(236,72,153,0.1)]">
                        <Icons.Heart className="text-pink-500" size={32} />
                    </div>
                    <h3 className="text-xl font-headline font-bold text-white mb-4">Verhaal Generatie</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">Laat de AI unieke, gepersonaliseerde erotische verhalen schrijven op basis van jouw specifieke scenario's, kinks en favoriete karakters.</p>
                </div>
            </div>
        </div>
      </section>

      {/* Footer Simple */}
      <footer className="relative z-40 py-10 text-center border-t border-white/5 bg-black">
          <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest">© 2024 XXX-Tales AI. Alle rechten voorbehouden.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
