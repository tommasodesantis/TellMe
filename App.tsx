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
  Aperture,
  Settings
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
  
  // Audio Visualizer State
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0);

  // Webcam State
  const [showWebcam, setShowWebcam] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Live Client Ref
  const liveClientRef = useRef<LiveClient | null>(null);

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

  const processDocument = async (base64: string, mime: string) => {
    try {
      setIsApiError(false);
      // 1. Analyze
      setAppState(AppState.ANALYZING);
      const result = await Gemini.analyzeDocument(base64, mime, language);
      setAnalysis(result);

      // 2. Generate Art (Single Comic Strip)
      setAppState(AppState.GENERATING_ART);
      
      const comicImage = await Gemini.generateComicStrip(result.prompts);
      setComicUrl(comicImage);

      // 3. Audio
      const audioBase64 = await Gemini.generateNarration(result.narrative);
      
      setAppState(AppState.READY);
      
      if (audioContext) {
        const buffer = await AudioUtils.decodeAudioData(audioBase64, audioContext);
        AudioUtils.playAudioBuffer(audioContext, buffer);
      }

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
      <div className="flex flex-col items-center justify-center h-full bg-indigo-50 px-6 text-center space-y-8">
        
        {/* Language Selector */}
        <div className="flex gap-4 p-2 bg-white/50 rounded-full backdrop-blur-sm mb-4 overflow-x-auto max-w-full no-scrollbar">
           {LANGUAGES.map((lang) => (
             <button
               key={lang.code}
               onClick={() => setLanguage(lang.code)}
               className={`
                 relative w-16 h-16 rounded-full overflow-hidden transition-all duration-300
                 ${language === lang.code ? 'scale-110 ring-4 ring-indigo-400 shadow-xl' : 'opacity-80 grayscale hover:opacity-100 hover:grayscale-0 hover:scale-105'}
               `}
               aria-label={lang.code}
             >
               <img 
                 src={`https://flagcdn.com/w80/${lang.flagCode}.png`}
                 srcSet={`https://flagcdn.com/w160/${lang.flagCode}.png 2x`}
                 alt={lang.code}
                 className="w-full h-full object-cover"
                 loading="lazy"
               />
               {language === lang.code && (
                 <div className="absolute inset-0 bg-indigo-500/10 mix-blend-overlay" />
               )}
             </button>
           ))}
        </div>

        <div className="space-y-4">
          {/* Option 1: Camera */}
          <button 
            onClick={() => {
              handleApiKeySelection().then(() => setShowWebcam(true));
            }}
            className="group relative w-64 h-48 bg-white rounded-3xl shadow-xl flex flex-col items-center justify-center border-4 border-transparent hover:border-indigo-400 transition-all hover:-translate-y-1 active:scale-95"
          >
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-indigo-500 transition-colors">
              <Camera className="w-10 h-10 text-indigo-500 group-hover:text-white transition-colors" />
            </div>
            {/* Using Icon for text-free interface, but distinct shape/color helps */}
            <div className="w-12 h-2 bg-slate-200 rounded-full"></div>
          </button>

          {/* Option 2: Upload */}
          <div className="relative group w-64 h-32">
             <input 
              type="file" 
              accept="image/*,application/pdf" 
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-50"
              aria-label="Upload document"
            />
            <div className="w-full h-full bg-slate-200 rounded-3xl flex items-center justify-center gap-4 hover:bg-slate-300 transition-colors shadow-inner">
               <Upload className="w-8 h-8 text-slate-500" />
               <ImageIcon className="w-8 h-8 text-slate-500" />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLoading = () => (
    <div className="flex flex-col items-center justify-center h-full bg-slate-50 px-6">
      {/* Thinking Cloud Animation - Visual Only */}
      <div className="relative w-48 h-48 animate-float">
         <div className="absolute inset-0 bg-white rounded-full opacity-80 animate-ping duration-[3000ms]"></div>
         <div className="relative flex items-center justify-center w-full h-full bg-white rounded-full shadow-2xl">
             {/* Morphing Icons */}
             {appState === AppState.ANALYZING && <Aperture className="w-20 h-20 text-indigo-300 animate-spin-slow" />}
             {appState === AppState.GENERATING_ART && <ImageIcon className="w-20 h-20 text-pink-300 animate-bounce" />}
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