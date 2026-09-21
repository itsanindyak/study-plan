import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore, selectIsConfigured } from '@/store/useSettingsStore';
import { useSubjectStore } from '@/store/useSubjectStore';
import { useSessionStore } from '@/store/useSessionStore';
import { normalize as normalizeName, suggestColor } from '@/lib/subjects';
import { ColorMenu } from '@/components/ColorMenu';
import { kvClient } from '../sync/kvClient';

type Status = { kind: 'idle' | 'ok' | 'err'; text: string };
type Tab = 'cloud' | 'subjects';

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('cloud');

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="popup-backdrop"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="popup"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 440 }}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div className="popup-head">
              <div
                className="popup-swatch"
                style={{ background: 'linear-gradient(135deg, #5b8def, #2b5fc7)' }}
              />
              <div className="popup-title">
                <h3>settings</h3>
                <div className="pt-sub">cloud sync and your subject catalog</div>
              </div>
              <button className="popup-close" onClick={onClose} aria-label="close">
                ✕
              </button>
            </div>

            <div className="settings-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'cloud'}
                className={'settings-tab' + (tab === 'cloud' ? ' active' : '')}
                onClick={() => setTab('cloud')}
              >
                cloud sync
              </button>
              <button
                role="tab"
                aria-selected={tab === 'subjects'}
                className={'settings-tab' + (tab === 'subjects' ? ' active' : '')}
                onClick={() => setTab('subjects')}
              >
                subjects
              </button>
            </div>

            {tab === 'cloud' ? <CloudTab onClose={onClose} /> : <SubjectsTab />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────── cloud sync tab ───────

function CloudTab({ onClose }: { onClose: () => void }) {
  const token = useSettingsStore((s) => s.token);
  const setToken = useSettingsStore((s) => s.setToken);
  const clear = useSettingsStore((s) => s.clear);
  const configured = useSettingsStore(selectIsConfigured);

  const [draft, setDraft] = useState(token);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [busy, setBusy] = useState(false);

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
      const res = await kvClient.ping(cfg());
      if (!res || !res.ok) {
        throw new Error('invalid response from server (is the Worker URL correct?)');
      }
      setStatus({ kind: 'ok', text: 'connection works ✓' });
    } catch (err) {
      setStatus({ kind: 'err', text: 'failed: ' + (err as Error).message });
    } finally {
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
  );
}

// ─────── subjects tab ───────

function SubjectsTab() {
  const subjects = useSubjectStore((s) => s.subjects);
  const add = useSubjectStore((s) => s.add);
  const rename = useSubjectStore((s) => s.rename);
  const recolor = useSubjectStore((s) => s.recolor);
  const remove = useSubjectStore((s) => s.remove);
  const sessions = useSessionStore((s) => s.sessions);

  // how many sessions in the cache use each subject name — used to warn
  // before deleting a subject that's still referenced
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const list of Object.values(sessions)) {
      for (const s of list) {
        const k = normalizeName(s.subject);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [sessions]);

  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState(() => suggestColor(subjects));
  const [addError, setAddError] = useState('');

  // when the catalog changes, propose a palette color that's still free
  useEffect(() => {
    setDraftColor((prev) => {
      const used = new Set(subjects.map((s) => s.color.toLowerCase()));
      if (!used.has(prev.toLowerCase())) return prev;
      return suggestColor(subjects);
    });
  }, [subjects]);

  const onAdd = () => {
    setAddError('');
    const r = add({ name: draftName, color: draftColor });
    if (!r) {
      setAddError(
        draftName.trim()
          ? 'a subject with that name already exists'
          : 'give the subject a name first',
      );
      return;
    }
    setDraftName('');
  };

  return (
    <div className="settings-body">
      <p className="settings-intro">
        Add subjects with a color first, then they show up in the add-session picker.
        Recoloring here updates every existing block instantly with no writes; renaming
        only affects future sessions.
      </p>

      <div className="subject-add">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="e.g. mathematics"
          className="subject-add-name"
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
        />
        <ColorMenu
          value={draftColor}
          onChange={setDraftColor}
          label="new subject color"
        />
        <button
          type="button"
          className="settings-btn settings-btn-primary subject-add-btn"
          onClick={onAdd}
        >
          + add
        </button>
      </div>
      {addError && (
        <div className="settings-status err">{addError}</div>
      )}

      <ul className="subject-list">
        {subjects.map((s) => (
          <SubjectRow
            key={s.id}
            subject={s}
            usage={usage.get(normalizeName(s.name)) ?? 0}
            onRename={(name) => rename(s.id, name)}
            onRecolor={(color) => recolor(s.id, color)}
            onDelete={() => {
              if (window.confirm(`Remove "${s.name}" from your catalog?`)) remove(s.id);
            }}
          />
        ))}
      </ul>

      {subjects.length === 0 && (
        <p className="settings-empty">no subjects yet — add one above to get started</p>
      )}
    </div>
  );
}

function SubjectRow({
  subject,
  usage,
  onRename,
  onRecolor,
  onDelete,
}: {
  subject: { id: string; name: string; color: string };
  usage: number;
  onRename: (name: string) => boolean | void;
  onRecolor: (color: string) => boolean | void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(subject.name);
  useEffect(() => setDraft(subject.name), [subject.name]);

  const commit = () => {
    if (draft.trim() && draft !== subject.name) onRename(draft);
    setEditing(false);
  };

  return (
    <li className="subject-row">
      <ColorMenu
        compact
        value={subject.color}
        onChange={onRecolor}
        label="recolor subject"
      />
      {editing ? (
        <input
          type="text"
          value={draft}
          autoFocus
          className="subject-name-input"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setDraft(subject.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="subject-name" onClick={() => setEditing(true)}>
          <span className="subject-name-text">{subject.name}</span>
          {usage > 0 && (
            <span className="subject-usage">
              · used by {usage} session{usage === 1 ? '' : 's'}
            </span>
          )}
        </button>
      )}
      <button
        type="button"
        className="subject-del"
        onClick={onDelete}
        aria-label="delete subject"
        title="delete subject"
      >
        ✕
      </button>
    </li>
  );
}
