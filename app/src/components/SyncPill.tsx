import { useSyncPill, pullFromCloud } from '@/features/sync/useCloudSync';
import { useSettingsStore, selectIsConfigured } from '@/store/useSettingsStore';

export function SyncPill({ onClick }: { onClick: () => void }) {
  const { state } = useSyncPill();
  const configured = useSettingsStore(selectIsConfigured);

  const handleClick = async (e: React.MouseEvent) => {
    if (configured) {
      e.stopPropagation();
      await pullFromCloud();
    } else {
      onClick();
    }
  };

  if (configured) {
    return (
      <button
        type="button"
        className={`sync-reload-btn ${state === 'syncing' ? 'is-syncing' : ''}`}
        data-state={state}
        onClick={handleClick}
        title="cloud sync status — click to sync now"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="reload-icon"
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 16h5v5" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="sync-pill is-clickable"
      data-state="offline"
      onClick={handleClick}
      title="cloud sync status — click to configure"
    >
      <span className="sync-dot" />
      <span className="sync-label">offline</span>
    </button>
  );
}
