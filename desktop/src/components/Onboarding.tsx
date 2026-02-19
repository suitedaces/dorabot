import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { dorabotComputerImg, dorabotImg, whatsappImg, telegramImg } from '../assets';
import type { useGateway } from '../hooks/useGateway';
import { ProviderSetup } from './ProviderSetup';
import { FlipWords } from './aceternity/flip-words';
import { TextGenerateEffect } from './aceternity/text-generate-effect';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check, Loader2, Monitor, Hand, ChevronRight, ChevronLeft,
  MessageSquare, Sparkles, Brain, Zap, LayoutGrid, ArrowRight,
  Eye, EyeOff, Globe, User, Smartphone,
} from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onComplete: (launchOnboard?: boolean) => void;
};

type ProviderChoice = {
  provider: 'claude' | 'codex';
  method: 'oauth' | 'apikey';
};

type DetectResult = {
  claude: { installed: boolean; hasOAuth: boolean; hasApiKey: boolean };
  codex: { installed: boolean; hasAuth: boolean };
};

type Step = 'welcome' | 'detecting' | 'ready' | 'choose' | 'auth' | 'auth-success' | 'profile' | 'channels' | 'permissions' | 'tour' | 'launch';

const isMac = (window as any).electronAPI?.platform === 'darwin';

const STEPS_ORDER: Step[] = ['welcome', 'detecting', 'choose', 'auth', 'auth-success', 'profile', 'channels', 'permissions', 'tour', 'launch'];

function getStepIndex(step: Step): number {
  return STEPS_ORDER.indexOf(step);
}

// Detect system timezone
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// Step indicator dots
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-300 ${
            i === current
              ? 'w-6 bg-primary'
              : i < current
              ? 'w-1.5 bg-primary/50'
              : 'w-1.5 bg-muted-foreground/20'
          }`}
        />
      ))}
    </div>
  );
}

// Progress bar showing which major phases are done
const PHASE_LABELS = ['connect', 'profile', 'channels', 'setup', 'go'];

function PhaseBar({ step }: { step: Step }) {
  const phaseMap: Record<Step, number> = {
    welcome: 0, detecting: 0, ready: 0, choose: 0, auth: 0, 'auth-success': 0,
    profile: 1, channels: 2, permissions: 3, tour: 3, launch: 4,
  };
  const active = phaseMap[step] ?? 0;

  return (
    <div className="flex items-center gap-1 w-full max-w-xs mx-auto">
      {PHASE_LABELS.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className={`h-1 w-full rounded-full transition-all duration-500 ${
              i <= active ? 'bg-primary' : 'bg-muted-foreground/15'
            }`}
          />
          <span className={`text-[8px] uppercase tracking-wider transition-colors ${
            i <= active ? 'text-primary' : 'text-muted-foreground/40'
          }`}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// Animated page wrapper
function PageTransition({ children, direction = 1 }: { children: React.ReactNode; direction?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: direction * 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: direction * -20 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export function OnboardingOverlay({ gateway, onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [choice, setChoice] = useState<ProviderChoice | null>(null);
  const [authInfo, setAuthInfo] = useState<{ method?: string; identity?: string } | null>(null);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [direction, setDirection] = useState(1);

  // Profile state
  const [profileName, setProfileName] = useState('');
  const [profileTimezone, setProfileTimezone] = useState(detectTimezone());

  const detectRan = useRef(false);

  const goTo = useCallback((next: Step, dir: number = 1) => {
    setDirection(dir);
    setStep(next);
  }, []);

  // Skip to next logical step
  const goAfterAuth = useCallback(() => {
    goTo('profile');
  }, [goTo]);

  const goAfterProfile = useCallback(() => {
    goTo('channels');
  }, [goTo]);

  const goAfterChannels = useCallback(() => {
    if (isMac) {
      goTo('permissions');
    } else {
      goTo('tour');
    }
  }, [goTo]);

  const goAfterPermissions = useCallback(() => {
    goTo('tour');
  }, [goTo]);

  const goAfterTour = useCallback(() => {
    goTo('launch');
  }, [goTo]);

  // Provider detection
  const runDetection = useCallback(async () => {
    if (detectRan.current) return;
    detectRan.current = true;
    goTo('detecting');

    try {
      const result = await gateway.detectProviders();
      setDetectResult(result);

      if (result.claude.hasOAuth || result.claude.hasApiKey) {
        try { await gateway.setProvider('claude'); } catch { /* continue */ }
        setAuthInfo({
          method: result.claude.hasOAuth ? 'oauth' : 'api_key',
          identity: result.claude.hasOAuth ? 'Claude subscription' : 'API key',
        });
        // Auto-detected, skip auth steps
        setTimeout(() => goTo('profile'), 800);
        return;
      }

      if (result.codex.hasAuth) {
        try { await gateway.setProvider('codex'); } catch { /* continue */ }
        setAuthInfo({ method: 'api_key', identity: 'OpenAI' });
        setTimeout(() => goTo('profile'), 800);
        return;
      }

      goTo('choose');
    } catch {
      goTo('choose');
    }
  }, [gateway, goTo]);

  const handleChoice = useCallback(async (c: ProviderChoice) => {
    setChoice(c);
    try { await gateway.setProvider(c.provider); } catch { /* continue */ }
    goTo('auth');
  }, [gateway, goTo]);

  const handleAuthSuccess = useCallback(async () => {
    try {
      const status = await gateway.getProviderStatus();
      if (status?.auth) {
        setAuthInfo({ method: status.auth.method, identity: status.auth.identity });
      }
    } catch { /* show generic success */ }
    goTo('auth-success');
    setTimeout(() => goAfterAuth(), 1200);
  }, [gateway, goTo, goAfterAuth]);

  const handleSkipAuth = useCallback(() => {
    goAfterAuth();
  }, [goAfterAuth]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% -10%, oklch(0.5 0.18 250 / 0.14), transparent 58%)',
        }}
      />
      <div className="relative flex flex-col items-center justify-center w-full h-full p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="w-full max-w-lg rounded-2xl border border-border bg-card/90 shadow-2xl backdrop-blur-xl"
        >
          <div className="px-6 py-6 sm:px-8 sm:py-7">
            {step !== 'welcome' && step !== 'detecting' && (
              <motion.div
                className="mb-6"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
              >
                <PhaseBar step={step} />
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {step === 'welcome' && (
                <PageTransition key="welcome" direction={direction}>
                  <WelcomeStep onContinue={() => runDetection()} />
                </PageTransition>
              )}

              {step === 'detecting' && (
                <PageTransition key="detecting" direction={direction}>
                  <DetectingStep />
                </PageTransition>
              )}

              {step === 'ready' && (
                <PageTransition key="ready" direction={direction}>
                  <ReadyStep authInfo={authInfo} />
                </PageTransition>
              )}

              {step === 'choose' && (
                <PageTransition key="choose" direction={direction}>
                  <ChooseStep
                    onChoice={handleChoice}
                    onSkip={handleSkipAuth}
                    detect={detectResult}
                  />
                </PageTransition>
              )}

              {step === 'auth' && choice && (
                <PageTransition key="auth" direction={direction}>
                  <AuthStep
                    choice={choice}
                    gateway={gateway}
                    onSuccess={handleAuthSuccess}
                    onBack={() => goTo('choose', -1)}
                    onSkip={handleSkipAuth}
                  />
                </PageTransition>
              )}

              {step === 'auth-success' && (
                <PageTransition key="auth-success" direction={direction}>
                  <AuthSuccessStep authInfo={authInfo} />
                </PageTransition>
              )}

              {step === 'profile' && (
                <PageTransition key="profile" direction={direction}>
                  <ProfileStep
                    name={profileName}
                    timezone={profileTimezone}
                    onNameChange={setProfileName}
                    onTimezoneChange={setProfileTimezone}
                    onContinue={goAfterProfile}
                    onSkip={goAfterProfile}
                  />
                </PageTransition>
              )}

              {step === 'channels' && (
                <PageTransition key="channels" direction={direction}>
                  <ChannelsStep
                    gateway={gateway}
                    onContinue={goAfterChannels}
                    onSkip={goAfterChannels}
                    onBack={() => goTo('profile', -1)}
                  />
                </PageTransition>
              )}

              {step === 'permissions' && (
                <PageTransition key="permissions" direction={direction}>
                  <PermissionsStep
                    onContinue={goAfterPermissions}
                    onBack={() => goTo('channels', -1)}
                  />
                </PageTransition>
              )}

              {step === 'tour' && (
                <PageTransition key="tour" direction={direction}>
                  <TourStep
                    onContinue={goAfterTour}
                    onBack={() => goTo(isMac ? 'permissions' : 'channels', -1)}
                  />
                </PageTransition>
              )}

              {step === 'launch' && (
                <PageTransition key="launch" direction={direction}>
                  <LaunchStep
                    name={profileName}
                    onLaunch={() => onComplete(true)}
                    onSkip={() => onComplete(false)}
                  />
                </PageTransition>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Step Components ─────────────────────────────────────────────────

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <motion.div
        className="relative"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse" style={{ width: 120, height: 120, margin: '-10px' }} />
        <img src={dorabotComputerImg} alt="dorabot" className="relative w-24 h-24 dorabot-alive" />
      </motion.div>

      <motion.div
        className="text-center space-y-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h1 className="text-xl font-bold text-foreground">Welcome to dorabot</h1>
        <p className="text-sm text-muted-foreground">
          Your personal AI assistant that can{' '}
          <FlipWords
            words={['code for you', 'manage your inbox', 'automate tasks', 'browse the web', 'remember everything']}
            duration={2500}
            className="text-primary font-semibold"
          />
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="w-full space-y-3"
      >
        <Button
          className="w-full h-10 text-sm font-medium gap-2"
          onClick={onContinue}
        >
          Get started
          <ArrowRight className="w-4 h-4" />
        </Button>
        <div className="text-center text-[10px] text-muted-foreground">
          Takes about 2 minutes
        </div>
      </motion.div>
    </div>
  );
}

function DetectingStep() {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="relative w-20 h-20 mx-auto">
        <div className="absolute inset-0 rounded-full bg-success/30 blur-xl animate-pulse" />
        <img src={dorabotComputerImg} alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
      </div>
      <Loader2 className="w-5 h-5 text-primary animate-spin" />
      <TextGenerateEffect
        words="Checking for existing credentials..."
        className="text-[11px] text-muted-foreground text-center"
      />
    </div>
  );
}

function ReadyStep({ authInfo }: { authInfo: { method?: string; identity?: string } | null }) {
  const label = authInfo?.identity || (authInfo?.method === 'oauth' ? 'Claude subscription' : 'API key');
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <motion.div
        className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <Check className="w-6 h-6 text-success" />
      </motion.div>
      <div className="text-sm font-semibold text-foreground">connected via {label}</div>
    </div>
  );
}

function DetectionBadge({ type }: { type: 'logged-in' | 'installed' }) {
  if (type === 'logged-in') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-success/15 text-success">
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        logged in
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-warning/15 text-warning">
      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
      installed
    </span>
  );
}

function ChooseStep({
  onChoice,
  onSkip,
  detect,
}: {
  onChoice: (c: ProviderChoice) => void;
  onSkip: () => void;
  detect: DetectResult | null;
}) {
  const claudeLoggedIn = detect?.claude.hasOAuth || detect?.claude.hasApiKey;
  const claudeInstalled = detect?.claude.installed;
  const codexLoggedIn = detect?.codex.hasAuth;

  return (
    <div className="space-y-5">
      <div className="text-center space-y-3">
        <div className="relative w-20 h-20 mx-auto">
          <div className="absolute inset-0 rounded-full bg-success/30 blur-xl animate-pulse" />
          <img src={dorabotComputerImg} alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground">Connect your AI</h1>
          <p className="text-[11px] text-muted-foreground mt-1">Dorabot uses your existing Claude or OpenAI account.</p>
        </div>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => onChoice({ provider: 'claude', method: 'oauth' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <img src="./claude-icon.svg" alt="Claude" className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Claude Code</span>
              {claudeLoggedIn && <DetectionBadge type="logged-in" />}
              {!claudeLoggedIn && claudeInstalled && <DetectionBadge type="installed" />}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your Claude subscription or Anthropic API key</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-2 transition-colors" />
        </button>

        <button
          onClick={() => onChoice({ provider: 'codex', method: 'oauth' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <img src="./openai-icon.svg" alt="OpenAI" className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Sign in with ChatGPT</span>
              {codexLoggedIn && <DetectionBadge type="logged-in" />}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your OpenAI account (ChatGPT Plus required)</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-2 transition-colors" />
        </button>

        <button
          onClick={() => onChoice({ provider: 'codex', method: 'apikey' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <img src="./openai-icon.svg" alt="OpenAI" className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground">OpenAI API Key</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your own OpenAI API key with Codex</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-2 transition-colors" />
        </button>
      </div>

      <div className="text-center space-y-1">
        <div className="text-[10px] text-muted-foreground">You can switch providers anytime in Settings.</div>
        <button
          onClick={onSkip}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

function AuthStep({
  choice,
  gateway,
  onSuccess,
  onBack,
  onSkip,
}: {
  choice: ProviderChoice;
  gateway: ReturnType<typeof useGateway>;
  onSuccess: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="w-3 h-3" />
        back
      </button>

      <Card className="bg-card/80 backdrop-blur border-border">
        <CardContent className="p-5">
          <ProviderSetup
            provider={choice.provider}
            preferredMethod={choice.method}
            gateway={gateway}
            onSuccess={onSuccess}
            onBack={onBack}
          />

          <div className="text-center mt-4 pt-3 border-t border-border">
            <button
              onClick={onSkip}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              skip for now
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthSuccessStep({ authInfo }: { authInfo: { method?: string; identity?: string } | null }) {
  const methodLabel = authInfo?.method === 'oauth'
    ? 'Claude subscription'
    : authInfo?.method === 'api_key'
    ? 'API key'
    : null;

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <motion.div
        className="w-14 h-14 rounded-full bg-success/20 flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <Check className="w-7 h-7 text-success" />
      </motion.div>
      <div className="text-sm font-semibold text-foreground">connected!</div>
      {methodLabel && (
        <div className="text-[10px] text-muted-foreground">via {methodLabel}</div>
      )}
    </div>
  );
}

// ─── Profile Step ─────────────────────────────────────────────────

function ProfileStep({
  name,
  timezone,
  onNameChange,
  onTimezoneChange,
  onContinue,
  onSkip,
}: {
  name: string;
  timezone: string;
  onNameChange: (v: string) => void;
  onTimezoneChange: (v: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus name input
    setTimeout(() => nameRef.current?.focus(), 300);
  }, []);

  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <motion.div
          className="w-12 h-12 mx-auto rounded-full bg-primary/10 flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <User className="w-6 h-6 text-primary" />
        </motion.div>
        <h2 className="text-base font-semibold text-foreground">a little about you</h2>
        <p className="text-[11px] text-muted-foreground">helps dorabot personalize your experience</p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-foreground">what should i call you?</label>
          <Input
            ref={nameRef}
            placeholder="your name"
            value={name}
            onChange={e => onNameChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onContinue()}
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-muted-foreground" />
            timezone
          </label>
          <div className="flex items-center gap-2">
            <Input
              value={timezone}
              onChange={e => onTimezoneChange(e.target.value)}
              className="h-9 text-sm flex-1"
            />
            <span className="text-[9px] text-muted-foreground shrink-0">auto-detected</span>
          </div>
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <Button
          className="w-full h-9 text-xs font-medium gap-2"
          onClick={onContinue}
        >
          continue
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <button
          onClick={onSkip}
          className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          skip for now
        </button>
      </div>
    </div>
  );
}

// ─── Channels Step ────────────────────────────────────────────────

function ChannelsStep({
  gateway,
  onContinue,
  onSkip,
  onBack,
}: {
  gateway: ReturnType<typeof useGateway>;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [activeChannel, setActiveChannel] = useState<'none' | 'telegram' | 'whatsapp'>('none');

  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <motion.div
          className="w-12 h-12 mx-auto rounded-full bg-primary/10 flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <MessageSquare className="w-6 h-6 text-primary" />
        </motion.div>
        <h2 className="text-base font-semibold text-foreground">connect your channels</h2>
        <p className="text-[11px] text-muted-foreground">chat with dorabot from your favorite apps (optional)</p>
      </div>

      {activeChannel === 'none' && (
        <div className="space-y-2">
          <ChannelCard
            icon={<img src={telegramImg} className="w-5 h-5" alt="" />}
            name="Telegram"
            description="connect via a Telegram bot"
            status={gateway.telegramLinkStatus === 'linked' ? 'connected' : undefined}
            onClick={() => setActiveChannel('telegram')}
          />
          <ChannelCard
            icon={<img src={whatsappImg} className="w-5 h-5" alt="" />}
            name="WhatsApp"
            description="link your WhatsApp account"
            status={gateway.whatsappLoginStatus === 'connected' ? 'connected' : undefined}
            onClick={() => setActiveChannel('whatsapp')}
          />
        </div>
      )}

      {activeChannel === 'telegram' && (
        <InlineTelegramSetup
          gateway={gateway}
          onBack={() => setActiveChannel('none')}
          onDone={() => setActiveChannel('none')}
        />
      )}

      {activeChannel === 'whatsapp' && (
        <InlineWhatsAppSetup
          gateway={gateway}
          onBack={() => setActiveChannel('none')}
          onDone={() => setActiveChannel('none')}
        />
      )}

      <div className="space-y-2 pt-1">
        <Button
          className="w-full h-9 text-xs font-medium gap-2"
          onClick={onContinue}
        >
          continue
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="w-3 h-3" /> back
          </button>
          <button
            onClick={onSkip}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelCard({
  icon,
  name,
  description,
  status,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  status?: 'connected';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left group"
    >
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">{name}</span>
          {status === 'connected' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-success/15 text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              connected
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{description}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
    </button>
  );
}

function InlineTelegramSetup({
  gateway,
  onBack,
  onDone,
}: {
  gateway: ReturnType<typeof useGateway>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    gateway.telegramCheckStatus().catch(() => {});
  }, [gateway.telegramCheckStatus]);

  const handleLink = async () => {
    if (!tokenInput.trim()) return;
    setLocalError(null);
    setLinking(true);
    try {
      const res = await gateway.telegramLink(tokenInput.trim());
      if (res.success) {
        setTokenInput('');
        onDone();
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  };

  if (gateway.telegramLinkStatus === 'linked') {
    return (
      <Card className="bg-card/80 backdrop-blur border-success/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span className="text-xs font-semibold">Telegram linked</span>
            {gateway.telegramBotUsername && (
              <span className="text-[11px] text-muted-foreground">@{gateway.telegramBotUsername}</span>
            )}
          </div>
          <Button variant="ghost" size="sm" className="mt-2 h-7 text-[11px]" onClick={onDone}>
            done
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/80 backdrop-blur border-border">
      <CardContent className="p-4 space-y-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3 h-3" /> back to channels
        </button>

        <div className="flex items-center gap-2">
          <img src={telegramImg} className="w-5 h-5" alt="" />
          <span className="text-sm font-semibold">set up Telegram</span>
        </div>

        <div className="bg-secondary/50 rounded-lg p-3 space-y-1.5">
          <div className="text-[11px] font-semibold">get a bot token from BotFather</div>
          <ol className="text-[10px] text-muted-foreground space-y-1 list-decimal list-inside">
            <li>open Telegram and search for <code className="text-foreground">@BotFather</code></li>
            <li>send <code className="text-foreground">/newbot</code></li>
            <li>choose a name and username (must end in <code className="text-foreground">bot</code>)</li>
            <li>copy the API token below</li>
          </ol>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v..."
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLink()}
              className="h-8 text-xs pr-8 font-mono"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          {localError && <div className="text-[11px] text-destructive">{localError}</div>}

          <Button
            size="sm"
            className="h-8 text-xs px-4 w-full"
            onClick={handleLink}
            disabled={!tokenInput.trim() || linking}
          >
            {linking ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            link Telegram
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InlineWhatsAppSetup({
  gateway,
  onBack,
  onDone,
}: {
  gateway: ReturnType<typeof useGateway>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    gateway.whatsappCheckStatus().catch(() => {});
  }, [gateway.whatsappCheckStatus]);

  const handleLogin = async () => {
    setLocalError(null);
    try {
      const res = await gateway.whatsappLogin();
      if (!res.success) setLocalError(res.error || 'login failed');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  };

  const loginStatus = gateway.whatsappLoginStatus;
  const qr = gateway.whatsappQr;

  if (loginStatus === 'connected') {
    return (
      <Card className="bg-card/80 backdrop-blur border-success/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span className="text-xs font-semibold">WhatsApp linked</span>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 h-7 text-[11px]" onClick={onDone}>
            done
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loginStatus === 'connecting' || loginStatus === 'qr_ready') {
    return (
      <Card className="bg-card/80 backdrop-blur border-border">
        <CardContent className="p-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ChevronLeft className="w-3 h-3" /> back to channels
          </button>

          <div className="flex flex-col items-center gap-3">
            {qr ? (
              <>
                <div className="bg-white p-3 rounded-lg">
                  <QRCodeSVG value={qr} size={180} />
                </div>
                <div className="text-center space-y-1">
                  <div className="text-xs font-semibold">scan with WhatsApp</div>
                  <div className="text-[10px] text-muted-foreground">
                    open WhatsApp, settings, linked devices, link a device
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 py-8">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">connecting to WhatsApp...</span>
              </div>
            )}
            {localError && <div className="text-[11px] text-destructive">{localError}</div>}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/80 backdrop-blur border-border">
      <CardContent className="p-4 space-y-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3 h-3" /> back to channels
        </button>

        <div className="flex items-center gap-2">
          <img src={whatsappImg} className="w-5 h-5" alt="" />
          <span className="text-sm font-semibold">set up WhatsApp</span>
        </div>

        <p className="text-[10px] text-muted-foreground">
          link your WhatsApp account by scanning a QR code
        </p>

        {localError && <div className="text-[11px] text-destructive">{localError}</div>}

        <Button size="sm" className="h-8 text-xs px-4 w-full" onClick={handleLogin}>
          <Smartphone className="w-3 h-3 mr-1.5" />
          link WhatsApp
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Permissions Step ─────────────────────────────────────────────

const MAC_PERMISSIONS = [
  {
    id: 'screen-recording',
    label: 'Screen Recording',
    description: 'lets dorabot take screenshots of your screen',
    icon: Monitor,
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    description: 'lets dorabot manage windows, control apps, and automate your Mac',
    icon: Hand,
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  },
];

function PermissionsStep({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  const openSettings = (url: string) => {
    const api = (window as any).electronAPI;
    if (api?.openExternal) api.openExternal(url);
  };

  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <motion.div
          className="w-12 h-12 mx-auto rounded-full bg-primary/10 flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <Monitor className="w-6 h-6 text-primary" />
        </motion.div>
        <h2 className="text-base font-semibold text-foreground">macOS permissions</h2>
        <p className="text-[11px] text-muted-foreground">grant these so dorabot can use all its tools</p>
      </div>

      <div className="space-y-2">
        {MAC_PERMISSIONS.map(perm => (
          <button
            key={perm.id}
            onClick={() => openSettings(perm.settingsUrl)}
            className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <perm.icon className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">{perm.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{perm.description}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-1 transition-colors" />
          </button>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 text-center">
        add <strong>dorabot</strong> (or your terminal) in each section of System Settings &gt; Privacy &amp; Security
      </div>

      <div className="space-y-2">
        <Button className="w-full h-9 text-xs font-medium gap-2" onClick={onContinue}>
          continue
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="w-3 h-3" /> back
          </button>
          <button
            onClick={onContinue}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            i'll do this later
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Feature Tour Step ────────────────────────────────────────────

const TOUR_FEATURES = [
  {
    icon: MessageSquare,
    title: 'Chat',
    description: 'Talk to your AI, run tasks, and ask questions.',
    color: 'text-primary',
  },
  {
    icon: Sparkles,
    title: 'Skills',
    description: 'Install new capabilities for your workflows.',
    color: 'text-foreground',
  },
  {
    icon: Zap,
    title: 'Automations',
    description: 'Run recurring tasks on a schedule.',
    color: 'text-warning',
  },
  {
    icon: LayoutGrid,
    title: 'Goals',
    description: 'Track goals and tasks, approve plans, and execute.',
    color: 'text-success',
  },
  {
    icon: Brain,
    title: 'Memory',
    description: 'Keep persistent context across sessions.',
    color: 'text-muted-foreground',
  },
];

function TourStep({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <h2 className="text-base font-semibold text-foreground">what dorabot can do</h2>
        <p className="text-[11px] text-muted-foreground">a quick look at the key features</p>
      </div>

      <div className="space-y-1.5">
        {TOUR_FEATURES.map((feature, i) => (
          <motion.div
            key={feature.title}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-card/60 backdrop-blur border border-border/50"
            initial={{ opacity: 0, x: -15 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08, duration: 0.25 }}
          >
            <div className={`w-7 h-7 rounded-md bg-card flex items-center justify-center shrink-0 ${feature.color}`}>
              <feature.icon className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">{feature.title}</div>
              <div className="text-[10px] text-muted-foreground">{feature.description}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="space-y-2 pt-1">
        <Button className="w-full h-9 text-xs font-medium gap-2" onClick={onContinue}>
          almost done
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <button
          onClick={onBack}
          className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
        >
          <ChevronLeft className="w-3 h-3" /> back
        </button>
      </div>
    </div>
  );
}

// ─── Launch Step ──────────────────────────────────────────────────

function LaunchStep({
  name,
  onLaunch,
  onSkip,
}: {
  name: string;
  onLaunch: () => void;
  onSkip: () => void;
}) {
  const greeting = name ? `hey ${name}, ` : '';

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <motion.div
        className="relative"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="absolute inset-0 rounded-full bg-success/30 blur-2xl animate-pulse" style={{ width: 100, height: 100, margin: '-10px' }} />
        <img src={dorabotImg} alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
      </motion.div>

      <motion.div
        className="text-center space-y-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="text-base font-semibold text-foreground">you're all set!</h2>
        <p className="text-[11px] text-muted-foreground max-w-[260px]">
          {greeting}let's finish personalizing your experience. i'll ask you a few quick questions to learn how you like to work.
        </p>
      </motion.div>

      <motion.div
        className="w-full space-y-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Button
          className="w-full h-10 text-sm font-medium gap-2"
          onClick={onLaunch}
        >
          <Sparkles className="w-4 h-4" />
          personalize dorabot
        </Button>
        <button
          onClick={onSkip}
          className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          skip, i'll explore on my own
        </button>
      </motion.div>
    </div>
  );
}
