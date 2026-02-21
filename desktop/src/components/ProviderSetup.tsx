import { useState, useCallback, useRef, useEffect } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ExternalLink, Loader2, AlertCircle, ClipboardPaste } from 'lucide-react';

type Props = {
  provider: 'claude' | 'codex' | 'openai-compatible';
  gateway: ReturnType<typeof useGateway>;
  onSuccess: () => void;
  onBack?: () => void;
  compact?: boolean; // for settings inline mode
  preferredMethod?: 'oauth' | 'apikey'; // pre-selected method from onboarding
};

export function ProviderSetup({ provider, gateway, onSuccess, onBack, compact, preferredMethod }: Props) {
  if (provider === 'claude') {
    return <ClaudeSetup gateway={gateway} onSuccess={onSuccess} onBack={onBack} compact={compact} preferredMethod={preferredMethod} />;
  }
  if (provider === 'codex') {
    return <CodexSetup gateway={gateway} onSuccess={onSuccess} onBack={onBack} compact={compact} preferredMethod={preferredMethod} />;
  }
  return <OpenAICompatibleSetup gateway={gateway} onSuccess={onSuccess} onBack={onBack} compact={compact} preferredMethod="apikey" />;
}

type ClaudeProps = Omit<Props, 'provider'> & { preferredMethod?: 'oauth' | 'apikey' };

function ClaudeSetup({ gateway, onSuccess, onBack, compact, preferredMethod }: ClaudeProps) {
  const [mode, setMode] = useState<'choose' | 'oauth-paste' | 'apikey'>(
    preferredMethod === 'apikey' ? 'apikey' : 'choose'
  );
  const [apiKey, setApiKey] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  // Auto-start OAuth if preferredMethod is 'oauth'
  useEffect(() => {
    if (preferredMethod === 'oauth' && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startOAuthFlow();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredMethod]);

  const startOAuthFlow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { authUrl } = await gateway.startOAuth('claude');
      setMode('oauth-paste');
      setLoading(false);

      // Open browser with the auth URL
      if (authUrl) {
        (window as any).electronAPI?.openExternal?.(authUrl) || window.open(authUrl, '_blank');
      }
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
    }
  }, [gateway]);

  const submitAuthCode = useCallback(async () => {
    const code = authCode.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      // The auth code is the "code#state" string from the callback page
      // We pass it as loginId to completeOAuth which feeds it to completeOAuthLogin
      const res = await gateway.completeOAuth('claude', code);
      if (res.authenticated) {
        onSuccess();
      } else {
        setError(res.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }, [authCode, gateway, onSuccess]);

  const submitApiKey = useCallback(async () => {
    if (!apiKey.startsWith('sk-ant-') || apiKey.length < 20) return;
    setLoading(true);
    setError(null);
    try {
      const res = await gateway.authWithApiKey('claude', apiKey);
      if (res.authenticated) {
        onSuccess();
      } else {
        setError(res.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }, [apiKey, gateway, onSuccess]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setAuthCode(text.trim());
    } catch {
      // clipboard access denied
    }
  }, []);

  return (
    <div className="space-y-4">
      {!compact && onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" />
          back
        </button>
      )}

      {!compact && (
        <div className="text-center space-y-1">
          <div className="text-sm font-semibold">Claude Code (Anthropic)</div>
          <div className="text-[11px] text-muted-foreground">
            {mode === 'apikey' ? 'enter your Anthropic API key' :
             mode === 'oauth-paste' ? 'paste the auth code from your browser' :
             'use your Claude subscription or API key'}
          </div>
        </div>
      )}

      {mode === 'oauth-paste' ? (
        <div className="space-y-3">
          <div className="text-[10px] text-muted-foreground text-center">
            sign in with your Claude account in the browser, then paste the code shown on the callback page
          </div>

          <div className="flex gap-1.5">
            <Input
              type="text"
              placeholder="paste auth code here..."
              value={authCode}
              onChange={e => { setAuthCode(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitAuthCode()}
              className="h-8 text-[11px] font-mono flex-1"
              disabled={loading}
              autoFocus
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={pasteFromClipboard}
              disabled={loading}
              title="paste from clipboard"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </Button>
          </div>

          <Button
            size="sm"
            className="h-7 text-[11px] w-full"
            onClick={submitAuthCode}
            disabled={!authCode.trim() || loading}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
            {loading ? 'connecting...' : 'connect'}
          </Button>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            or
            <div className="flex-1 h-px bg-border" />
          </div>

          <button
            onClick={() => { setMode('choose'); setError(null); setAuthCode(''); }}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-center"
          >
            go back
          </button>
        </div>
      ) : mode === 'apikey' ? (
        <>
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitApiKey()}
              className="h-8 text-[11px] font-mono"
              disabled={loading}
              autoFocus
            />
            <Button
              size="sm"
              className="h-7 text-[11px] w-full"
              onClick={submitApiKey}
              disabled={!apiKey.startsWith('sk-ant-') || apiKey.length < 20 || loading}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
              {loading ? 'connecting...' : 'connect'}
            </Button>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>get your key at</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const url = 'https://console.anthropic.com/settings/keys';
                (window as any).electronAPI?.openExternal?.(url) || window.open(url, '_blank');
              }}
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              console.anthropic.com
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>

          {!compact && (
            <button
              onClick={() => { setMode('choose'); setError(null); }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-center"
            >
              or use Claude subscription instead
            </button>
          )}
        </>
      ) : (
        // Choose mode - OAuth button + API key fallback
        <>
          <Button
            size="sm"
            className="h-8 text-[11px] w-full"
            onClick={startOAuthFlow}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
            use Claude subscription
          </Button>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            or use an API key
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="space-y-2">
            <Input
              type="password"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitApiKey()}
              className="h-8 text-[11px] font-mono"
              disabled={loading}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] w-full"
              onClick={submitApiKey}
              disabled={!apiKey.startsWith('sk-ant-') || apiKey.length < 20 || loading}
            >
              connect with API key
            </Button>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-[10px] text-destructive">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      )}

      {!compact && mode !== 'apikey' && (
        <div className="text-[10px] text-muted-foreground text-center">
          stored locally, never leaves your machine
        </div>
      )}
    </div>
  );
}

type CodexProps = Omit<Props, 'provider'> & { preferredMethod?: 'oauth' | 'apikey' };

function CodexSetup({ gateway, onSuccess, onBack, compact, preferredMethod }: CodexProps) {
  // If preferredMethod is 'apikey', start directly in apikey mode
  const [mode, setMode] = useState<'choose' | 'oauth-waiting' | 'apikey'>(
    preferredMethod === 'apikey' ? 'apikey' : 'choose'
  );
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Auto-start OAuth if preferredMethod is 'oauth'
  useEffect(() => {
    if (preferredMethod === 'oauth' && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startOAuth();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredMethod]);

  const startOAuth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Check if codex binary is available
      const check = await gateway.checkProvider('codex');
      if (!check.ready && check.reason?.includes('binary not found')) {
        setError('Codex CLI not installed. Run: npm i -g @openai/codex');
        setLoading(false);
        return;
      }

      const { authUrl, loginId } = await gateway.startOAuth('codex');
      loginIdRef.current = loginId;
      setMode('oauth-waiting');

      // Open browser
      (window as any).electronAPI?.openExternal?.(authUrl) || window.open(authUrl, '_blank');

      // Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const res = await gateway.completeOAuth('codex', loginId);
          if (res.authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            pollRef.current = null;
            setLoading(false);
            onSuccess();
          }
        } catch {
          // still waiting
        }
      }, 2000);

      // Timeout after 120s
      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setLoading(false);
        setMode('choose');
        setError('Login timed out. Please try again.');
      }, 120_000);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'OAuth failed');
    }
  }, [gateway, onSuccess]);

  const submitApiKey = useCallback(async () => {
    if (!apiKey.startsWith('sk-') || apiKey.length < 20) return;
    setLoading(true);
    setError(null);
    try {
      const res = await gateway.authWithApiKey('codex', apiKey);
      if (res.authenticated) {
        onSuccess();
      } else {
        setError(res.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }, [apiKey, gateway, onSuccess]);

  const cancelOAuth = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    setLoading(false);
    setMode('choose');
  }, []);

  return (
    <div className="space-y-4">
      {!compact && onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" />
          back
        </button>
      )}

      {!compact && (
        <div className="text-center space-y-1">
          <div className="text-sm font-semibold">OpenAI (Codex)</div>
          <div className="text-[11px] text-muted-foreground">
            {mode === 'apikey' ? 'enter your OpenAI API key' : 'sign in with ChatGPT or use an API key'}
          </div>
        </div>
      )}

      {mode === 'oauth-waiting' ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <div className="text-[11px] text-muted-foreground">waiting for login in browser...</div>
          <div className="text-[10px] text-muted-foreground">complete the sign-in in your browser</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px]"
            onClick={cancelOAuth}
          >
            cancel
          </Button>
        </div>
      ) : mode === 'apikey' ? (
        // API key only mode (when user chose "OpenAI API Key" in onboarding)
        <>
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitApiKey()}
              className="h-8 text-[11px] font-mono"
              disabled={loading}
              autoFocus
            />
            <Button
              size="sm"
              className="h-7 text-[11px] w-full"
              onClick={submitApiKey}
              disabled={!apiKey.startsWith('sk-') || apiKey.length < 20 || loading}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
              {loading ? 'connecting...' : 'connect'}
            </Button>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>get your key at</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const url = 'https://platform.openai.com/api-keys';
                (window as any).electronAPI?.openExternal?.(url) || window.open(url, '_blank');
              }}
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              platform.openai.com
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>

          {!compact && (
            <button
              onClick={() => setMode('choose')}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-center"
            >
              or sign in with ChatGPT instead
            </button>
          )}
        </>
      ) : (
        // Choose mode - OAuth button + API key fallback
        <>
          <Button
            size="sm"
            className="h-8 text-[11px] w-full"
            onClick={startOAuth}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
            sign in with ChatGPT
          </Button>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            or use an API key
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="space-y-2">
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitApiKey()}
              className="h-8 text-[11px] font-mono"
              disabled={loading}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] w-full"
              onClick={submitApiKey}
              disabled={!apiKey.startsWith('sk-') || apiKey.length < 20 || loading}
            >
              connect with API key
            </Button>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-[10px] text-destructive">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      )}

      {!compact && mode !== 'apikey' && (
        <div className="text-[10px] text-muted-foreground text-center">
          ChatGPT Plus subscription required for OAuth
        </div>
      )}
    </div>
  );
}

type OpenAICompatibleProps = Omit<Props, 'provider'>;

function OpenAICompatibleSetup({ gateway, onSuccess, onBack, compact }: OpenAICompatibleProps) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitApiKey = useCallback(async () => {
    if (!apiKey.startsWith('sk-') || apiKey.length < 20) return;
    setLoading(true);
    setError(null);
    try {
      const res = await gateway.authWithApiKey('openai-compatible', apiKey);
      if (res.authenticated) {
        onSuccess();
      } else {
        setError(res.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }, [apiKey, gateway, onSuccess]);

  return (
    <div className="space-y-4">
      {!compact && onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" />
          back
        </button>
      )}

      {!compact && (
        <div className="text-center space-y-1">
          <div className="text-sm font-semibold">OpenAI-Compatible</div>
          <div className="text-[11px] text-muted-foreground">
            enter an API key only if your endpoint requires authentication
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Input
          type="password"
          placeholder="sk-... (optional for local endpoints)"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setError(null); }}
          onKeyDown={e => e.key === 'Enter' && submitApiKey()}
          className="h-8 text-[11px] font-mono"
          disabled={loading}
          autoFocus
        />
        <Button
          size="sm"
          className="h-7 text-[11px] w-full"
          onClick={submitApiKey}
          disabled={!apiKey.startsWith('sk-') || apiKey.length < 20 || loading}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
          {loading ? 'connecting...' : 'save API key'}
        </Button>
      </div>

      <div className="text-[10px] text-muted-foreground text-center">
        if your local endpoint does not require a key, set base URL in Settings and skip this
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-[10px] text-destructive">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
