import React from 'react';
import { LucideIcon } from 'lucide-react';

interface Props {
  imageSrc: string;
  Icon: LucideIcon;
  isActive: boolean;
  isLoading?: boolean;
}

const StoryPanel: React.FC<Props> = ({ imageSrc, Icon, isActive, isLoading }) => {
  return (
    <div 
      className={`
        flex-1 flex flex-col items-center justify-center p-2 rounded-3xl transition-all duration-500
        ${isActive ? 'bg-white shadow-2xl scale-105 border-4 border-yellow-400 z-10' : 'bg-white/50 border border-slate-200 opacity-90 grayscale-[0.3] scale-95'}
      `}
    >
      <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-slate-100 mb-3 shadow-inner">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-300">
             <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-blue-500"></div>
          </div>
        ) : (
          <img 
            src={imageSrc} 
            alt="Story panel" 
            className="w-full h-full object-cover" 
          />
        )}
      </div>
      
      {/* Iconographic representation instead of text */}
      <div className={`
        flex items-center justify-center w-12 h-12 rounded-full 
        ${isActive ? 'bg-blue-500 text-white shadow-lg scale-110' : 'bg-slate-200 text-slate-400'}
        transition-all duration-300
      `}>
        <Icon className="w-6 h-6" strokeWidth={3} />
      </div>
    </div>
  );
};

export default StoryPanel;