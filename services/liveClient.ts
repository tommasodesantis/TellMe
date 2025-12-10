import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { decodeAudioData, float32ToBase64 } from "./audioUtils";

interface LiveClientCallbacks {
  onDisconnect: () => void;
  onVolume: (userVolume: number, aiVolume: number) => void;
}

export class LiveClient {
  private session: any = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  // Audio Analysis
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private volumeInterval: number | null = null;
  
  // Audio playback queue
  private nextStartTime: number = 0;
  private scheduledSources: Set<AudioBufferSourceNode> = new Set();
  
  constructor(private apiKey: string, private callbacks: LiveClientCallbacks) {}

  async connect(data: string, mimeType: string, language: string, contextText?: string) {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    // 1. Setup Audio Contexts
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    // Setup Analysers for Visuals
    this.inputAnalyser = this.inputAudioContext.createAnalyser();
    this.inputAnalyser.fftSize = 256; // Small FFT for responsiveness
    this.inputAnalyser.smoothingTimeConstant = 0.5;

    this.outputAnalyser = this.outputAudioContext.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputAnalyser.smoothingTimeConstant = 0.5;

    // Start Volume Monitoring Loop
    this.startVolumeMonitoring();
    
    // 2. Setup Microphone Stream
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Enhance system instruction
    const instruction = `You are a friendly, reassuring assistant explaining a document to a user with low literacy. Speak simply, slowly, and clearly in ${language}. Keep answers concise.` + 
      (contextText ? `\n\nContext about the document being discussed: ${contextText}` : "");

    // 3. Connect to Live API
    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: instruction }] },
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
        }
      },
      callbacks: {
        onopen: async () => {
          console.log("Live Session Connected");
          
          if (mimeType.startsWith('image/')) {
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                  media: {
                      mimeType: mimeType,
                      data: data
                  }
              });
            });
          }

          this.startAudioInput(sessionPromise);
        },
        onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && this.outputAudioContext) {
                this.queueAudioOutput(audioData);
            }

            if (message.serverContent?.interrupted) {
                this.stopAudioOutput();
            }
        },
        onclose: () => {
          console.log("Live Session Closed");
          this.disconnect();
        },
        onerror: (err) => {
          console.error("Live Session Error", err);
          this.disconnect();
        }
      }
    });

    this.session = sessionPromise;
  }

  private startVolumeMonitoring() {
    if (this.volumeInterval) window.clearInterval(this.volumeInterval);
    
    this.volumeInterval = window.setInterval(() => {
        const userVol = this.getVolume(this.inputAnalyser);
        const aiVol = this.getVolume(this.outputAnalyser);
        this.callbacks.onVolume(userVol, aiVol);
    }, 50); // 20fps update rate
  }

  private getVolume(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate RMS-like average
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    return average / 255; // Normalize 0-1
  }

  private startAudioInput(sessionPromise: Promise<any>) {
    if (!this.inputAudioContext || !this.mediaStream || !this.inputAnalyser) return;

    this.source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const base64Audio = float32ToBase64(inputData);
      
      sessionPromise.then(session => {
        session.sendRealtimeInput({
          media: {
            mimeType: "audio/pcm;rate=16000",
            data: base64Audio
          }
        });
      });
    };

    // Chain: Source -> Analyser -> Processor -> Destination
    this.source.connect(this.inputAnalyser);
    this.inputAnalyser.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async queueAudioOutput(base64Audio: string) {
    if (!this.outputAudioContext || !this.outputAnalyser) return;

    try {
      const buffer = await decodeAudioData(base64Audio, this.outputAudioContext, 24000);
      
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = buffer;
      
      // Chain: Source -> Analyser -> Destination
      source.connect(this.outputAnalyser);
      this.outputAnalyser.connect(this.outputAudioContext.destination);

      const currentTime = this.outputAudioContext.currentTime;
      if (this.nextStartTime < currentTime) {
          this.nextStartTime = currentTime;
      }
      
      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
      
      this.scheduledSources.add(source);
      source.onended = () => {
          this.scheduledSources.delete(source);
      };

    } catch (e) {
      console.error("Error decoding audio output", e);
    }
  }

  private stopAudioOutput() {
    this.scheduledSources.forEach(source => {
        try { source.stop(); } catch (e) {}
    });
    this.scheduledSources.clear();
    this.nextStartTime = 0;
  }

  async disconnect() {
    this.stopAudioOutput();
    if (this.volumeInterval) {
        window.clearInterval(this.volumeInterval);
        this.volumeInterval = null;
    }

    if (this.processor) {
        this.processor.disconnect();
        this.processor = null;
    }
    if (this.source) {
        this.source.disconnect();
        this.source = null;
    }
    if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
    }
    if (this.inputAudioContext) {
        await this.inputAudioContext.close();
        this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
        await this.outputAudioContext.close();
        this.outputAudioContext = null;
    }
    
    this.session = null;
    this.callbacks.onDisconnect();
  }
}