import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Image as ImageIcon, 
  CheckCircle, 
  AlertTriangle, 
  ArrowLeft, 
  RefreshCw,
  Frown,
  Upload,
  X,
  Settings,
  Check,
  Volume2,
  Loader2,
  Hourglass
} from 'lucide-react';
import { AppState, DocumentAnalysis, Language } from './types';
import * as Gemini from './services/geminiService';
import * as AudioUtils from './services/audioUtils';
import { LiveClient } from './services/liveClient';
import MicrophoneButton from './components/MicrophoneButton';

const LANGUAGES: { code: Language, flagCode: string }[] = [
  { code: 'English', flagCode: 'us' },
  { code: 'Spanish', flagCode: 'es' },
  { code: 'French', flagCode: 'fr' },
  { code: 'Hindi', flagCode: 'in' },
  { code: 'Arabic', flagCode: 'sa' }
];

const HELP_TEXTS: Record<Language, string> = {
  'English': "Welcome. To analyze a paper, press the big blue Camera button to take a photo. Or, press the stack of pictures below to pick a file you already have. I will then explain it to you.",
  'Spanish': "Hola. Para leer un documento, usa el botón grande de la Cámara para tomar una foto. O usa el botón de fotos abajo para elegir una que ya tengas. Luego te lo explicaré.",
  'French': "Bonjour. Pour lire un document, appuyez sur le gros bouton Caméra pour prendre une photo. Ou choisissez une image existante avec le bouton photos. Je vous expliquerai ensuite.",
  'Hindi': "Namaste. Kagaz padhne ke liye, bade Camera button se photo lein. Ya photos wale button se purani photo chunein. Phir main aapko samjhaunga.",
  'Arabic': "مرحباً. لقراءة مستند، اضغط على زر الكاميرا الكبير لالتقاط صورة. أو اختر صورة موجودة من زر الصور. وسأشرحها لك."
};

const App: React.FC = () => {
  // State
  const [appState, setAppState] = useState<AppState>(AppState.LANDING);
  const [language, setLanguage] = useState<Language>('English');
  const [docBase64, setDocBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [comicUrl, setComicUrl] = useState<string | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isApiError, setIsApiError] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isHelpPlaying, setIsHelpPlaying] = useState(false);
  
  // Audio Visualizer State
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0);

  // Webcam State
  const [showWebcam, setShowWebcam] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Live Client Ref
  const liveClientRef = useRef<LiveClient | null>(null);

  // Audio Source Ref (To handle stop/start)
  const currentAudioSource = useRef<AudioBufferSourceNode | null>(null);

  // Initialize AudioContext on user interaction
  useEffect(() => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    setAudioContext(ctx);
    return () => {
      ctx.close();
      if (liveClientRef.current) {
        liveClientRef.current.disconnect();
      }
    };
  }, []);

  // Webcam Logic
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (showWebcam && videoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
          }
        })
        .catch(err => {
          console.error("Error accessing webcam:", err);
          setShowWebcam(false);
        });
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [showWebcam]);

  const captureWebcam = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg');
        const base64Data = base64.split(',')[1];
        setDocBase64(base64Data);
        setMimeType('image/jpeg');
        setShowWebcam(false);
        processDocument(base64Data, 'image/jpeg');
      }
    }
  };

  // Handlers
  const handleApiKeySelection = async (force = false) => {
    const aiStudio = (window as any).aistudio;
    if (!aiStudio) return;
    try {
      const hasKey = await aiStudio.hasSelectedApiKey();
      if (!hasKey || force) {
        await aiStudio.openSelectKey();
      }
    } catch (e) {
      console.error("API Key selection failed", e);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await handleApiKeySelection();

    const type = file.type;
    setMimeType(type);
    setAppState(AppState.CAPTURING);
    
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1];
      setDocBase64(base64Data);
      processDocument(base64Data, type);
    };
    reader.readAsDataURL(file);
  };

  // Centralized Audio Player with Stop capability
  const playAudio = async (base64Data: string) => {
    if (!audioContext) return;

    // Stop any currently playing audio to prevent overlaps/restarts
    if (currentAudioSource.current) {
        try {
            currentAudioSource.current.stop();
        } catch (e) {
            // Ignore if already stopped
        }
        currentAudioSource.current = null;
    }

    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    const buffer = await AudioUtils.decodeAudioData(base64Data, audioContext);
    const source = AudioUtils.playAudioBuffer(audioContext, buffer);
    
    currentAudioSource.current = source;
    
    source.onended = () => {
        if (currentAudioSource.current === source) {
            currentAudioSource.current = null;
        }
    };
  };

  const playHelpAudio = async () => {
    if (isHelpPlaying) return;
    setIsHelpPlaying(true);
    
    try {
        await handleApiKeySelection();
        const text = HELP_TEXTS[language];
        const audioBase64 = await Gemini.generateNarration(text);
        await playAudio(audioBase64);
    } catch (e) {
        console.error("Failed to play help audio", e);
    } finally {
        setIsHelpPlaying(false);
    }
  };

  const processDocument = async (base64: string, mime: string) => {
    try {
      setIsApiError(false);
      
      // Stop Help Audio if playing
      if (currentAudioSource.current) {
          try { currentAudioSource.current.stop(); } catch(e){}
          currentAudioSource.current = null;
      }

      // 1. Analyze
      setAppState(AppState.ANALYZING);
      const result = await Gemini.analyzeDocument(base64, mime, language);
      setAnalysis(result);

      // 2. Generate Assets (Parallel)
      setAppState(AppState.GENERATING_ART);
      
      const fallbackImage = `data:${mime};base64,${base64}`;

      // Start Audio generation (Critical)
      const audioPromise = Gemini.generateNarration(result.narrative);

      // Helper to manage race condition correctly by clearing timeout
      const generateComicWithTimeout = async () => {
        let timeoutId: any;
        
        const timeoutPromise = new Promise<string>((resolve) => {
          timeoutId = setTimeout(() => {
            console.warn("Comic generation timed out, using fallback");
            resolve(fallbackImage);
          }, 45000); 
        });

        const generationPromise = Gemini.generateComicStrip(result.prompts)
          .then((url) => {
             clearTimeout(timeoutId); // Cancel timeout on success
             return url;
          })
          .catch(err => {
             clearTimeout(timeoutId); // Cancel timeout on error
             console.warn("Comic generation failed, using fallback:", err);
             return fallbackImage;
          });

        return Promise.race([generationPromise, timeoutPromise]);
      };

      const comicImage = await generateComicWithTimeout();
      setComicUrl(comicImage);

      // Wait for audio (must have)
      const audioBase64 = await audioPromise;
      
      setAppState(AppState.READY);
      
      await playAudio(audioBase64);

    } catch (error: any) {
      console.error(error);
      setAppState(AppState.ERROR);
      const errStr = error.message || error.toString();
      if (errStr.includes("API key") || errStr.includes("400") || JSON.stringify(error).includes("API key")) {
        setIsApiError(true);
      }
    }
  };

  const toggleLiveSession = async () => {
    if (!docBase64 || appState !== AppState.READY) return;
    setLiveError(null);

    // Stop narrative audio if entering live mode
    if (currentAudioSource.current) {
        try { currentAudioSource.current.stop(); } catch(e){}
        currentAudioSource.current = null;
    }

    if (isMicActive) {
      // Stop session
      if (liveClientRef.current) {
        await liveClientRef.current.disconnect();
        liveClientRef.current = null;
      }
      setIsMicActive(false);
      setUserVolume(0);
      setAiVolume(0);
    } else {
      // Start session
      try {
        setIsMicActive(true);
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API Key missing");

        const client = new LiveClient(apiKey, {
           onDisconnect: () => {
               setIsMicActive(false);
               liveClientRef.current = null;
               setUserVolume(0);
               setAiVolume(0);
           },
           onVolume: (u, a) => {
               setUserVolume(u);
               setAiVolume(a);
           }
        });

        liveClientRef.current = client;
        
        // Pass mimeType and analysis context. 
        const context = analysis ? `
          Topic: ${analysis.topic}
          Action Required: ${analysis.action}
          Narrative Explanation: ${analysis.narrative}
          
          --- DETAILED DOCUMENT CONTEXT ---
          ${analysis.detailedSummary}
        ` : undefined;

        await client.connect(docBase64, mimeType, language, context);
        
      } catch (e: any) {
        console.error("Failed to start live session", e);
        setIsMicActive(false);
        liveClientRef.current = null;
        if (e.message && e.message.includes("503")) {
          setLiveError("Service busy. Please try again.");
        } else {
          setLiveError("Connection failed.");
        }
      }
    }
  };

  const resetApp = () => {
    if (liveClientRef.current) {
        liveClientRef.current.disconnect();
        liveClientRef.current = null;
    }
    // Stop any playing audio
    if (currentAudioSource.current) {
        try { currentAudioSource.current.stop(); } catch(e){}
        currentAudioSource.current = null;
    }

    setIsMicActive(false);
    setUserVolume(0);
    setAiVolume(0);
    setAppState(AppState.LANDING);
    setDocBase64(null);
    setAnalysis(null);
    setComicUrl(null);
    setIsApiError(false);
    setShowWebcam(false);
    setLiveError(null);
  };

  // --- RENDER HELPERS ---

  const renderLanding = () => {
    if (showWebcam) {
      return (
        <div className="flex flex-col h-full bg-black relative">
          <video 
            ref={videoRef} 
            className="w-full h-full object-cover" 
            autoPlay 
            playsInline 
            muted
          />
          <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-8 z-50">
             <button 
               onClick={() => setShowWebcam(false)}
               className="p-4 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/40 transition-colors"
             >
               <X className="w-8 h-8" />
             </button>
             <button 
               onClick={captureWebcam}
               className="p-1 rounded-full border-4 border-white transition-transform active:scale-95"
             >
                <div className="w-16 h-16 bg-white rounded-full"></div>
             </button>
             <div className="w-16"></div> {/* Spacer for balance */}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center h-full bg-slate-50 relative overflow-hidden">
        
        {/* Top Section: Language Selection & Help */}
        <div className="w-full pt-8 pb-4 bg-white/80 backdrop-blur-md shadow-sm z-10 flex justify-between items-center px-4">
             {/* Language List */}
             <div className="flex gap-4 p-2 overflow-x-auto max-w-[calc(100%-60px)] no-scrollbar">
                {LANGUAGES.map((lang) => (
                    <button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className={`
                        relative w-16 h-16 rounded-full overflow-visible transition-all duration-300 flex-shrink-0
                        ${language === lang.code ? 'scale-110 z-10' : 'opacity-60 grayscale hover:opacity-100 hover:scale-105'}
                    `}
                    aria-label={lang.code}
                    >
                    <div className={`w-full h-full rounded-full overflow-hidden border-2 ${language === lang.code ? 'border-indigo-500 shadow-xl' : 'border-transparent'}`}>
                        <img 
                            src={`https://flagcdn.com/w80/${lang.flagCode}.png`}
                            srcSet={`https://flagcdn.com/w160/${lang.flagCode}.png 2x`}
                            alt={lang.code}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    </div>
                    {/* Visual checkmark for selected state */}
                    {language === lang.code && (
                        <div className="absolute -bottom-1 -right-1 bg-green-500 text-white rounded-full p-1 border-2 border-white shadow-sm">
                            <Check className="w-4 h-4" strokeWidth={4} />
                        </div>
                    )}
                    </button>
                ))}
             </div>

             {/* Help Button - Audio Explanation */}
             <button
                onClick={playHelpAudio}
                disabled={isHelpPlaying}
                className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 shadow-sm border-2 border-indigo-200 active:scale-95 transition-all flex-shrink-0"
                aria-label="Listen to explanation"
             >
                 {isHelpPlaying ? (
                     <Loader2 className="w-8 h-8 animate-spin" />
                 ) : (
                     <Volume2 className="w-8 h-8" />
                 )}
             </button>
        </div>

        {/* Center Section: THE BIG BUTTON (Camera) */}
        <div className="flex-1 flex flex-col items-center justify-center w-full relative">
            <div className="relative">
                {/* Pulsing ring to invite touch */}
                <div className="absolute inset-0 bg-indigo-400 rounded-full opacity-20 animate-ping-slow duration-[2000ms] scale-125"></div>
                <div className="absolute inset-0 bg-indigo-300 rounded-full opacity-30 animate-pulse scale-110"></div>
                
                <button 
                    onClick={() => {
                        handleApiKeySelection().then(() => setShowWebcam(true));
                    }}
                    className="relative w-64 h-64 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-[0_20px_50px_rgba(79,70,229,0.4)] flex items-center justify-center border-8 border-white active:scale-95 transition-transform"
                    aria-label="Start Camera"
                >
                    <div className="flex flex-col items-center gap-2">
                        <Camera className="w-24 h-24 text-white drop-shadow-md" strokeWidth={1.5} />
                    </div>
                </button>
            </div>
        </div>

        {/* Bottom Section: Secondary Action (Upload) */}
        {/* Metaphor: A stack of photos/cards */}
        <div className="w-full pb-12 flex justify-center z-10">
          <div className="relative group w-32 h-32">
             <input 
              type="file" 
              accept="image/*,application/pdf" 
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-50"
              aria-label="Upload document"
            />
            {/* The Visual Stack */}
            <div className="absolute top-2 left-2 w-full h-full bg-white rounded-xl shadow-md border border-slate-200 transform -rotate-6"></div>
            <div className="absolute top-1 left-1 w-full h-full bg-white rounded-xl shadow-md border border-slate-200 transform -rotate-3"></div>
            <div className="absolute top-0 left-0 w-full h-full bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col items-center justify-center transition-transform group-active:scale-95 hover:bg-slate-50">
               <ImageIcon className="w-10 h-10 text-slate-400 mb-1" />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLoading = () => (
    <div className="flex flex-col items-center justify-center h-full bg-slate-50 px-6">
      {/* Visual Metaphor: Big Hourglass for 'Please Wait' */}
      <div className="relative w-64 h-64 flex items-center justify-center">
         {/* Spinning Outer Ring - Signifies 'Processing' */}
         <div className="absolute inset-0 border-[16px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" style={{ animationDuration: '3s' }}></div>
         
         {/* Center Icon - Signifies 'Wait' */}
         <div className="bg-white rounded-full p-8 shadow-2xl relative z-10 flex flex-col items-center justify-center">
            <Hourglass className="w-20 h-20 text-indigo-500 animate-pulse" strokeWidth={1.5} />
         </div>
      </div>
    </div>
  );

  const renderStory = () => {
    if (!analysis || !comicUrl) return null;

    // Determine status color - No text, just big icon
    const statusColor = analysis.isUrgent ? 'text-red-500 bg-red-100' : 'text-green-500 bg-green-100';
    const StatusIcon = analysis.isUrgent ? AlertTriangle : CheckCircle;

    return (
      <div className="flex flex-col h-full bg-slate-50 relative">
        {/* Header: Action/Status */}
        <div className="flex justify-between items-center p-4 bg-white shadow-sm z-20">
            <button onClick={resetApp} className="p-3 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition-colors">
                <ArrowLeft className="w-8 h-8" />
            </button>
            <div className={`p-3 rounded-full ${statusColor} animate-pulse`}>
                <StatusIcon className="w-10 h-10" />
            </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center relative">
            
            {/* The Comic Strip Image */}
            <div className={`w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 opacity-100`}>
               <img src={comicUrl} alt="Comic Strip" className="w-full h-auto object-cover" />
            </div>

             {/* Live Error Toast */}
             {liveError && (
              <div className="absolute bottom-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg animate-bounce">
                {liveError}
              </div>
            )}
            
        </div>

        {/* Interaction Footer */}
        <div className="h-32 bg-white border-t border-slate-100 flex items-center justify-center z-40 relative shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
            <div className="absolute -top-10">
                <MicrophoneButton 
                    onClick={toggleLiveSession} 
                    isListening={isMicActive}
                    userVolume={userVolume}
                    aiVolume={aiVolume}
                />
            </div>
        </div>
      </div>
    );
  };

  // Main Route Switch
  return (
    <div className="h-full w-full font-sans">
      {appState === AppState.LANDING && renderLanding()}
      {(appState === AppState.CAPTURING || appState === AppState.ANALYZING || appState === AppState.GENERATING_ART) && renderLoading()}
      {appState === AppState.READY && renderStory()}
      {appState === AppState.ERROR && (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-8 bg-red-50">
            <Frown className="w-32 h-32 text-red-400" />
            <div className="flex gap-4">
                <button onClick={resetApp} className="w-16 h-16 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
                    <RefreshCw className="w-8 h-8" />
                </button>
                {isApiError && (
                    <button 
                        onClick={() => handleApiKeySelection(true).then(resetApp)} 
                        className="w-16 h-16 bg-white text-orange-500 rounded-full flex items-center justify-center shadow-lg border-2 border-orange-200 hover:scale-105 transition-transform"
                    >
                         <Settings className="w-8 h-8" />
                    </button>
                )}
            </div>
        </div>
      )}
    </div>
  );
};

export default App;