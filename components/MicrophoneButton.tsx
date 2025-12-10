import React from 'react';
import { Ear } from 'lucide-react';

interface Props {
  onClick: () => void;
  isListening: boolean; // Means session is active
  userVolume?: number;
  aiVolume?: number;
  disabled?: boolean;
}

const MicrophoneButton: React.FC<Props> = ({ onClick, isListening, userVolume = 0, aiVolume = 0, disabled }) => {
  // Thresholds for visual states
  const isUserSpeaking = userVolume > 0.05;
  const isAiSpeaking = aiVolume > 0.05;
  
  // Calculate dynamic scales
  const userScale = 1 + Math.min(userVolume * 2, 0.5); // Max scale 1.5x
  const aiScale = 1 + Math.min(aiVolume * 3, 1); // Max scale 2x

  return (
    <div className="relative flex items-center justify-center w-32 h-32">
        {/* AI Ripple (Outer Ring) */}
        {isListening && (
            <div 
                className={`absolute inset-0 rounded-full border-4 border-blue-400 opacity-50 transition-transform duration-75 ease-out`}
                style={{ 
                    transform: isAiSpeaking ? `scale(${aiScale})` : 'scale(1)',
                    borderColor: isAiSpeaking ? '#60A5FA' : 'transparent' // Only show when AI talks
                }}
            />
        )}
        
        {/* Breathing Halo (Waiting State) */}
        {isListening && !isUserSpeaking && !isAiSpeaking && (
            <div className="absolute inset-0 bg-blue-200 rounded-full opacity-30 animate-ping-slow duration-[3000ms]"></div>
        )}

        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                relative flex items-center justify-center rounded-full transition-all duration-300 z-10
                ${isListening ? 'w-24 h-24 shadow-2xl' : 'w-20 h-20 bg-blue-600 shadow-xl'}
                ${isListening && isUserSpeaking ? 'bg-red-500' : isListening ? 'bg-blue-500' : ''}
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}
            `}
            style={{
                transform: isListening && isUserSpeaking ? `scale(${userScale})` : 'scale(1)'
            }}
            aria-label="Ask a question"
        >
            {/* Inner Glow for User Voice */}
            {isListening && isUserSpeaking && (
                <span className="absolute w-full h-full rounded-full bg-red-400 opacity-75 animate-ping"></span>
            )}
            
            {/* The Ear Icon: Represents "I am listening to you" */}
            <Ear className={`w-10 h-10 text-white ${isListening && !isUserSpeaking && !isAiSpeaking ? 'opacity-90' : ''}`} />
        </button>
    </div>
  );
};

export default MicrophoneButton;