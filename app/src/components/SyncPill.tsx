import { useSyncPill } from '@/features/sync/useCloudSync';
import { useSettingsStore, selectIsConfigured } from '@/store/useSettingsStore';

export function SyncPill({ onClick }: { onClick: () => void }) {
  const { state, label } = useSyncPill();
  const configured = useSettingsStore(selectIsConfigured);
  return (
    <button
      type="button"
      className="sync-pill is-clickable"
      data-state={state}
      onClick={onClick}
      title="cloud sync status — click to manage"
    >
      <span className="sync-dot" />
      <span className="sync-label">
        {!configured ? 'offline' : label}
      </span>
    </button>
  );
}
