// Shared digest email controls — used by both the deadline-card popup and the
// settings modal's digest tab. State lives in useDigestStore (worker KV).

import { useEffect, useState, type FormEvent } from 'react';
import { kvClient } from '@/features/sync/kvClient';
import { selectCloudConfig, selectIsConfigured, useSettingsStore } from '@/store/useSettingsStore';
import { fmtTzOffset, useDigestStore } from '@/store/useDigestStore';

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00');

export function DigestControls() {
  const configured = useSettingsStore(selectIsConfigured);
  const verified = useSettingsStore((s) => s.verified);
  const config = useDigestStore((s) => s.config);
  const loadError = useDigestStore((s) => s.error);
  const load = useDigestStore((s) => s.load);
  const save = useDigestStore((s) => s.save);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'busy'; msg: string } | null>(null);
  const ready = configured && verified;

  useEffect(() => {
    if (configured) void load();
  }, [configured, load]);

  if (!configured) {
    return (
      <p className="settings-intro">connect cloud sync in the “cloud sync” tab first.</p>
    );
  }

  const setTime = (e: FormEvent<HTMLSelectElement>) => {
    if (!ready) return;
    setStatus(null);
    void save({ time: e.currentTarget.value });
  };

  const toggleEnabled = () => {
    if (!ready) return;
    setStatus(null);
    void save({ enabled: !config.enabled });
  };

  const sendTest = async () => {
    if (!ready) return;
    setStatus({ kind: 'busy', msg: 'sending…' });
    try {
      const res = await kvClient.sendDigestTest(selectCloudConfig(useSettingsStore.getState()));
      setStatus({ kind: 'ok', msg: `sent — ${res?.subject ?? 'check your inbox'}` });
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message : 'send failed' });
    }
  };

  const openPreview = async () => {
    if (!ready) return;
    setStatus({ kind: 'busy', msg: 'building preview…' });
    try {
      const html = await kvClient.getDigestPreview(selectCloudConfig(useSettingsStore.getState()));
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setStatus(null);
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message : 'preview failed' });
    }
  };

  return (
    <div className="settings-body">
      <p className="settings-intro">
        a morning email with your pending deadlines (with days left) and today’s
        sessions · times in {fmtTzOffset(config.tzOffsetMinutes)}
      </p>

      {!verified && (
        <div className="settings-status err">
          token not verified — mail controls locked. fix the access token in the
          “cloud sync” tab (use test), then this unlocks automatically.
        </div>
      )}

      <div className="popup-row" style={{ opacity: ready ? 1 : 0.45 }}>
        <span className="pr-label">send every day</span>
        <button
          type="button"
          className={'pa-done' + (config.enabled ? ' active' : '')}
          onClick={toggleEnabled}
          disabled={!ready}
          style={{ padding: '0.3rem 0.8rem', borderRadius: 8, border: 'none', cursor: ready ? 'pointer' : 'not-allowed', fontSize: '0.8rem', fontWeight: 600 }}
        >
          {config.enabled ? 'on' : 'off'}
        </button>
      </div>

      <div className="popup-row" style={{ opacity: ready ? 1 : 0.45 }}>
        <span className="pr-label">send at</span>
        <select
          className="popup-input"
          style={{ width: 110, cursor: ready ? 'pointer' : 'not-allowed' }}
          value={config.time}
          onChange={setTime}
          disabled={!ready}
          aria-label="digest send time"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-actions">
        <button type="button" className="settings-btn settings-btn-ghost" onClick={openPreview} disabled={!ready}>
          preview
        </button>
        <button type="button" className="settings-btn settings-btn-primary" onClick={sendTest} disabled={!ready}>
          send test now
        </button>
      </div>

      {status && (
        <div className={`settings-status ${status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : ''}`}>
          {status.msg}
        </div>
      )}
      {!status && loadError && <div className="settings-status err">{loadError}</div>}
    </div>
  );
}
