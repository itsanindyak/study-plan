import { useState } from 'react';
import { useSettingsStore, selectIsConfigured } from '@/store/useSettingsStore';
import { kvClient } from '../sync/kvClient';

type Status = { kind: 'idle' | 'ok' | 'err'; text: string };

/**
 * Cloud sync settings. Handles test / connect / disconnect. On connect
 * the cloud pulls down into the local stores (via the sync orchestrator
 * hook in the parent), so this component only deals with the credential
 * side of the flow.
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const token = useSettingsStore((s) => s.token);
  const setToken = useSettingsStore((s) => s.setToken);
  const clear = useSettingsStore((s) => s.clear);
  const configured = useSettingsStore(selectIsConfigured);

  const [draft, setDraft] = useState(token);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const cfg = () => ({
    token: useSettingsStore.getState().token,
    workerUrl: useSettingsStore.getState().workerUrl,
  });

  const test = async () => {
    if (!draft.trim()) {
      setStatus({ kind: 'err', text: 'paste your access token first' });
      return;
    }
    setStatus({ kind: 'idle', text: 'testing…' });
    setBusy(true);
    const saved = cfg().token;
    setToken(draft);
    try {
      await kvClient.ping(cfg());
      setStatus({ kind: 'ok', text: 'connection works ✓' });
    } catch (err) {
      setStatus({ kind: 'err', text: 'failed: ' + (err as Error).message });
    } finally {
      // restore so connect is the explicit commit
      if (!configured) setToken(saved);
      else useSettingsStore.setState({ token: saved });
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!draft.trim()) {
      setStatus({ kind: 'err', text: 'paste your access token first' });
      return;
    }
    setStatus({ kind: 'idle', text: 'connecting…' });
    setBusy(true);
    setToken(draft);
    try {
      // small delay to let the orchestrator hook react
      await new Promise((r) => setTimeout(r, 200));
      setStatus({ kind: 'ok', text: 'connected ✓' });
      setTimeout(onClose, 700);
    } catch (err) {
      setStatus({ kind: 'err', text: 'failed: ' + (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    clear();
    setDraft('');
    setStatus({ kind: 'idle', text: 'cloud sync disabled — using local only' });
  };

  return (
    <div
      className="popup-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="popup" role="dialog" aria-modal="true" style={{ maxWidth: 380 }}>
        <div className="popup-head">
          <div
            className="popup-swatch"
            style={{ background: 'linear-gradient(135deg, #5b8def, #2b5fc7)' }}
          />
          <div className="popup-title">
            <h3>cloud sync</h3>
            <div className="pt-sub">access your plan on every device</div>
          </div>
          <button className="popup-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="settings-body">
          <p className="settings-intro">
            paste your access token to link this device to your plan. the token stays in this
            browser and is only sent as a request header to the worker.
          </p>

          <label className="settings-label">
            <span>access token</span>
            <input
              type="password"
              value={draft}
              placeholder="paste your token"
              autoComplete="new-password"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>

          <div className={`settings-status ${status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : ''}`}>
            {status.text}
          </div>

          <div className="settings-actions">
            <button
              className="settings-btn settings-btn-ghost"
              onClick={test}
              disabled={busy}
            >
              test
            </button>
            <button
              className="settings-btn settings-btn-primary"
              onClick={connect}
              disabled={busy}
            >
              connect
            </button>
          </div>

          {configured && (
            <button className="settings-disconnect" onClick={disconnect}>
              disable cloud sync
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
