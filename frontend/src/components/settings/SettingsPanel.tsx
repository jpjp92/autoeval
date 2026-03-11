import { User, Key, Bell, CreditCard, Shield, Save } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/src/lib/utils';

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState('profile');

  const sections = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'api-keys', label: 'API Keys', icon: Key },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex min-h-[600px] h-[calc(100vh-140px)]">
      {/* Settings Sidebar */}
      <div className="w-64 bg-slate-50 border-r border-slate-200 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">Settings</h2>
        <nav className="space-y-1 flex-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                activeSection === section.id
                  ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:bg-slate-100/50 hover:text-slate-900"
              )}
            >
              <section.icon className="w-4 h-4" />
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Settings Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        {activeSection === 'profile' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-xl font-semibold text-slate-900 mb-6">Profile Information</h3>
            <div className="space-y-8">
              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-3xl font-bold shadow-inner">
                  AD
                </div>
                <div className="space-y-2">
                  <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                    Change Avatar
                  </button>
                  <p className="text-xs text-slate-500">JPG, GIF or PNG. Max size of 800K</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">First Name</label>
                  <input type="text" defaultValue="Admin" className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Last Name</label>
                  <input type="text" defaultValue="User" className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Email Address</label>
                  <input type="email" defaultValue="admin@autoeval.ai" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 outline-none cursor-not-allowed" readOnly />
                  <p className="text-xs text-slate-500 mt-2">To change your email address, please contact support.</p>
                </div>
              </div>
              
              <div className="pt-6 border-t border-slate-100">
                <button className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                  <Save className="w-4 h-4" /> Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'api-keys' && (
          <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-xl font-semibold text-slate-900 mb-2">API Keys</h3>
            <p className="text-sm text-slate-500 mb-8">Manage your API keys for external integrations and model access.</p>
            
            <div className="space-y-6">
              <div className="p-5 border border-slate-200 rounded-xl bg-slate-50/50">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="font-semibold text-slate-900 block">Gemini API Key</span>
                    <span className="text-xs text-slate-500">Used for primary agent reasoning</span>
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200">Active</span>
                </div>
                <div className="flex gap-3">
                  <input type="password" value="AIzaSyB-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" readOnly className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 outline-none font-mono" />
                  <button className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                    Reveal
                  </button>
                </div>
              </div>

              <div className="p-5 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="font-semibold text-slate-900 block">OpenAI API Key</span>
                    <span className="text-xs text-slate-500">Optional fallback model access</span>
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full border border-slate-200">Not Configured</span>
                </div>
                <div className="flex gap-3">
                  <input type="text" placeholder="sk-..." className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono transition-all" />
                  <button className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                    Save Key
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection !== 'profile' && activeSection !== 'api-keys' && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-in fade-in duration-500">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 border border-slate-100">
              <span className="text-3xl">⚙️</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">{sections.find(s => s.id === activeSection)?.label} Settings</h3>
            <p className="text-sm text-slate-500 max-w-sm text-center">This configuration section is currently under development and will be available in the next update.</p>
          </div>
        )}
      </div>
    </div>
  );
}
