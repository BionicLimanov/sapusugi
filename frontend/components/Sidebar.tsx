import React from 'react'
import { StickyNote, MessageSquare, X } from 'lucide-react'

interface SidebarProps {
  isOpen: boolean
  activePanel: 'notes' | 'chat'
  onPanelChange: (panel: 'notes' | 'chat') => void
  onClose: () => void
  children: React.ReactNode
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  activePanel,
  onPanelChange,
  onClose,
  children,
}) => {
  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed lg:relative top-0 left-0 h-screen bg-gray-900 border-r border-gray-800 z-50
          transition-all duration-300 ease-in-out
          ${isOpen ? 'translate-x-0 w-96' : '-translate-x-full w-0'}
        `}
        style={{ 
          boxShadow: isOpen ? '4px 0 24px rgba(0, 0, 0, 0.3)' : 'none'
        }}
      >
        {isOpen && (
          <div className="flex flex-col h-full w-96">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <div className="flex gap-2">
                <button
                  onClick={() => onPanelChange('notes')}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg transition-all
                    ${activePanel === 'notes' 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' 
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }
                  `}
                >
                  <StickyNote size={16} />
                  <span className="text-sm font-medium">Notes</span>
                </button>
                
                <button
                  onClick={() => onPanelChange('chat')}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg transition-all
                    ${activePanel === 'chat' 
                      ? 'bg-green-600 text-white shadow-lg shadow-green-600/30' 
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }
                  `}
                >
                  <MessageSquare size={16} />
                  <span className="text-sm font-medium">Chat</span>
                </button>
              </div>

              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                aria-label="Close sidebar"
              >
                <X size={18} />
              </button>
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 overflow-hidden">
              {children}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default Sidebar