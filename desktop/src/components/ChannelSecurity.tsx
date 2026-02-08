import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';

type Props = {
  channel: 'whatsapp' | 'telegram';
  gateway: ReturnType<typeof useGateway>;
};

export function ChannelSecurity({ channel, gateway }: Props) {
  const [senders, setSenders] = useState<string[]>([]);
  const [dmPolicy, setDmPolicy] = useState<string>('open');
  const [groupPolicy, setGroupPolicy] = useState<string>('open');
  const [newSender, setNewSender] = useState('');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sendersResult, configResult] = await Promise.all([
        gateway.getSecuritySenders(),
        gateway.rpc('config.get') as Promise<any>,
      ]);
      setSenders(sendersResult[channel] || []);
      const ch = configResult?.channels?.[channel];
      if (ch?.dmPolicy) setDmPolicy(ch.dmPolicy);
      if (ch?.groupPolicy) setGroupPolicy(ch.groupPolicy);
    } catch (err) {
      console.error('failed to load security config:', err);
    }
  }, [channel, gateway]);

  useEffect(() => { load(); }, [load]);

  const handleAddSender = async () => {
    const id = newSender.trim();
    if (!id) return;
    await gateway.addSender(channel, id);
    setNewSender('');
    await load();
  };

  const handleRemoveSender = async (id: string) => {
    await gateway.removeSender(channel, id);
    await load();
  };

  const handleDmPolicy = async (value: string) => {
    setDmPolicy(value);
    await gateway.setChannelPolicy(`channels.${channel}.dmPolicy`, value);
  };

  const handleGroupPolicy = async (value: string) => {
    setGroupPolicy(value);
    await gateway.setChannelPolicy(`channels.${channel}.groupPolicy`, value);
  };

  const handleRestart = async () => {
    await gateway.restartChannel(channel);
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div
        className="card-title"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span>security</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {senders.length > 0 ? `${senders.length} allowed` : 'open to all'}
          {' '}{expanded ? '▾' : '▸'}
        </span>
      </div>

      {expanded && (
        <div className="card-body" style={{ paddingTop: 8 }}>
          <div className="policy-row">
            <span className="policy-label">dm policy</span>
            <select className="policy-select" value={dmPolicy} onChange={e => handleDmPolicy(e.target.value)}>
              <option value="open">open</option>
              <option value="allowlist">allowlist</option>
            </select>
          </div>

          <div className="policy-row">
            <span className="policy-label">group policy</span>
            <select className="policy-select" value={groupPolicy} onChange={e => handleGroupPolicy(e.target.value)}>
              <option value="open">open</option>
              <option value="allowlist">allowlist</option>
              <option value="disabled">disabled</option>
            </select>
          </div>

          <div style={{ marginTop: 10 }}>
            <span className="policy-label">allowed senders</span>
            {senders.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                no sender restrictions — anyone can message
              </div>
            )}
            <div className="sender-list">
              {senders.map(id => (
                <div key={id} className="sender-item">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{id}</span>
                  <button className="sender-remove" onClick={() => handleRemoveSender(id)}>×</button>
                </div>
              ))}
            </div>
            <div className="sender-add-row">
              <input
                className="policy-select"
                style={{ flex: 1 }}
                placeholder="sender id"
                value={newSender}
                onChange={e => setNewSender(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSender()}
              />
              <button
                className="sender-add-btn"
                onClick={handleAddSender}
                disabled={!newSender.trim()}
              >
                add
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="sender-add-btn" onClick={handleRestart}>restart channel</button>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              policy changes apply after restart
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
